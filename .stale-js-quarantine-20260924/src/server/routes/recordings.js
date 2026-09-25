"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.recordingsRouter = void 0;
const express_1 = require("express");
const env_1 = require("../../config/env");
const testrail_client_1 = require("../../clients/testrail.client");
const project_reader_1 = require("../../db/project-reader");
const recording_store_1 = require("../../recording/recording-store");
const session_recording_runner_1 = require("../jobs/session-recording-runner");
const testrail_case_publisher_1 = require("../services/testrail-case-publisher");
const testrail_sync_types_1 = require("../services/testrail-sync-types");
const scenario_to_testrail_1 = require("../../recording/scenario-to-testrail");
const trace_to_scenario_1 = require("../../recording/trace-to-scenario");
const semantic_recording_1 = require("../../recording/semantic-recording");
const canonical_recording_contract_1 = require("../../recording/canonical-recording-contract");
const persisted_scenario_hydration_1 = require("../../recording/persisted-scenario-hydration");
const job_store_1 = require("../jobs/job-store");
const scenario_preview_runner_1 = require("../jobs/scenario-preview-runner");
const replay_admission_1 = require("../services/replay-admission");
exports.recordingsRouter = (0, express_1.Router)();
/**
 * Recorded exploration sessions.
 *
 * Every route is addressed by the PROJECT, never by a hand-typed app slug or package: the
 * project's configuration is what decides which application gets recorded, which is the
 * whole reason the flow starts by picking one. A recording therefore cannot drift onto an
 * app the project does not own.
 */
function sendError(res, status, code, message) {
    res.status(status).json({ ok: false, error: code, errorCode: code, message });
}
function handle(res, err) {
    if (err instanceof session_recording_runner_1.RecordingError) {
        const status = err.code === "PROJECT_NOT_FOUND" || err.code === "RECORDING_NOT_FOUND"
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
async function appSlugFor(projectSlug) {
    const target = await (0, session_recording_runner_1.resolveRecordingTarget)(projectSlug);
    return target.appSlug;
}
function readRecordingScenarios(appSlug, recordingId) {
    return (0, persisted_scenario_hydration_1.hydratePersistedScenarios)((0, recording_store_1.loadScenarios)(appSlug, recordingId), (0, recording_store_1.loadSemanticRecording)(appSlug, recordingId));
}
// GET /api/recordings?projectSlug=slug — recordings already captured for a project.
exports.recordingsRouter.get("/", async (req, res) => {
    try {
        const projectSlug = String(req.query.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        const appSlug = await appSlugFor(projectSlug);
        res.json({ ok: true, projectSlug, appSlug, recordings: (0, recording_store_1.listRecordings)(appSlug) });
    }
    catch (err) {
        handle(res, err);
    }
});
// POST /api/recordings/start — opens the app (or the browser) and begins observing.
exports.recordingsRouter.post("/start", async (req, res) => {
    try {
        const body = req.body ?? {};
        const projectSlug = String(body.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        console.log(`[recordings:goal-lineage] proxyGoal=${JSON.stringify(typeof body.recordingGoal === "string" ? body.recordingGoal : undefined)} label=${JSON.stringify(typeof body.label === "string" ? body.label : undefined)}`);
        const result = await (0, session_recording_runner_1.startRecording)({
            projectSlug,
            label: typeof body.label === "string" ? body.label.trim() || undefined : undefined,
            recordingGoal: typeof body.recordingGoal === "string" ? body.recordingGoal.trim() || undefined : undefined,
            recordingDataPolicy: body.recordingDataPolicy && typeof body.recordingDataPolicy === "object"
                ? {
                    persistRecordedValues: body.recordingDataPolicy.persistRecordedValues === true,
                    // Accepted for legacy request compatibility; normalization enforces the current
                    // Recording invariant server-side.
                    persistQaCredentials: true,
                    includeQaCredentialsInTestRail: true,
                }
                : undefined,
            avdName: typeof body.avdName === "string" ? body.avdName : undefined,
            headless: typeof body.headless === "boolean" ? body.headless : undefined,
            sensitiveLabels: Array.isArray(body.sensitiveLabels)
                ? body.sensitiveLabels.filter((s) => typeof s === "string")
                : undefined,
        });
        res.status(202).json({ ok: true, ...result });
    }
    catch (err) {
        handle(res, err);
    }
});
// GET /api/recordings/:recordingId — live progress while recording, stored summary after.
exports.recordingsRouter.get("/:recordingId", async (req, res) => {
    try {
        const { recordingId } = req.params;
        const live = (0, session_recording_runner_1.recordingProgress)(recordingId);
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
        const trace = (0, recording_store_1.loadTrace)(appSlug, recordingId);
        if (!trace) {
            sendError(res, 404, "RECORDING_NOT_FOUND", `No se encontró la grabación ${recordingId}`);
            return;
        }
        res.json({
            ok: true,
            active: false,
            summary: (0, recording_store_1.toSummary)(trace, (0, recording_store_1.loadScenarios)(appSlug, recordingId).length),
        });
    }
    catch (err) {
        handle(res, err);
    }
});
// POST /api/recordings/:recordingId/stop — ends the walkthrough and persists the trace.
exports.recordingsRouter.post("/:recordingId/stop", async (req, res) => {
    try {
        const summary = await (0, session_recording_runner_1.stopRecording)(req.params.recordingId);
        res.json({ ok: true, summary });
    }
    catch (err) {
        handle(res, err);
    }
});
// POST /api/recordings/:recordingId/derive — builds the scenarios and destroys the frames.
exports.recordingsRouter.post("/:recordingId/derive", async (req, res) => {
    try {
        const body = req.body ?? {};
        const projectSlug = String(body.projectSlug ?? req.query.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        const appSlug = await appSlugFor(projectSlug);
        const result = await (0, session_recording_runner_1.deriveScenarios)(appSlug, req.params.recordingId, {
            title: typeof body.title === "string" ? body.title : undefined,
        });
        res.json({ ok: true, ...result });
    }
    catch (err) {
        handle(res, err);
    }
});
// GET /api/recordings/:recordingId/scenarios — what the recording produced.
exports.recordingsRouter.get("/:recordingId/scenarios", async (req, res) => {
    try {
        const projectSlug = String(req.query.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        const appSlug = await appSlugFor(projectSlug);
        const trace = (0, recording_store_1.loadTrace)(appSlug, req.params.recordingId);
        const scenarios = readRecordingScenarios(appSlug, req.params.recordingId);
        res.json({
            ok: true,
            scenarios,
            lifecycle: {
                recordingExists: Boolean(trace),
                traceReady: Boolean(trace && ["stopped", "derived"].includes(trace.status)),
                semanticReady: Boolean((0, recording_store_1.loadSemanticRecording)(appSlug, req.params.recordingId)),
                scenariosReady: scenarios.length > 0,
            },
        });
    }
    catch (err) {
        handle(res, err);
    }
});
// Small command used by the QA Lab for one scenario value. The large read model is never
// required to persist a single edit.
exports.recordingsRouter.put("/:recordingId/scenario-value", async (req, res) => {
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
        const trace = (0, recording_store_1.loadTrace)(appSlug, req.params.recordingId);
        if (!trace) {
            sendError(res, 404, "RECORDING_NOT_FOUND", "La grabación indicada no existe");
            return;
        }
        if (!(0, recording_store_1.loadSemanticRecording)(appSlug, req.params.recordingId)) {
            sendError(res, 409, "SEMANTIC_NOT_READY", "La grabación tiene trace, pero todavía no tiene base semántica materializada");
            return;
        }
        const scenarios = (0, recording_store_1.loadScenarios)(appSlug, req.params.recordingId);
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
        const hydrated = (0, canonical_recording_contract_1.hydrateCanonicalInteractionsFromSemanticModel)(current, (0, semantic_recording_1.buildSemanticRecordingModel)(trace));
        const updated = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(hydrated, { [valueKey]: body.value });
        (0, recording_store_1.saveScenarios)(appSlug, req.params.recordingId, scenarios.map((scenario) => scenario.scenarioId === scenarioId ? updated : scenario));
        res.json({ ok: true, scenario: updated });
    }
    catch (err) {
        handle(res, err);
    }
});
// GET /api/recordings/:recordingId/trace — the full trace plus the distilled narrative.
exports.recordingsRouter.get("/:recordingId/trace", async (req, res) => {
    try {
        const projectSlug = String(req.query.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        const appSlug = await appSlugFor(projectSlug);
        const trace = (0, recording_store_1.loadTrace)(appSlug, req.params.recordingId);
        if (!trace) {
            sendError(res, 404, "RECORDING_NOT_FOUND", `No se encontró la grabación ${req.params.recordingId}`);
            return;
        }
        res.json({ ok: true, trace });
    }
    catch (err) {
        handle(res, err);
    }
});
// GET /api/recordings/:recordingId/semantic — derived semantic assets, separate from raw trace.
exports.recordingsRouter.get("/:recordingId/semantic", async (req, res) => {
    try {
        const projectSlug = String(req.query.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        const appSlug = await appSlugFor(projectSlug);
        const trace = (0, recording_store_1.loadTrace)(appSlug, req.params.recordingId);
        if (!trace) {
            sendError(res, 404, "RECORDING_NOT_FOUND", "La grabación indicada no existe");
            return;
        }
        const model = (0, recording_store_1.loadSemanticRecording)(appSlug, req.params.recordingId);
        if (!model) {
            sendError(res, 409, trace.status === "recording" || trace.status === "starting" ? "TRACE_NOT_READY" : "SEMANTIC_NOT_READY", trace.status === "recording" || trace.status === "starting"
                ? "La grabación todavía está activa y no tiene un trace semántico detenido"
                : "La grabación tiene trace, pero todavía no tiene base semántica materializada");
            return;
        }
        res.json({ ok: true, model });
    }
    catch (err) {
        handle(res, err);
    }
});
// PUT /api/recordings/:recordingId/scenarios — persists reviewer edits before publishing.
exports.recordingsRouter.put("/:recordingId/scenarios", async (req, res) => {
    try {
        const body = req.body ?? {};
        const projectSlug = String(body.projectSlug ?? "").trim();
        if (!projectSlug || !Array.isArray(body.scenarios)) {
            sendError(res, 400, "INVALID_REQUEST", "projectSlug y scenarios son obligatorios");
            return;
        }
        const appSlug = await appSlugFor(projectSlug);
        const datasetValues = body.datasetValues && typeof body.datasetValues === "object"
            ? Object.fromEntries(Object.entries(body.datasetValues).filter((entry) => typeof entry[1] === "string"))
            : {};
        const scenarioDatasetValues = body.scenarioDatasetValues && typeof body.scenarioDatasetValues === "object"
            ? Object.fromEntries(Object.entries(body.scenarioDatasetValues).flatMap(([scenarioId, values]) => {
                if (!values || typeof values !== "object")
                    return [];
                return [[scenarioId, Object.fromEntries(Object.entries(values).filter((entry) => typeof entry[1] === "string"))]];
            }))
            : {};
        const incoming = body.scenarios;
        (0, recording_store_1.saveScenarios)(appSlug, req.params.recordingId, incoming.map((scenario) => (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(scenario, scenarioDatasetValues[scenario.scenarioId] ?? datasetValues)));
        res.json({ ok: true, scenarios: readRecordingScenarios(appSlug, req.params.recordingId) });
    }
    catch (err) {
        handle(res, err);
    }
});
// POST /api/recordings/:recordingId/execute — Recording enters the shared MCP core here.
// The route only adapts the recorded contract; it never creates a Recording-specific runner.
exports.recordingsRouter.post("/:recordingId/execute", async (req, res) => {
    try {
        const body = req.body ?? {};
        const projectSlug = String(body.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        const appSlug = await appSlugFor(projectSlug);
        const trace = (0, recording_store_1.loadTrace)(appSlug, req.params.recordingId);
        if (!trace) {
            sendError(res, 404, "RECORDING_NOT_FOUND", "La grabación indicada no existe");
            return;
        }
        if (!["stopped", "derived"].includes(trace.status)) {
            sendError(res, 409, "TRACE_NOT_READY", "La grabación todavía no tiene un trace detenido");
            return;
        }
        if (!(0, recording_store_1.loadSemanticRecording)(appSlug, req.params.recordingId)) {
            sendError(res, 409, "SEMANTIC_NOT_READY", "La grabación todavía no tiene base semántica materializada");
            return;
        }
        const all = (0, recording_store_1.loadScenarios)(appSlug, req.params.recordingId);
        if (all.length === 0) {
            sendError(res, 409, "SCENARIO_NOT_READY", "La grabación todavía no tiene escenarios materializados");
            return;
        }
        const requestedValues = Array.isArray(body.scenarioIds)
            ? body.scenarioIds
            : typeof body.scenarioId === "string"
                ? [body.scenarioId]
                : undefined;
        const requested = requestedValues?.filter((value) => typeof value === "string" && value.trim().length > 0);
        const selected = requested ? all.filter((scenario) => requested.includes(scenario.scenarioId)) : all;
        if (selected.length === 0) {
            sendError(res, 400, "NO_SCENARIOS_SELECTED", "Ninguno de los escenarios indicados existe en la grabación");
            return;
        }
        const values = body.datasetValues && typeof body.datasetValues === "object"
            ? Object.fromEntries(Object.entries(body.datasetValues).filter((entry) => typeof entry[1] === "string"))
            : {};
        // Legacy clients send per-scenario step-index overrides. Translate them into the single
        // dataset authority without allowing one scenario to leak values into another entity.
        if (body.dataOverrides && typeof body.dataOverrides === "object") {
            for (const scenario of selected) {
                const overrides = body.dataOverrides[scenario.scenarioId];
                if (!overrides || typeof overrides !== "object")
                    continue;
                for (const field of scenario.requiredData) {
                    const value = overrides[String(field.stepIndex)];
                    const sameStepFields = scenario.requiredData.filter((candidate) => candidate.stepIndex === field.stepIndex);
                    // A legacy step-index payload is ambiguous when cloned entity blocks share an
                    // index. Refuse to guess; the canonical dataset payload must name each valueKey.
                    if (sameStepFields.length === 1 && typeof value === "string" && values[field.key] === undefined)
                        values[field.key] = value;
                }
            }
        }
        console.log(`[recordings:execute] recording=${req.params.recordingId} requestedScenarioIds=${JSON.stringify(requested ?? all.map((scenario) => scenario.scenarioId))} requestedCount=${requested?.length ?? all.length}`);
        const semanticModel = (0, semantic_recording_1.buildSemanticRecordingModel)(trace);
        const materialized = selected.map((scenario) => (0, canonical_recording_contract_1.applyRuntimeDatasetValues)((0, canonical_recording_contract_1.hydrateCanonicalInteractionsFromSemanticModel)(scenario, semanticModel), values));
        const contracts = materialized.map((scenario) => (0, canonical_recording_contract_1.toSharedMcpScenario)(scenario, appSlug, values));
        const evaluatedRejectedScenarios = contracts.flatMap((contract) => {
            if (typeof contract.scenarioId !== "string")
                return [];
            const scenario = materialized.find((candidate) => candidate.scenarioId === contract.scenarioId);
            const reasons = [
                ...(scenario?.readiness?.missingInputs ?? []).map((input) => `missing_runtime_input:${input.valueKey}`),
                ...(scenario?.readiness?.datasetAuthorityMismatches ?? []).map(() => "dataset_authority_mismatch"),
                ...(contract.mcpExecutable ? [] : [contract.nonExecutableCriteria || "execution_not_ready"]),
            ];
            return reasons.length > 0 ? [{ scenarioId: contract.scenarioId, reasons }] : [];
        });
        const requestedScenarioIds = requested ?? all.map((scenario) => scenario.scenarioId);
        const requestedSet = new Set(requestedScenarioIds);
        const nonRequestedRejectedCandidates = all
            .filter((scenario) => !requestedSet.has(scenario.scenarioId))
            .flatMap((scenario) => {
            const reason = scenario.quality?.finalDecision === "rejected"
                ? scenario.quality.rejectionReason
                : scenario.mutationDiagnostics?.rejectionReason;
            return reason ? [{ scenarioId: scenario.scenarioId, reasons: [reason] }] : [];
        });
        const admission = (0, replay_admission_1.resolveReplayAdmission)({
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
        console.log(`[recordings:execute] recording=${req.params.recordingId} acceptedScenarioIds=${JSON.stringify(executableContracts.map((contract) => contract.scenarioId))} acceptedCount=${admission.acceptedCount} requestedRejectedCount=${admission.requestedRejectedCount} nonRequestedRejectedCandidateCount=${admission.nonRequestedRejectedCandidates.length}`);
        if (executableContracts.length === 0) {
            res.status(409).json({
                ok: false,
                error: "EXECUTION_NOT_READY",
                errorCode: "EXECUTION_NOT_READY",
                message: "Ningún escenario seleccionado está listo para ejecución.",
                ...admission,
                rejectedScenarios: admission.requestedRejectedScenarios,
                blocked: admission.requestedRejectedScenarios,
                unresolvedRequestedScenarioIds,
            });
            return;
        }
        // Executing a selected subset must not collapse the persisted catalog to that subset.
        // Keep unselected scenarios durable while replacing only the contracts that were
        // rehydrated/materialized for this execution.
        const materializedByScenarioId = new Map(materialized.map((scenario) => [scenario.scenarioId, scenario]));
        (0, recording_store_1.saveScenarios)(appSlug, req.params.recordingId, all.map((scenario) => materializedByScenarioId.get(scenario.scenarioId) ?? scenario));
        const job = job_store_1.jobStore.create("scenario-preview", {
            appSlug,
            targetAppSlug: appSlug,
            scenarios: executableContracts,
            source: { projectKey: `REC-${req.params.recordingId}` },
            recordingId: req.params.recordingId,
            requestedScenarioIds,
            ...admission,
            rejectedScenarios: admission.requestedRejectedScenarios,
            options: { headed: false, autoPromote: false, autoPom: false },
        });
        setImmediate(() => (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id));
        res.status(202).json({
            ok: true,
            jobId: job.id,
            scenarioCount: executableContracts.length,
            ...admission,
            rejectedScenarios: admission.requestedRejectedScenarios,
            unresolvedRequestedScenarioIds,
            executionMode: "shared_mcp_core",
        });
    }
    catch (err) {
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
exports.recordingsRouter.post("/:recordingId/testrail", async (req, res) => {
    try {
        const body = req.body ?? {};
        const projectSlug = String(body.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        const cfg = await (0, project_reader_1.getProjectConfigurationBySlug)(projectSlug);
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
            sendError(res, 400, "MISSING_SECTION", `El proyecto ${projectSlug} no tiene sectionId de TestRail configurado y no se envió uno en la petición`);
            return;
        }
        const appSlug = cfg.slug;
        const all = (0, recording_store_1.loadScenarios)(appSlug, req.params.recordingId);
        if (all.length === 0) {
            sendError(res, 404, "NO_SCENARIOS", "La grabación no tiene escenarios generados");
            return;
        }
        const requested = Array.isArray(body.scenarioIds)
            ? body.scenarioIds.filter((s) => typeof s === "string")
            : undefined;
        const selected = requested ? all.filter((s) => requested.includes(s.scenarioId)) : all;
        if (selected.length === 0) {
            sendError(res, 400, "NO_SCENARIOS_SELECTED", "Ninguno de los escenarios indicados existe en la grabación");
            return;
        }
        const recordingTrace = (0, recording_store_1.loadTrace)(cfg.slug, req.params.recordingId);
        const semanticModel = recordingTrace ? (0, semantic_recording_1.buildSemanticRecordingModel)(recordingTrace) : undefined;
        const datasetValues = body.datasetValues && typeof body.datasetValues === "object"
            ? Object.fromEntries(Object.entries(body.datasetValues).filter((entry) => typeof entry[1] === "string"))
            : {};
        const materializedSelected = selected.map((scenario) => (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(semanticModel ? (0, canonical_recording_contract_1.hydrateCanonicalInteractionsFromSemanticModel)(scenario, semanticModel) : scenario, datasetValues));
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
        const client = new testrail_client_1.TestRailClient((0, env_1.requireTestRailConfig)(env_1.config));
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
        let sectionName;
        let sectionProjectId;
        let sectionSuiteId;
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
                sendError(res, 400, "SECTION_NOT_IN_PROJECT", `La sección ${sectionId} ("${section.name}") pertenece al proyecto ${section.project_id} de TestRail, no al ${projectId}`);
                return;
            }
            if (suiteId && section.suite_id !== undefined && String(section.suite_id) !== suiteId) {
                sendError(res, 400, "SECTION_NOT_IN_SUITE", `La sección ${sectionId} ("${section.name}") pertenece a la suite ${section.suite_id}, no a la ${suiteId}`);
                return;
            }
        }
        catch (err) {
            console.log(`[recordings:testrail] no se pudo validar la sección ${sectionId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        // The publisher needs the project, and a section knows which one it belongs to — so a
        // caller that only ever had a section id still gets a valid publish.
        const effectiveProjectId = Number(projectId || sectionProjectId || 0);
        if (!effectiveProjectId) {
            sendError(res, 400, "MISSING_PROJECT", `No se pudo determinar el proyecto de TestRail para la sección ${sectionId}: envía projectId o configúralo en el proyecto`);
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
         * The scenario identity is persisted in the server-side mapping store. A configured
         * TestRail custom field may be used by the shared publisher, but Recording does not invent
         * one for a template that does not expose it.
         */
        const recordingId = req.params.recordingId;
        const cacheKey = `recording-${recordingId}`;
        const publishable = materializedSelected.map((scenario) => (0, scenario_to_testrail_1.toPublishableScenario)((0, trace_to_scenario_1.materializeRecordedScenario)(scenario, datasetValues), appSlug, recordingId, recordingTrace?.recordingDataPolicy));
        const publishIdOf = (index) => (0, testrail_sync_types_1.buildScenarioPreviewScenarioId)(publishable[index], index, { launchId: recordingId });
        let mappings = [];
        let publishError;
        let publishResult;
        try {
            const result = await (0, testrail_case_publisher_1.publishScenariosToTestRail)(client, {
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
            });
            publishResult = result;
            mappings = result.mappings;
            console.log(`[recordings:testrail] recording=${recordingId} creados=${result.created} reconciliados=${result.reconciledCreated.length} actualizados=${result.updated} reutilizados=${result.reused}`);
        }
        catch (err) {
            // The publisher stops at the first case it cannot create even after its retries. What it
            // already published is persisted, so it is read back rather than reported as lost.
            publishError = err instanceof Error ? err.message : String(err);
            mappings = (0, testrail_case_publisher_1.readPersistedScenarioMappings)().filter((m) => m.cacheKey === cacheKey && m.sectionId === Number(sectionId));
            console.log(`[recordings:testrail] publicación interrumpida recording=${recordingId}: ${publishError}`);
        }
        const byPublishId = new Map(mappings.map((m) => [m.scenarioId, m]));
        const created = [];
        const reconciledCreated = [];
        const failed = [];
        const skippedAlreadyPublished = [];
        selected.forEach((scenario, index) => {
            const mapping = byPublishId.get(publishIdOf(index));
            const publisherFailure = publishResult?.failed.find((item) => item.scenarioId === publishIdOf(index));
            if (mapping) {
                if (mapping.source === "skipped_already_published") {
                    skippedAlreadyPublished.push({ scenarioId: scenario.scenarioId, caseId: mapping.testRailCaseId });
                }
                else if (mapping.source === "recovered_after_add_case_500") {
                    reconciledCreated.push({ scenarioId: scenario.scenarioId, caseId: mapping.testRailCaseId, title: scenario.title });
                }
                else {
                    created.push({ scenarioId: scenario.scenarioId, caseId: mapping.testRailCaseId, title: scenario.title });
                }
            }
            else {
                failed.push({
                    scenarioId: scenario.scenarioId,
                    message: publishError ?? "TestRail no devolvió un caso para este escenario",
                });
            }
        });
        // Record the TestRail identity on the scenario so a later run can report results back.
        const updated = all.map((s) => {
            const hit = [...created, ...reconciledCreated].find((c) => c.scenarioId === s.scenarioId);
            const withDataset = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(s, datasetValues);
            return hit ? { ...withDataset, testRailCaseId: hit.caseId } : withDataset;
        });
        (0, recording_store_1.saveScenarios)(appSlug, recordingId, updated);
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
    }
    catch (err) {
        handle(res, err);
    }
});
// DELETE /api/recordings/:recordingId — removes the trace, scenarios and any leftover frames.
exports.recordingsRouter.delete("/:recordingId", async (req, res) => {
    try {
        const projectSlug = String(req.query.projectSlug ?? "").trim();
        if (!projectSlug) {
            sendError(res, 400, "MISSING_PROJECT_SLUG", "projectSlug es obligatorio");
            return;
        }
        if ((0, session_recording_runner_1.getActiveRecording)(req.params.recordingId)) {
            sendError(res, 409, "RECORDING_ACTIVE", "Detén la grabación antes de eliminarla");
            return;
        }
        const appSlug = await appSlugFor(projectSlug);
        const removed = (0, recording_store_1.deleteRecording)(appSlug, req.params.recordingId);
        res.status(removed ? 200 : 404).json({ ok: removed });
    }
    catch (err) {
        handle(res, err);
    }
});
