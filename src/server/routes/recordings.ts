import { Router } from "express";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { getProjectConfigurationBySlug } from "../../db/project-reader";
import {
  deleteRecording,
  listRecordings,
  loadScenarios,
  loadTrace,
  saveScenarios,
  toSummary,
  saveSemanticRecording,
  loadSemanticRecording,
} from "../../recording/recording-store";
import {
  RecordingError,
  deriveScenarios,
  getActiveRecording,
  executeRecordingAction,
  recordingProgress,
  resolveRecordingTarget,
  startRecording,
  stopRecording,
} from "../jobs/session-recording-runner";
import {
  publishScenariosToTestRail,
  readPersistedScenarioMappings,
} from "../services/testrail-case-publisher";
import {
  buildScenarioPreviewScenarioId,
  type ScenarioPreviewCaseMapping,
  type ScenarioPreviewPublishContext,
} from "../services/testrail-sync-types";
import { toPublishableScenario } from "../../recording/scenario-to-testrail";
import { materializeRecordedScenario, type RecordedScenario } from "../../recording/trace-to-scenario";
import { buildSemanticRecordingModel, attachScenarioSuggestions } from "../../recording/semantic-recording";
import { applyRuntimeDatasetValues, hydrateCanonicalInteractionsFromSemanticModel, toSharedMcpScenario } from "../../recording/canonical-recording-contract";
import { hydratePersistedScenarios } from "../../recording/persisted-scenario-hydration";
import { jobStore } from "../jobs/job-store";
import { startScenarioPreviewRun, startReuseExistingPromotedSpecRun, type ReuseExistingPromotedSpecScenario } from "../jobs/scenario-preview-runner";
import { resolveReplayAdmission } from "../services/replay-admission";
import { resolveScenarioAutomationPlans, partitionScenariosForExecution, computeTestRailPublishCandidates, type ScenarioAutomationPlan, type TestRailCaseLookup, type TestRailDestination } from "../../automations/recording-automation-resolution";
import { startWebRecordingExecution } from "../jobs/web-recording-execution-runner";
import { resolveRecordingAvailability } from "../../recording/recording-availability";
import { limitFor } from "../jobs/job-queue";

export const recordingsRouter = Router();

/**
 * Recorded exploration sessions.
 *
 * Every route is addressed by the PROJECT, never by a hand-typed app slug or package: the
 * project's configuration is what decides which application gets recorded, which is the
 * whole reason the flow starts by picking one. A recording therefore cannot drift onto an
 * app the project does not own.
 */

function sendError(res: any, status: number, code: string, message: string): void {
  res.status(status).json({ ok: false, error: code, errorCode: code, message });
}

function handle(res: any, err: unknown): void {
  if (err instanceof RecordingError) {
    const status =
      err.code === "PROJECT_NOT_FOUND" || err.code === "RECORDING_NOT_FOUND"
        ? 404
        : err.code === "RECORDING_ALREADY_ACTIVE"
          ? 409
          // The server is full, not the request wrong: 503 tells the client to retry later.
          : err.code === "RECORDING_CAPACITY_REACHED" || err.code === "RECORDING_UNAVAILABLE"
            ? 503
            : 400;
    sendError(res, status, err.code, err.message);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[recordings] error=${message}`);
  sendError(res, 500, "RECORDING_FAILED", message);
}

/**
 * Structured, explicit intent only — never inferred from labels/text. Plain "Reproducir"
 * (generateSpec absent/false) must keep deferring spec generation; only an explicit
 * `generateSpec: true` on the /execute request turns on the existing auto-promote/auto-pom
 * pipeline that discovery:preview already runs for non-recording discovery.
 */
export function resolveExecuteJobOptions(body: { generateSpec?: unknown }): {
  generateSpec: boolean;
  headed: false;
  autoPromote: boolean;
  autoPom: boolean;
} {
  const generateSpec = body.generateSpec === true;
  return { generateSpec, headed: false, autoPromote: generateSpec, autoPom: generateSpec };
}

export type RecordingExecutionAdmissionInput = {
  requested: string[] | undefined;
  all: RecordedScenario[];
  selected: RecordedScenario[];
  semanticModel: Parameters<typeof hydrateCanonicalInteractionsFromSemanticModel>[1];
  values: Record<string, string | undefined>;
  appSlug: string;
};

export type RecordingExecutionAdmissionRejected = {
  ready: false;
  responseBody: Record<string, unknown>;
};

export type RecordingExecutionAdmissionAccepted = {
  ready: true;
  /** Narrowed to exactly the scenarios that passed admission — the only ones any caller may pass to a side effect. */
  selected: RecordedScenario[];
  materialized: RecordedScenario[];
  executableContracts: ReturnType<typeof toSharedMcpScenario>[];
  admission: ReturnType<typeof resolveReplayAdmission>;
  requestedScenarioIds: string[];
  unresolvedRequestedScenarioIds: string[];
};

/**
 * The single admission authority for `/execute`: evaluates the CURRENT execution readiness of
 * every requested scenario (reusing `toSharedMcpScenario`/`resolveReplayAdmission`, the same
 * evaluation the job path already used) and partitions accepted/rejected. Callers MUST run this
 * — and act on its result — before any external side effect (TestRail publish, automation
 * resolution, spec generation, discovery). When it returns `ready: false`, no scenario in the
 * request is executable and the caller must respond 409 without touching anything external.
 * When it returns `ready: true`, `selected`/`executableContracts` are already narrowed to the
 * accepted subset — a rejected scenario is structurally unreachable from that point on.
 */
export function evaluateRecordingExecutionAdmission(input: RecordingExecutionAdmissionInput): RecordingExecutionAdmissionRejected | RecordingExecutionAdmissionAccepted {
  const { requested, all, selected, semanticModel, values, appSlug } = input;
  const requestedScenarioIds: string[] = requested ?? all.map((scenario) => scenario.scenarioId);
  const requestedSet = new Set(requestedScenarioIds);
  const materialized = selected.map((scenario) => applyRuntimeDatasetValues(
    hydrateCanonicalInteractionsFromSemanticModel(scenario, semanticModel),
    values,
  ));
  const contracts = materialized.map((scenario) => toSharedMcpScenario(scenario, appSlug, values));
  const evaluatedRejectedScenarios = contracts.flatMap((contract) => {
    if (typeof contract.scenarioId !== "string") return [];
    const scenario = materialized.find((candidate) => candidate.scenarioId === contract.scenarioId);
    const reasons = [
      ...(scenario?.readiness?.missingInputs ?? []).map((requirement) => `missing_runtime_input:${requirement.valueKey}`),
      ...(scenario?.readiness?.datasetAuthorityMismatches ?? []).map(() => "dataset_authority_mismatch"),
      ...(contract.mcpExecutable ? [] : [contract.nonExecutableCriteria || "execution_not_ready"]),
    ];
    return reasons.length > 0 ? [{ scenarioId: contract.scenarioId, reasons }] : [];
  });
  const nonRequestedRejectedCandidates = all
    .filter((scenario) => !requestedSet.has(scenario.scenarioId))
    .flatMap((scenario) => {
      const reason = scenario.quality?.finalDecision === "rejected"
        ? scenario.quality.rejectionReason
        : scenario.mutationDiagnostics?.rejectionReason;
      return reason ? [{ scenarioId: scenario.scenarioId, reasons: [reason] }] : [];
    });
  const admission = resolveReplayAdmission({
    requestedScenarioIds,
    evaluatedScenarioIds: contracts.flatMap((contract) => typeof contract.scenarioId === "string" ? [contract.scenarioId] : []),
    eligibleScenarioIds: contracts.flatMap((contract) => contract.mcpExecutable && typeof contract.scenarioId === "string" ? [contract.scenarioId] : []),
    admittedScenarioIds: contracts.flatMap((contract) => contract.mcpExecutable && typeof contract.scenarioId === "string" ? [contract.scenarioId] : []),
    evaluatedRejectedScenarios,
    nonRequestedRejectedCandidates,
  });
  const rejectedIds = new Set(admission.requestedRejectedScenarioIds);
  const executableContracts = contracts.filter((contract) => typeof contract.scenarioId === "string" && !rejectedIds.has(contract.scenarioId));
  const unresolvedRequestedScenarioIds = requestedScenarioIds.filter((scenarioId) => !all.some((scenario) => scenario.scenarioId === scenarioId));
  if (executableContracts.length === 0) {
    return {
      ready: false,
      responseBody: {
        ok: false,
        error: "EXECUTION_NOT_READY",
        errorCode: "EXECUTION_NOT_READY",
        message: "Ningún escenario seleccionado está listo para ejecución.",
        ...admission,
        rejectedScenarios: admission.requestedRejectedScenarios,
        blocked: admission.requestedRejectedScenarios,
        unresolvedRequestedScenarioIds,
      },
    };
  }
  const acceptedScenarioIdSet = new Set(executableContracts.map((contract) => contract.scenarioId as string));
  return {
    ready: true,
    selected: selected.filter((scenario) => acceptedScenarioIdSet.has(scenario.scenarioId)),
    materialized,
    executableContracts,
    admission,
    requestedScenarioIds,
    unresolvedRequestedScenarioIds,
  };
}

/**
 * Keep request-materialized scenario data attached to the exact scenarios admitted
 * for this execution. Identity remains scenarioId; values never use positional matching.
 */
/**
 * `PUT /:recordingId/scenarios` persists REVIEWER EDITS to an already-materialized catalog --
 * it never legitimately clears it to zero. An empty payload accepted here would silently
 * overwrite (via `saveScenarios`'s full-file write) whatever `derive()` already persisted,
 * producing "scenarios=[] despite a real prior derive" -- indistinguishable from a recording
 * that was simply never derived. "Not derived yet" and "explicitly cleared" must stay
 * distinguishable, so this is never relaxed even when the caller believes the recording has no
 * scenarios.
 */
export function shouldRejectEmptyScenarioOverwrite(incomingCount: number, currentlyPersistedCount: number): boolean {
  return incomingCount === 0 && currentlyPersistedCount > 0;
}

/** Resolves the app slug a recording lives under, from the project it belongs to. */
async function appSlugFor(projectSlug: string): Promise<string> {
  const target = await resolveRecordingTarget(projectSlug);
  return target.appSlug;
}

function readRecordingScenarios(appSlug: string, recordingId: string): RecordedScenario[] {
  return hydratePersistedScenarios(
    loadScenarios(appSlug, recordingId),
    loadSemanticRecording(appSlug, recordingId),
    loadTrace(appSlug, recordingId),
  );
}
/**
 * GET /api/recordings/capabilities
 *
 * Whether this engine can record at all. The UI asks first so it can hide the
 * module on a server instead of offering a button that will always fail.
 * Declared before "/:recordingId" so the literal path wins.
 */
recordingsRouter.get("/capabilities", (_req, res) => {
  const availability = resolveRecordingAvailability();
  res.json({
    ok: true,
    recording: availability,
    maxConcurrent: limitFor("recording"),
  });
});

// GET /api/recordings?projectSlug=slug — recordings already captured for a project.
recordingsRouter.get("/", async (req, res) => {
  try {
    const projectSlug = String(req.query.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    res.json({ ok: true, projectSlug, appSlug, recordings: listRecordings(appSlug) });
  } catch (err) {
    handle(res, err);
  }
});

// POST /api/recordings/start — opens the app (or the browser) and begins observing.
recordingsRouter.post("/start", async (req, res) => {
  try {
    const body = req.body ?? {};
    const projectSlug = String(body.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    console.log(`[recordings:goal-lineage] proxyGoal=${JSON.stringify(typeof body.recordingGoal === "string" ? body.recordingGoal : undefined)} label=${JSON.stringify(typeof body.label === "string" ? body.label : undefined)}`);
    // captureAuthority is deliberately NOT read from the request body: CaptureEngine V2 is the
    // WEB recorder now, not a client-selectable feature. startRecording resolves its own
    // platform-appropriate default; `captureAuthority: "legacy"` remains reachable only as an
    // API-INTERNAL override for tests/regression/rollback, never through this public route.
    const result = await startRecording({
      projectSlug,
      label: typeof body.label === "string" ? body.label.trim() || undefined : undefined,
      recordingGoal: typeof body.recordingGoal === "string" ? body.recordingGoal.trim() || undefined : undefined,
      recordingDataPolicy: body.recordingDataPolicy && typeof body.recordingDataPolicy === "object"
        ? {
            persistRecordedValues: (body.recordingDataPolicy as any).persistRecordedValues === true,
            // Accepted for legacy request compatibility; normalization enforces the current
            // Recording invariant server-side.
            persistQaCredentials: true,
            includeQaCredentialsInTestRail: true,
          }
        : undefined,
      avdName: typeof body.avdName === "string" ? body.avdName : undefined,
      headless: typeof body.headless === "boolean" ? body.headless : undefined,
      sensitiveLabels: Array.isArray(body.sensitiveLabels)
        ? body.sensitiveLabels.filter((s: unknown): s is string => typeof s === "string")
        : undefined,
    });
    res.status(202).json({ ok: true, ...result });
  } catch (err) {
    handle(res, err);
  }
});

// GET /api/recordings/:recordingId — live progress while recording, stored summary after.
recordingsRouter.get("/:recordingId", async (req, res) => {
  try {
    const { recordingId } = req.params;
    const live = recordingProgress(recordingId);
    if (live) {
      res.json({ ok: true, active: true, ...live });
      return;
    }
    const projectSlug = String(req.query.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio para consultar una grabación detenida");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    const trace = loadTrace(appSlug, recordingId);
    if (!trace) {
      sendError(res, 404, "RECORDING_NOT_FOUND", `No se encontró la grabación ${recordingId}`);
      return;
    }
    res.json({
      ok: true,
      active: false,
      summary: toSummary(trace, loadScenarios(appSlug, recordingId).length),
    });
  } catch (err) {
    handle(res, err);
  }
});

// POST /api/recordings/:recordingId/stop — ends the walkthrough and persists the trace.
recordingsRouter.post("/:recordingId/stop", async (req, res) => {
  try {
    const summary = await stopRecording(req.params.recordingId);
    res.json({ ok: true, summary });
  } catch (err) {
    handle(res, err);
  }
});

// POST /api/recordings/:recordingId/control — executes one bounded action on the recorder-owned Page.
recordingsRouter.post("/:recordingId/control", async (req, res) => {
  try {
    const action = req.body?.action;
    if (!action || typeof action !== "object" || typeof action.kind !== "string") {
      sendError(res, 400, "INVALID_CONTROL_ACTION", "action.kind es obligatorio");
      return;
    }
    const result = await executeRecordingAction(req.params.recordingId, action);
    res.json({ ok: true, ...result });
  } catch (err) {
    handle(res, err);
  }
});

// POST /api/recordings/:recordingId/derive — builds the scenarios and destroys the frames.
recordingsRouter.post("/:recordingId/derive", async (req, res) => {
  try {
    const body = req.body ?? {};
    const projectSlug = String(body.projectSlug ?? req.query.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    const result = await deriveScenarios(appSlug, req.params.recordingId, {
      title: typeof body.title === "string" ? body.title : undefined,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    handle(res, err);
  }
});

// GET /api/recordings/:recordingId/scenarios — what the recording produced.
recordingsRouter.get("/:recordingId/scenarios", async (req, res) => {
  try {
    const projectSlug = String(req.query.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    const trace = loadTrace(appSlug, req.params.recordingId);
    const scenarios = readRecordingScenarios(appSlug, req.params.recordingId);
    res.json({
      ok: true,
      scenarios,
      lifecycle: {
        recordingExists: Boolean(trace),
        traceReady: Boolean(trace && ["stopped", "derived"].includes(trace.status)),
        semanticReady: Boolean(loadSemanticRecording(appSlug, req.params.recordingId)),
        scenariosReady: scenarios.length > 0,
      },
    });
  } catch (err) {
    handle(res, err);
  }
});

// Small command used by the QA Lab for one scenario value. The large read model is never
// required to persist a single edit.
recordingsRouter.put("/:recordingId/scenario-value", async (req, res) => {
  try {
    const body = req.body ?? {};
    const projectSlug = String(body.projectSlug ?? "").trim();
    const scenarioId = String(body.scenarioId ?? "").trim();
    const valueKey = String(body.valueKey ?? "").trim();
    if (!projectSlug || !scenarioId || !valueKey || typeof body.value !== "string") {
      sendError(res, 400, "INVALID_VALUE_COMMAND", "projectSlug, scenarioId, valueKey y value son obligatorios");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    const trace = loadTrace(appSlug, req.params.recordingId);
    if (!trace) {
      sendError(res, 404, "RECORDING_NOT_FOUND", "La grabación indicada no existe");
      return;
    }
    if (!loadSemanticRecording(appSlug, req.params.recordingId)) {
      sendError(res, 409, "SEMANTIC_NOT_READY", "La grabación tiene trace, pero todavía no tiene base semántica materializada");
      return;
    }
    const scenarios = loadScenarios(appSlug, req.params.recordingId);
    if (scenarios.length === 0) {
      sendError(res, 409, "SCENARIO_NOT_READY", "La grabación todavía no tiene escenarios materializados");
      return;
    }
    const current = scenarios.find((scenario) => scenario.scenarioId === scenarioId);
    if (!current) {
      sendError(res, 404, "SCENARIO_NOT_FOUND", "El escenario indicado no existe");
      return;
    }
    const knownKey = current.requiredData.some((field) => field.key === valueKey)
      || (current.runtimeInputRequirements ?? []).some((requirement) => requirement.valueKey === valueKey);
    if (!knownKey) {
      sendError(res, 400, "UNKNOWN_SCENARIO_VALUE", "El valueKey no pertenece al escenario");
      return;
    }
    const hydrated = hydrateCanonicalInteractionsFromSemanticModel(current, buildSemanticRecordingModel(trace));
    const updated = applyRuntimeDatasetValues(hydrated, { [valueKey]: body.value });
    saveScenarios(appSlug, req.params.recordingId, scenarios.map((scenario) => scenario.scenarioId === scenarioId ? updated : scenario));
    res.json({ ok: true, scenario: updated });
  } catch (err) {
    handle(res, err);
  }
});

// GET /api/recordings/:recordingId/trace — the full trace plus the distilled narrative.
recordingsRouter.get("/:recordingId/trace", async (req, res) => {
  try {
    const projectSlug = String(req.query.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    const trace = loadTrace(appSlug, req.params.recordingId);
    if (!trace) {
      sendError(res, 404, "RECORDING_NOT_FOUND", `No se encontró la grabación ${req.params.recordingId}`);
      return;
    }
    res.json({ ok: true, trace });
  } catch (err) {
    handle(res, err);
  }
});

// GET /api/recordings/:recordingId/semantic — derived semantic assets, separate from raw trace.
recordingsRouter.get("/:recordingId/semantic", async (req, res) => {
  try {
    const projectSlug = String(req.query.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    const trace = loadTrace(appSlug, req.params.recordingId);
    if (!trace) {
      sendError(res, 404, "RECORDING_NOT_FOUND", "La grabación indicada no existe");
      return;
    }
    const model = loadSemanticRecording(appSlug, req.params.recordingId);
    if (!model) {
      sendError(
        res,
        409,
        trace.status === "recording" || trace.status === "starting" ? "TRACE_NOT_READY" : "SEMANTIC_NOT_READY",
        trace.status === "recording" || trace.status === "starting"
          ? "La grabación todavía está activa y no tiene un trace semántico detenido"
          : "La grabación tiene trace, pero todavía no tiene base semántica materializada",
      );
      return;
    }
    res.json({ ok: true, model });
  } catch (err) {
    handle(res, err);
  }
});

// PUT /api/recordings/:recordingId/scenarios — persists reviewer edits before publishing.
recordingsRouter.put("/:recordingId/scenarios", async (req, res) => {
  try {
    const body = req.body ?? {};
    const projectSlug = String(body.projectSlug ?? "").trim();
    if (!projectSlug || !Array.isArray(body.scenarios)) {
      sendError(res, 400, "INVALID_REQUEST", "projectSlug y scenarios son obligatorios");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    if (shouldRejectEmptyScenarioOverwrite(body.scenarios.length, loadScenarios(appSlug, req.params.recordingId).length)) {
      sendError(res, 400, "EMPTY_SCENARIOS_REJECTED", "No se puede sobrescribir el catálogo de escenarios materializados con una lista vacía");
      return;
    }
    const datasetValues: Record<string, string | undefined> = body.datasetValues && typeof body.datasetValues === "object"
      ? Object.fromEntries(Object.entries(body.datasetValues).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    const scenarioDatasetValues: Record<string, Record<string, string>> = body.scenarioDatasetValues && typeof body.scenarioDatasetValues === "object"
      ? Object.fromEntries(Object.entries(body.scenarioDatasetValues).flatMap(([scenarioId, values]) => {
        if (!values || typeof values !== "object") return [];
        return [[scenarioId, Object.fromEntries(Object.entries(values).filter((entry): entry is [string, string] => typeof entry[1] === "string"))]];
      }))
      : {};
    const incoming = body.scenarios as RecordedScenario[];
    saveScenarios(appSlug, req.params.recordingId, incoming.map((scenario) => applyRuntimeDatasetValues(scenario, scenarioDatasetValues[scenario.scenarioId] ?? datasetValues)));
    res.json({ ok: true, scenarios: readRecordingScenarios(appSlug, req.params.recordingId) });
  } catch (err) {
    handle(res, err);
  }
});

// POST /api/recordings/:recordingId/execute — Recording enters the shared MCP core here.
// The route only adapts the recorded contract; it never creates a Recording-specific runner.
recordingsRouter.post("/:recordingId/execute", async (req, res) => {
  try {
    const body = req.body ?? {};
    const projectSlug = String(body.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    const trace = loadTrace(appSlug, req.params.recordingId);
    if (!trace) {
      sendError(res, 404, "RECORDING_NOT_FOUND", "La grabación indicada no existe");
      return;
    }
    if (!["stopped", "derived"].includes(trace.status)) {
      sendError(res, 409, "TRACE_NOT_READY", "La grabación todavía no tiene un trace detenido");
      return;
    }
    if (!loadSemanticRecording(appSlug, req.params.recordingId)) {
      sendError(res, 409, "SEMANTIC_NOT_READY", "La grabación todavía no tiene base semántica materializada");
      return;
    }
    const all = loadScenarios(appSlug, req.params.recordingId);
    if (all.length === 0) {
      sendError(res, 409, "SCENARIO_NOT_READY", "La grabación todavía no tiene escenarios materializados");
      return;
    }
    const { generateSpec, ...jobOptions } = resolveExecuteJobOptions(body);
    let effectiveJobOptions = jobOptions;
    const requestedValues = Array.isArray(body.scenarioIds)
      ? body.scenarioIds
      : typeof body.scenarioId === "string"
        ? [body.scenarioId]
        : undefined;
    const requested = requestedValues?.filter((value: unknown): value is string => typeof value === "string" && value.trim().length > 0);
    let selected = requested ? all.filter((scenario) => requested.includes(scenario.scenarioId)) : all;
    // TEMPORARY DIAGNOSTIC (this ticket only): no dataset value/secret is logged -- only ids,
    // so a request for a scenarioId that never reached the persisted store is distinguishable
    // from one that legitimately did.
    console.info("[recording-execute-authority]", {
      recordingId: req.params.recordingId,
      requestedScenarioIds: requested ?? all.map((scenario) => scenario.scenarioId),
      persistedScenarioIds: all.map((scenario) => scenario.scenarioId),
      allowed: selected.length > 0,
    });
    if (selected.length === 0) {
      sendError(res, 400, "NO_SCENARIOS_SELECTED", "Ninguno de los escenarios indicados existe en la grabación");
      return;
    }

    const values: Record<string, string | undefined> = body.datasetValues && typeof body.datasetValues === "object"
      ? Object.fromEntries(Object.entries(body.datasetValues).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    // Legacy clients send per-scenario step-index overrides. Translate them into the single
    // dataset authority without allowing one scenario to leak values into another entity.
    // Applied before admission is evaluated below, so readiness reflects the SAME values any
    // downstream side effect would eventually see.
    if (body.dataOverrides && typeof body.dataOverrides === "object") {
      for (const scenario of selected) {
        const overrides = (body.dataOverrides as Record<string, unknown>)[scenario.scenarioId];
        if (!overrides || typeof overrides !== "object") continue;
        for (const field of scenario.requiredData) {
          const value = (overrides as Record<string, unknown>)[String(field.stepIndex)];
          const sameStepFields = scenario.requiredData.filter((candidate) => candidate.stepIndex === field.stepIndex);
          // A legacy step-index payload is ambiguous when cloned entity blocks share an
          // index. Refuse to guess; the canonical dataset payload must name each valueKey.
          if (sameStepFields.length === 1 && typeof value === "string" && values[field.key] === undefined) values[field.key] = value;
        }
      }
    }

    // ADMISSION GATE — invariant: NO SIDE EFFECT BEFORE ADMISSION. Evaluate the CURRENT
    // authoritative execution readiness for every requested scenario BEFORE any external
    // mutation (TestRail publish, automation resolution, spec generation/dispatch, discovery).
    // A scenario that isn't ready is rejected here and never allowed to reach any of that.
    console.log(`[recordings:execute] recording=${req.params.recordingId} requestedScenarioIds=${JSON.stringify(requested ?? all.map((scenario) => scenario.scenarioId))} requestedCount=${(requested ?? all.map((scenario) => scenario.scenarioId)).length}`);
    const semanticModel = buildSemanticRecordingModel(trace);
    const admissionResult = evaluateRecordingExecutionAdmission({ requested, all, selected, semanticModel, values, appSlug });
    if (!admissionResult.ready) {
      res.status(409).json(admissionResult.responseBody);
      return;
    }
    // From here on, NO side effect (TestRail publish, automation resolution, spec
    // generation/dispatch, discovery) may ever see a rejected scenario: `selected` is already
    // narrowed to exactly the accepted subset — a partially-accepted request only lets the
    // accepted scenarios reach automation-resolution/TestRail below.
    const { materialized, executableContracts, admission, requestedScenarioIds, unresolvedRequestedScenarioIds } = admissionResult;
    selected = admissionResult.selected;
    console.log(`[recordings:execute] recording=${req.params.recordingId} acceptedScenarioIds=${JSON.stringify(executableContracts.map((contract) => contract.scenarioId))} acceptedCount=${admission.acceptedCount} requestedRejectedCount=${admission.requestedRejectedCount} nonRequestedRejectedCandidateCount=${admission.nonRequestedRejectedCandidates.length}`);

    // Reuse-before-regenerate, scoped to the destination the user actually picked: when
    // "Ejecutar Automatización" carries a TestRail destination, resolve each selected
    // scenario's existing TestRail case (in THAT project/suite/section, never assumed from a
    // caseId filed elsewhere) and promoted spec first, from the scenario's own persisted
    // mapping — never from a title. A scenario whose case+spec already exist in this exact
    // destination never touches discovery, AI, or the publish endpoint at all; it runs the
    // promoted spec directly and reports back below. A scenario missing only its case gets
    // exactly one case created here, then also runs the fast path. Everything still needing a
    // spec keeps going through the existing publish + generation flow.
    let fastPathResults: Array<{ scenarioId: string; caseId: number; specPath: string; status: "passed" | "failed" | "skipped"; error?: string }> = [];
    let publishToTestRailInvoked = false;
    let reuseJobId: string | undefined;
    if (body.testRailDestination && typeof body.testRailDestination === "object") {
      const rawDestination = body.testRailDestination as Record<string, unknown>;
      const destination: TestRailDestination = {
        projectId: String(rawDestination.projectId ?? "").trim(),
        suiteId: typeof rawDestination.suiteId === "string" && rawDestination.suiteId.trim() ? rawDestination.suiteId.trim() : undefined,
        sectionId: String(rawDestination.sectionId ?? "").trim(),
      };
      const lookupCase: TestRailCaseLookup = async (caseId) => {
        try {
          const client = new TestRailClient(requireTestRailConfig(config));
          const raw = await client.getCase(caseId);
          if (raw?.section_id === undefined) return null;
          const section = await client.getSection(raw.section_id);
          return { projectId: section?.project_id !== undefined ? String(section.project_id) : undefined, sectionId: String(raw.section_id) };
        } catch {
          return null;
        }
      };

      let plans = await resolveScenarioAutomationPlans(selected, destination, undefined, lookupCase);
      console.log(`[recordings:execute:automation-resolution] recording=${req.params.recordingId} destination=${JSON.stringify(destination)} decisions=${JSON.stringify(plans.map((p) => ({ scenarioId: p.scenarioId, testRail: p.testRail.status, spec: p.spec.status, decision: p.decision })))}`);
      for (const plan of plans) {
        const promotedSpecPath = selected.find((s) => s.scenarioId === plan.scenarioId)?.promotedSpec?.specPath;
        console.log(
          `[promoted-spec-reuse] scenarioId=${plan.scenarioId} specState=${plan.spec.status} specPath=${promotedSpecPath ?? "none"} `
          + `physicalExists=${Boolean(promotedSpecPath)} testRailStatus=${plan.testRail.status} decision=${plan.decision} `
          + `dispatch=${plan.spec.status === "fresh" ? "reuse" : "regenerate"} `
          + `reason=${plan.spec.status === "fresh" ? "promoted_spec_fresh_independent_of_testrail_state" : plan.spec.reason ?? plan.spec.status}`
        );
      }

      // Create only what is missing IN THIS destination — never re-publish a scenario whose
      // persisted mapping already matches it. This is independent of spec freshness (see
      // computeTestRailPublishCandidates): a fresh spec still runs via the reuse fast path below
      // regardless of TestRail state, but a missing case is still filed/reconciled here so the
      // scenario's TestRail mapping stays correct for normal execution.
      const needsCaseIds = computeTestRailPublishCandidates(plans);
      if (needsCaseIds.size > 0) {
        const needsCaseScenarios = selected.filter((scenario) => needsCaseIds.has(scenario.scenarioId));
        publishToTestRailInvoked = true;
        const outcome = await publishRecordingScenariosToTestRail({
          appSlug,
          recordingId: req.params.recordingId,
          destination,
          scenarios: needsCaseScenarios.map((scenario) => applyRuntimeDatasetValues(
            hydrateCanonicalInteractionsFromSemanticModel(scenario, buildSemanticRecordingModel(trace)),
            values,
          )),
          datasetValues: values,
          recordingDataPolicy: trace.recordingDataPolicy,
        }).catch((err) => {
          console.log(`[recordings:execute:create-case] recording=${req.params.recordingId} publish failed: ${err instanceof Error ? err.message : String(err)}`);
          return undefined;
        });
        if (outcome) {
          const createdByScenarioId = buildPublishedCaseIdByScenarioId(outcome);
          if (createdByScenarioId.size > 0) {
            const persistedDestination = { projectId: String(outcome.effectiveProjectId), suiteId: outcome.effectiveSuiteId ? String(outcome.effectiveSuiteId) : undefined, sectionId: destination.sectionId };
            const updatedAll = all.map((scenario) => {
              const caseId = createdByScenarioId.get(scenario.scenarioId);
              return caseId ? { ...scenario, testRailCaseId: caseId, testRailDestination: persistedDestination } : scenario;
            });
            saveScenarios(appSlug, req.params.recordingId, updatedAll);
            selected = selected.map((scenario) => updatedAll.find((s) => s.scenarioId === scenario.scenarioId) ?? scenario);
            // Re-resolve so a just-created case with an already-fresh spec is recognized as
            // reuse-ready on this same request, instead of falling through to the job path.
            plans = await resolveScenarioAutomationPlans(selected, destination, undefined, lookupCase);
          }
        }
      }

      const { reuseScenarioIds } = partitionScenariosForExecution(plans);
      const planByScenarioId = new Map<string, ScenarioAutomationPlan>(plans.map((plan) => [plan.scenarioId, plan]));
      const reuseIds = new Set(reuseScenarioIds);
      if (reuseIds.size > 0) {
        const reuseScenarios = selected.filter((scenario) => reuseIds.has(scenario.scenarioId));
        // Reuse never blocks the request on Playwright: it creates a job — same jobStore,
        // same case_started/case_finished log contract the SSE stream and LiveExecution
        // screen already read for every other job type — and returns immediately. No
        // discovery, no AI, no spec generation, no publish: only the persisted spec runs,
        // headless, inside that background job (see startReuseExistingPromotedSpecRun).
        const reuseJobScenarios: ReuseExistingPromotedSpecScenario[] = reuseScenarios.map((scenario) => {
          const plan = planByScenarioId.get(scenario.scenarioId);
          const caseId = plan?.testRail.status === "existing" ? plan.testRail.caseId : 0;
          console.log(`[promoted-spec-reuse] phase=execution_start scenarioId=${scenario.scenarioId} specPath=${scenario.promotedSpec!.specPath} runtimeDatasetPresent=${Boolean(scenario.runtimeDataset?.resolvedValues)} runtimeKeys=${JSON.stringify(Object.keys(scenario.runtimeDataset?.resolvedValues ?? {}))}`);
          // FIRST_LOSS fix (jobId ea237116-88b1-4be4-ab74-9e37e0716c5f): this fast path builds
          // ReuseExistingPromotedSpecScenario directly from the loaded RecordedScenario -- which
          // DOES already carry runtimeDataset.resolvedValues ("Datos de este escenario") -- but
          // never copied it through. A SEPARATE construction site from rerun-runner.ts's
          // resolvePromotedSpecReuse (already fixed); this route bypasses that file entirely.
          return { scenarioId: scenario.scenarioId, caseId, specPath: scenario.promotedSpec!.specPath, title: scenario.title, runtimeValues: scenario.runtimeDataset?.resolvedValues };
        });
        fastPathResults = reuseJobScenarios.map((s) => ({ scenarioId: s.scenarioId, caseId: s.caseId, specPath: s.specPath, status: "skipped" as const }));
        const reuseJob = jobStore.create("scenario-preview", {
          appSlug,
          recordingId: req.params.recordingId,
          scenarios: reuseJobScenarios,
          executionMode: "reuse_existing_promoted_spec",
        });
        reuseJobId = reuseJob.id;
        console.log(`[recordings:execute:fast-path] recording=${req.params.recordingId} jobId=${reuseJobId} scenarios=${reuseJobScenarios.length} publishInvoked=false generationInvoked=false headless=true`);
        setImmediate(() => startReuseExistingPromotedSpecRun(reuseJob.id));
        selected = selected.filter((scenario) => !reuseIds.has(scenario.scenarioId));
      }
      // Everything still reaching the job stage under this mode is, by construction, either
      // "generate_spec" or "create_case_and_generate_spec" — both require generation, so the
      // legacy per-request `generateSpec` flag is superseded here rather than consulted.
      effectiveJobOptions = { ...jobOptions, autoPromote: true, autoPom: true };
      if (selected.length === 0) {
        res.status(202).json({
          ok: true,
          jobId: reuseJobId,
          executionMode: "reuse_existing_promoted_spec",
          scenarioCount: fastPathResults.length,
          fastPath: fastPathResults,
          publishToTestRailInvoked,
          specGenerationInvoked: false,
        });
        return;
      }
    }
    // Executing a selected subset must not collapse the persisted catalog to that subset.
    // Keep unselected scenarios durable while replacing only the contracts that were
    // rehydrated/materialized for this execution.
    const materializedByScenarioId = new Map(materialized.map((scenario) => [scenario.scenarioId, scenario]));
    saveScenarios(
      appSlug,
      req.params.recordingId,
      all.map((scenario) => materializedByScenarioId.get(scenario.scenarioId) ?? scenario),
    );
    const job = jobStore.create("scenario-preview", {
      appSlug,
      targetAppSlug: appSlug,
      scenarios: executableContracts,
      source: { projectKey: `REC-${req.params.recordingId}` },
      recordingId: req.params.recordingId,
      requestedScenarioIds,
      ...admission,
      rejectedScenarios: admission.requestedRejectedScenarios,
      options: effectiveJobOptions,
    });
    setImmediate(() => startScenarioPreviewRun(job.id));
    res.status(202).json({
      ok: true,
      jobId: job.id,
      scenarioCount: executableContracts.length,
      generateSpec,
      ...(fastPathResults.length > 0 ? { fastPath: fastPathResults, reuseJobId } : {}),
      ...admission,
      rejectedScenarios: admission.requestedRejectedScenarios,
      unresolvedRequestedScenarioIds,
      executionMode: "shared_mcp_core",
    });
  } catch (err) {
    handle(res, err);
  }
});

/**
 * POST /api/recordings/:recordingId/execute — replays a web walkthrough in a real browser.
 *
 * Only for web recordings. An Android one is executed through the mobile launch chain, which
 * owns the emulator and Appium; sending it here would find no `webSteps` and fail obscurely,
 * so it is refused with the reason instead.
 *
 * Answers immediately with a job id: a replay opens a browser and walks the flow, which takes
 * as long as the flow takes. The panel follows it on `GET /api/runs/:jobId`, the same way it
 * follows every other operation.
 */
recordingsRouter.post("/:recordingId/execute", async (req, res) => {
  try {
    const body = req.body ?? {};
    const projectSlug = String(body.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }

    const appSlug = await appSlugFor(projectSlug);
    const trace = loadTrace(appSlug, req.params.recordingId);
    if (!trace) {
      sendError(res, 404, "RECORDING_NOT_FOUND", `No se encontró la grabación ${req.params.recordingId}`);
      return;
    }
    if (trace.platform !== "web") {
      sendError(
        res,
        400,
        "NOT_A_WEB_RECORDING",
        "Esta grabación es de Android: se ejecuta desde el lanzamiento móvil, no por esta ruta",
      );
      return;
    }

    const all = loadScenarios(appSlug, req.params.recordingId);
    if (all.length === 0) {
      sendError(res, 404, "NO_SCENARIOS", "La grabación no tiene escenarios generados");
      return;
    }
    const requested: string[] | undefined = Array.isArray(body.scenarioIds)
      ? body.scenarioIds.filter((s: unknown): s is string => typeof s === "string")
      : undefined;
    const selected = requested ? all.filter((s) => requested.includes(s.scenarioId)) : all;
    if (selected.length === 0) {
      sendError(res, 400, "NO_SCENARIOS_SELECTED", "Ninguno de los escenarios indicados existe en la grabación");
      return;
    }

    const { jobId } = startWebRecordingExecution({
      appSlug,
      recordingId: req.params.recordingId,
      scenarios: selected,
      baseUrl: trace.baseUrl,
      dataOverrides:
        body.dataOverrides && typeof body.dataOverrides === "object" ? body.dataOverrides : undefined,
    });

    res.status(202).json({ ok: true, jobId, scenarioCount: selected.length });
  } catch (err) {
    handle(res, err);
  }
});

/**
 * POST /api/recordings/:recordingId/testrail — publishes the derived scenarios as cases.
 *
 * The destination section comes from the project's own TestRail configuration, so a recorded
 * case lands in the same place the rest of that project's cases do. Only the scenarios named
 * in `scenarioIds` are sent when the caller passes them, because a reviewer usually accepts
 * part of what was derived.
 */
export class RecordingTestRailPublishError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export type RecordingTestRailDestinationInput = { projectId?: string; suiteId?: string; sectionId: string };

export type RecordingTestRailPublishOutcome = {
  effectiveProjectId: number;
  effectiveSuiteId?: number;
  sectionName?: string;
  created: Array<{ scenarioId: string; caseId: number; title: string }>;
  reconciledCreated: Array<{ scenarioId: string; caseId: number; title: string }>;
  skippedAlreadyPublished: Array<{ scenarioId: string; caseId: number }>;
  failed: Array<{ scenarioId: string; message: string }>;
  publishResult?: Awaited<ReturnType<typeof publishScenariosToTestRail>>;
};

/**
 * A scenario whose case already existed under this exact destination (recognized via the
 * publisher's own dedup — `skippedAlreadyPublished`, not a fresh add_case) is just as
 * legitimate a published result as one just created or reconciled. Building the persisted
 * caseId map from only `created`+`reconciledCreated` silently dropped that case: the scenario's
 * testRailCaseId/testRailDestination were never persisted, so the next execution saw "missing"
 * again and re-ran the same publish attempt against the same already-published case
 * indefinitely. Pure and exported for hermetic testing.
 */
export function buildPublishedCaseIdByScenarioId(
  outcome: Pick<RecordingTestRailPublishOutcome, "created" | "reconciledCreated" | "skippedAlreadyPublished">,
): Map<string, number> {
  return new Map(
    [...outcome.created, ...outcome.reconciledCreated, ...outcome.skippedAlreadyPublished].map((c) => [c.scenarioId, c.caseId]),
  );
}

/**
 * Publishes exactly the scenarios it is given to one TestRail destination.
 *
 * Shared by `/:recordingId/testrail` (publishes whatever the panel selected, unconditionally)
 * and `/:recordingId/execute` (publishes only the scenarios the automation-resolution engine
 * found missing from the selected destination) — one publish path, so a case created from
 * either place is created the same way and never duplicated by having two implementations
 * drift apart. Section/project/suite membership is validated once here.
 */
async function publishRecordingScenariosToTestRail(input: {
  appSlug: string;
  recordingId: string;
  destination: RecordingTestRailDestinationInput;
  scenarios: RecordedScenario[];
  datasetValues: Record<string, string | undefined>;
  recordingDataPolicy?: unknown;
}): Promise<RecordingTestRailPublishOutcome> {
  const { appSlug, recordingId, destination, scenarios, datasetValues } = input;
  const sectionId = String(destination.sectionId ?? "").trim();
  const projectId = String(destination.projectId ?? "").trim();
  const suiteId = String(destination.suiteId ?? "").trim();
  if (!sectionId) {
    throw new RecordingTestRailPublishError("MISSING_SECTION", "No se envió sectionId de TestRail");
  }

  const client = new TestRailClient(requireTestRailConfig(config));

  let sectionName: string | undefined;
  let sectionProjectId: number | undefined;
  let sectionSuiteId: number | undefined;
  try {
    const section = await client.getSection(Number(sectionId));
    if (!section) {
      throw new RecordingTestRailPublishError("SECTION_NOT_FOUND", `La sección ${sectionId} no existe en TestRail`);
    }
    sectionName = section.name;
    sectionProjectId = section.project_id;
    sectionSuiteId = section.suite_id;
    if (projectId && section.project_id !== undefined && String(section.project_id) !== projectId) {
      throw new RecordingTestRailPublishError(
        "SECTION_NOT_IN_PROJECT",
        `La sección ${sectionId} ("${section.name}") pertenece al proyecto ${section.project_id} de TestRail, no al ${projectId}`,
      );
    }
    if (suiteId && section.suite_id !== undefined && String(section.suite_id) !== suiteId) {
      throw new RecordingTestRailPublishError(
        "SECTION_NOT_IN_SUITE",
        `La sección ${sectionId} ("${section.name}") pertenece a la suite ${section.suite_id}, no a la ${suiteId}`,
      );
    }
  } catch (err) {
    if (err instanceof RecordingTestRailPublishError) throw err;
    console.log(`[recordings:testrail] no se pudo validar la sección ${sectionId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const effectiveProjectId = Number(projectId || sectionProjectId || 0);
  if (!effectiveProjectId) {
    throw new RecordingTestRailPublishError(
      "MISSING_PROJECT",
      `No se pudo determinar el proyecto de TestRail para la sección ${sectionId}: envía projectId o configúralo en el proyecto`,
    );
  }
  const effectiveSuiteId = Number(suiteId || sectionSuiteId || 0) || undefined;

  const cacheKey = `recording-${recordingId}`;
  const publishable = scenarios.map((scenario) =>
    toPublishableScenario(
      materializeRecordedScenario(scenario, datasetValues),
      appSlug,
      recordingId,
      input.recordingDataPolicy as never,
    ),
  );
  const publishIdOf = (index: number) =>
    buildScenarioPreviewScenarioId(publishable[index], index, { launchId: recordingId });

  let mappings: ScenarioPreviewCaseMapping[] = [];
  let publishError: string | undefined;
  let publishResult: Awaited<ReturnType<typeof publishScenariosToTestRail>> | undefined;
  try {
    const result = await publishScenariosToTestRail(client, {
      projectId: effectiveProjectId,
      suiteId: effectiveSuiteId,
      sectionId: Number(sectionId),
      appSlug,
      scenarios: publishable,
      cacheKey,
      publishStrategy: "always_create",
      launchId: recordingId,
      recordingBatch: true,
      suppressAutomationMarker: true,
    } as ScenarioPreviewPublishContext);
    publishResult = result;
    mappings = result.mappings;
    console.log(
      `[recordings:testrail] recording=${recordingId} creados=${result.created} reconciliados=${result.reconciledCreated.length} actualizados=${result.updated} reutilizados=${result.reused} omitidosYaPublicados=${result.skipped.length}`,
    );
  } catch (err) {
    publishError = err instanceof Error ? err.message : String(err);
    mappings = readPersistedScenarioMappings().filter((m) => m.cacheKey === cacheKey && m.sectionId === Number(sectionId));
    console.log(`[recordings:testrail] publicación interrumpida recording=${recordingId}: ${publishError}`);
  }

  const byPublishId = new Map(mappings.map((m) => [m.scenarioId, m]));
  const created: Array<{ scenarioId: string; caseId: number; title: string }> = [];
  const reconciledCreated: Array<{ scenarioId: string; caseId: number; title: string }> = [];
  const failed: Array<{ scenarioId: string; message: string }> = [];
  const skippedAlreadyPublished: Array<{ scenarioId: string; caseId: number }> = [];
  scenarios.forEach((scenario, index) => {
    const mapping = byPublishId.get(publishIdOf(index));
    if (mapping) {
      if (mapping.source === "skipped_already_published") {
        skippedAlreadyPublished.push({ scenarioId: scenario.scenarioId, caseId: mapping.testRailCaseId });
      } else if (mapping.source === "recovered_after_add_case_500") {
        reconciledCreated.push({ scenarioId: scenario.scenarioId, caseId: mapping.testRailCaseId, title: scenario.title });
      } else {
        created.push({ scenarioId: scenario.scenarioId, caseId: mapping.testRailCaseId, title: scenario.title });
      }
    } else {
      failed.push({ scenarioId: scenario.scenarioId, message: publishError ?? "TestRail no devolvió un caso para este escenario" });
    }
  });

  return { effectiveProjectId, effectiveSuiteId, sectionName, created, reconciledCreated, skippedAlreadyPublished, failed, publishResult };
}

recordingsRouter.post("/:recordingId/testrail", async (req, res) => {
  try {
    const body = req.body ?? {};
    const projectSlug = String(body.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    const cfg = await getProjectConfigurationBySlug(projectSlug);
    if (!cfg) {
      sendError(res, 404, "PROJECT_NOT_FOUND", `No existe el proyecto ${projectSlug}`);
      return;
    }
    // The request wins over the project's configuration: the selector in the recording panel
    // is what lets a walkthrough be filed somewhere other than the project's usual section,
    // and falling back keeps the panel working before anything is chosen.
    const sectionId = String(body.sectionId ?? cfg.testrail?.sectionId ?? "").trim();
    const projectId = String(body.projectId ?? cfg.testrail?.projectIdTr ?? "").trim();
    const suiteId = String(body.suiteId ?? cfg.testrail?.suiteId ?? "").trim();
    if (!sectionId) {
      sendError(
        res,
        400,
        "MISSING_SECTION",
        `El proyecto ${projectSlug} no tiene sectionId de TestRail configurado y no se envió uno en la petición`,
      );
      return;
    }

    const appSlug = cfg.slug;
    const all = loadScenarios(appSlug, req.params.recordingId);
    if (all.length === 0) {
      sendError(res, 404, "NO_SCENARIOS", "La grabación no tiene escenarios generados");
      return;
    }
    const requested: string[] | undefined = Array.isArray(body.scenarioIds)
      ? body.scenarioIds.filter((s: unknown): s is string => typeof s === "string")
      : undefined;
    const selected = requested ? all.filter((s) => requested.includes(s.scenarioId)) : all;
    if (selected.length === 0) {
      sendError(res, 400, "NO_SCENARIOS_SELECTED", "Ninguno de los escenarios indicados existe en la grabación");
      return;
    }

    const recordingTrace = loadTrace(cfg.slug, req.params.recordingId);
    const semanticModel = recordingTrace ? buildSemanticRecordingModel(recordingTrace) : undefined;
    const datasetValues: Record<string, string | undefined> = body.datasetValues && typeof body.datasetValues === "object"
      ? Object.fromEntries(Object.entries(body.datasetValues).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
      : {};
    const materializedSelected = selected.map((scenario) => applyRuntimeDatasetValues(
      semanticModel ? hydrateCanonicalInteractionsFromSemanticModel(scenario, semanticModel) : scenario,
      datasetValues,
    ));
    const missingInputs = materializedSelected.flatMap((scenario) => (scenario.readiness?.missingInputs
      ?? scenario.runtimeInputRequirements?.filter((requirement) => requirement.required && !requirement.resolved)
      ?? [])).map((requirement) => ({
        valueKey: requirement.valueKey,
        semanticField: requirement.semanticField,
        entityScope: requirement.entityScope,
      }));
    if (missingInputs.length > 0) {
      res.status(409).json({
        ok: false,
        error: "MISSING_RUNTIME_INPUTS",
        errorCode: "MISSING_RUNTIME_INPUTS",
        message: "No se puede publicar: faltan datos requeridos del escenario.",
        missingInputs,
      });
      return;
    }
    const publicationBlocked = materializedSelected.filter((scenario) => scenario.readiness?.publicationReadiness !== true);
    if (publicationBlocked.length > 0) {
      res.status(409).json({
        ok: false,
        error: "PUBLICATION_NOT_READY",
        errorCode: "PUBLICATION_NOT_READY",
        message: "No se puede publicar: el escenario requiere revisión de oracle/publicación.",
        missingInputs: [],
        scenarios: publicationBlocked.map((scenario) => ({ scenarioId: scenario.scenarioId, oracleAuthority: scenario.oracleAuthority ?? "review_required" })),
      });
      return;
    }

    const recordingId = req.params.recordingId;
    let outcome: RecordingTestRailPublishOutcome;
    try {
      outcome = await publishRecordingScenariosToTestRail({
        appSlug,
        recordingId,
        destination: { projectId, suiteId, sectionId },
        scenarios: materializedSelected,
        datasetValues,
        recordingDataPolicy: recordingTrace?.recordingDataPolicy,
      });
    } catch (err) {
      if (err instanceof RecordingTestRailPublishError) {
        const status = err.code === "SECTION_NOT_FOUND" ? 404 : 400;
        sendError(res, status, err.code, err.message);
        return;
      }
      throw err;
    }
    const { effectiveProjectId, effectiveSuiteId, sectionName, created, reconciledCreated, failed, skippedAlreadyPublished, publishResult } = outcome;

    // Record the TestRail identity (and the destination it was created in, so a later run can
    // tell a case that belongs here apart from one filed under a different destination) on the
    // scenario so a later run can also report results back.
    const updated = all.map((s) => {
      const hit = [...created, ...reconciledCreated].find((c) => c.scenarioId === s.scenarioId);
      const withDataset = applyRuntimeDatasetValues(s, datasetValues);
      return hit
        ? { ...withDataset, testRailCaseId: hit.caseId, testRailDestination: { projectId: String(effectiveProjectId), suiteId: effectiveSuiteId ? String(effectiveSuiteId) : undefined, sectionId } }
        : withDataset;
    });
    saveScenarios(appSlug, recordingId, updated as RecordedScenario[]);

    const partial = failed.length > 0 && (created.length > 0 || reconciledCreated.length > 0 || skippedAlreadyPublished.length > 0);
    const publishedTotal = created.length + reconciledCreated.length + skippedAlreadyPublished.length;
    console.log(`[recordings:testrail] recording=${recordingId} publicadosTotales=${publishedTotal} creados=${created.length} reconciliados=${reconciledCreated.length} reutilizados=${skippedAlreadyPublished.length}`);
    res.status(failed.length > 0 && created.length === 0 && reconciledCreated.length === 0 && skippedAlreadyPublished.length === 0 ? 502 : 200).json({
      ok: failed.length === 0,
      partial,
      requested: selected.length,
      attempted: publishResult ? publishResult.mappings.length + publishResult.failed.length : created.length + failed.length,
      publishedTotal,
      reconciledCount: reconciledCreated.length,
      sectionId,
      sectionName,
      projectId: String(effectiveProjectId),
      suiteId: effectiveSuiteId ? String(effectiveSuiteId) : undefined,
      created,
      reconciledCreated,
      failed,
      skippedAlreadyPublished,
      publisherFailures: publishResult?.failed ?? [],
      ambiguousDuplicates: publishResult?.ambiguousDuplicates ?? [],
      ambiguousUnresolved: publishResult?.ambiguousUnresolved ?? [],
    });
  } catch (err) {
    handle(res, err);
  }
});

// DELETE /api/recordings/:recordingId — removes the trace, scenarios and any leftover frames.
recordingsRouter.delete("/:recordingId", async (req, res) => {
  try {
    const projectSlug = String(req.query.projectSlug ?? "").trim();
    if (!projectSlug) {
      sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
      return;
    }
    if (getActiveRecording(req.params.recordingId)) {
      sendError(res, 409, "RECORDING_ACTIVE", "Detén la grabación antes de eliminarla");
      return;
    }
    const appSlug = await appSlugFor(projectSlug);
    const removed = deleteRecording(appSlug, req.params.recordingId);
    res.status(removed ? 200 : 404).json({ ok: removed });
  } catch (err) {
    handle(res, err);
  }
});
