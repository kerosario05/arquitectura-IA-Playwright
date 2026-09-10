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
} from "../../recording/recording-store";
import {
  RecordingError,
  deriveScenarios,
  getActiveRecording,
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
import type { RecordedScenario } from "../../recording/trace-to-scenario";

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
          : 400;
    sendError(res, status, err.code, err.message);
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[recordings] error=${message}`);
  sendError(res, 500, "RECORDING_FAILED", message);
}

/** Resolves the app slug a recording lives under, from the project it belongs to. */
async function appSlugFor(projectSlug: string): Promise<string> {
  const target = await resolveRecordingTarget(projectSlug);
  return target.appSlug;
}

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
    const result = await startRecording({
      projectSlug,
      label: typeof body.label === "string" ? body.label.trim() || undefined : undefined,
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
    res.json({ ok: true, scenarios: loadScenarios(appSlug, req.params.recordingId) });
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
    saveScenarios(appSlug, req.params.recordingId, body.scenarios as RecordedScenario[]);
    res.json({ ok: true, scenarios: loadScenarios(appSlug, req.params.recordingId) });
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

    const client = new TestRailClient(requireTestRailConfig(config));

    /**
     * Confirms the section really lives under the project that was chosen.
     *
     * A section id and a project id arrive from two different places — the picker and the
     * project's stored configuration — and nothing stops them from disagreeing after either
     * is edited. Publishing on a mismatch files the cases in another team's project, which
     * nobody notices until they are already there.
     *
     * A lookup that fails (TestRail down, rate limited) does not block the publish: it proves
     * nothing either way, and the caller asked for a section by id.
     */
    let sectionName: string | undefined;
    let sectionProjectId: number | undefined;
    let sectionSuiteId: number | undefined;
    try {
      const section = await client.getSection(Number(sectionId));
      if (!section) {
        sendError(res, 404, "SECTION_NOT_FOUND", `La sección ${sectionId} no existe en TestRail`);
        return;
      }
      sectionName = section.name;
      sectionProjectId = section.project_id;
      sectionSuiteId = section.suite_id;
      if (projectId && section.project_id !== undefined && String(section.project_id) !== projectId) {
        sendError(
          res,
          400,
          "SECTION_NOT_IN_PROJECT",
          `La sección ${sectionId} ("${section.name}") pertenece al proyecto ${section.project_id} de TestRail, no al ${projectId}`,
        );
        return;
      }
      if (suiteId && section.suite_id !== undefined && String(section.suite_id) !== suiteId) {
        sendError(
          res,
          400,
          "SECTION_NOT_IN_SUITE",
          `La sección ${sectionId} ("${section.name}") pertenece a la suite ${section.suite_id}, no a la ${suiteId}`,
        );
        return;
      }
    } catch (err) {
      console.log(
        `[recordings:testrail] no se pudo validar la sección ${sectionId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // The publisher needs the project, and a section knows which one it belongs to — so a
    // caller that only ever had a section id still gets a valid publish.
    const effectiveProjectId = Number(projectId || sectionProjectId || 0);
    if (!effectiveProjectId) {
      sendError(
        res,
        400,
        "MISSING_PROJECT",
        `No se pudo determinar el proyecto de TestRail para la sección ${sectionId}: envía projectId o configúralo en el proyecto`,
      );
      return;
    }
    const effectiveSuiteId = Number(suiteId || sectionSuiteId || 0) || undefined;

    /**
     * Publishing goes through the shared publisher, not through `addCase` directly.
     *
     * A bare `addCase` sends only what it is handed, and this TestRail requires four fields on
     * every case (`custom_expected`, `custom_case_oracle`, `custom_preconds`, `custom_steps`) —
     * which is why a direct call had every case rejected while the scenario-generation flow
     * published fine. The publisher fills them, and brings what a second implementation would
     * otherwise have to grow again: retries with reduced payloads, recovery from a TestRail 500
     * that created the case anyway, and de-duplication so re-publishing a recording updates its
     * cases instead of piling up copies.
     *
     * The scenario ids are derived from the recording, so each case carries a
     * `custom_scenario_id` that points back at the walkthrough it came from.
     */
    const recordingId = req.params.recordingId;
    const cacheKey = `recording-${recordingId}`;
    const publishable = selected.map((scenario) => toPublishableScenario(scenario, appSlug, recordingId));
    const publishIdOf = (index: number) =>
      buildScenarioPreviewScenarioId(publishable[index], index, { launchId: recordingId });

    let mappings: ScenarioPreviewCaseMapping[] = [];
    let publishError: string | undefined;
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
      } as ScenarioPreviewPublishContext);
      mappings = result.mappings;
      console.log(
        `[recordings:testrail] recording=${recordingId} creados=${result.created} actualizados=${result.updated} reutilizados=${result.reused}`,
      );
    } catch (err) {
      // The publisher stops at the first case it cannot create even after its retries. What it
      // already published is persisted, so it is read back rather than reported as lost.
      publishError = err instanceof Error ? err.message : String(err);
      mappings = readPersistedScenarioMappings().filter(
        (m) => m.cacheKey === cacheKey && m.sectionId === Number(sectionId),
      );
      console.log(`[recordings:testrail] publicación interrumpida recording=${recordingId}: ${publishError}`);
    }

    const byPublishId = new Map(mappings.map((m) => [m.scenarioId, m]));
    const created: Array<{ scenarioId: string; caseId: number; title: string }> = [];
    const failed: Array<{ scenarioId: string; message: string }> = [];
    selected.forEach((scenario, index) => {
      const mapping = byPublishId.get(publishIdOf(index));
      if (mapping) {
        created.push({ scenarioId: scenario.scenarioId, caseId: mapping.testRailCaseId, title: scenario.title });
      } else {
        failed.push({
          scenarioId: scenario.scenarioId,
          message: publishError ?? "TestRail no devolvió un caso para este escenario",
        });
      }
    });

    // Record the TestRail identity on the scenario so a later run can report results back.
    const updated = all.map((s) => {
      const hit = created.find((c) => c.scenarioId === s.scenarioId);
      return hit ? { ...s, testRailCaseId: hit.caseId } : s;
    });
    saveScenarios(appSlug, recordingId, updated as RecordedScenario[]);

    res.status(failed.length > 0 && created.length === 0 ? 502 : 200).json({
      ok: created.length > 0,
      sectionId,
      sectionName,
      projectId: String(effectiveProjectId),
      suiteId: effectiveSuiteId ? String(effectiveSuiteId) : undefined,
      created,
      failed,
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
