"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runsRouter = void 0;
exports.resolveJobStoreSourceJobId = resolveJobStoreSourceJobId;
exports.extractLaunchScenariosFromPayload = extractLaunchScenariosFromPayload;
exports.extractExistingTestRailCaseIdsFromPayload = extractExistingTestRailCaseIdsFromPayload;
exports.buildRunStreamPayload = buildRunStreamPayload;
exports.resolveEvidenceDocxForJob = resolveEvidenceDocxForJob;
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const job_store_1 = require("../jobs/job-store");
const run_runner_1 = require("../jobs/run-runner");
const discovery_batch_runner_1 = require("../jobs/discovery-batch-runner");
const scenario_preview_runner_1 = require("../jobs/scenario-preview-runner");
const mobile_launch_execution_runner_1 = require("../jobs/mobile-launch-execution-runner");
const rerun_runner_1 = require("../jobs/rerun-runner");
const launch_orchestrator_1 = require("../jobs/launch-orchestrator");
const defect_checklist_store_1 = require("../services/defect-checklist-store");
exports.runsRouter = (0, express_1.Router)();
function resolveJobStoreSourceJobId(params) {
    return typeof params.sourceJobId === "string" && params.sourceJobId.length > 0 ? params.sourceJobId : "none";
}
const SENSITIVE_PATTERNS = [
    /delete\s+all/i,
    /drop\s+table/i,
    /truncate\s+table/i,
    /format\s+disk/i,
    /rm\s+-rf/i,
    /sudo\s+rm/i,
];
function containsSensitiveAction(steps) {
    return steps.some((step) => SENSITIVE_PATTERNS.some((p) => p.test(step)));
}
const TECHNICAL_SLUGS = new Set(["tests", "test", "api-tests", "api tests", "qa-tests", "qa tests", "default", "unknown", "undefined", "null"]);
function isTechnicalSlug(slug) {
    if (!slug)
        return true;
    return TECHNICAL_SLUGS.has(slug.trim().toLowerCase());
}
function normalizeMaybeSlug(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function inferTargetAppSlug(body) {
    const functionalAppSlug = normalizeMaybeSlug(body.functionalAppSlug);
    const scenarioTargetAppSlugs = Array.from(new Set((body.scenarios ?? [])
        .map((scenario) => normalizeMaybeSlug(scenario.targetAppSlug))
        .filter((slug) => Boolean(slug))));
    const titlesSample = (body.scenarios ?? [])
        .map((scenario) => scenario.title)
        .filter((title) => typeof title === "string" && title.trim().length > 0)
        .slice(0, 3);
    const requestTargetAppSlug = normalizeMaybeSlug(body.targetAppSlug);
    const requestAppSlug = normalizeMaybeSlug(body.appSlug);
    if (functionalAppSlug && !isTechnicalSlug(functionalAppSlug)) {
        return { effectiveTargetAppSlug: functionalAppSlug, scenarioTargetAppSlugs, titlesSample };
    }
    const scenarioTarget = scenarioTargetAppSlugs.find((slug) => !isTechnicalSlug(slug));
    if (scenarioTarget)
        return { effectiveTargetAppSlug: scenarioTarget, scenarioTargetAppSlugs, titlesSample };
    if (requestTargetAppSlug && !isTechnicalSlug(requestTargetAppSlug)) {
        return { effectiveTargetAppSlug: requestTargetAppSlug, scenarioTargetAppSlugs, titlesSample };
    }
    if (requestAppSlug && !isTechnicalSlug(requestAppSlug)) {
        return { effectiveTargetAppSlug: requestAppSlug, scenarioTargetAppSlugs, titlesSample };
    }
    return { scenarioTargetAppSlugs, titlesSample };
}
function toPositiveInt(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!/^\d+$/.test(trimmed))
            return undefined;
        const parsed = Number(trimmed);
        if (Number.isInteger(parsed) && parsed > 0)
            return parsed;
    }
    return undefined;
}
function extractCaseIdFromValue(value) {
    if (value == null)
        return undefined;
    if (typeof value === "object") {
        const record = value;
        const direct = [
            record.caseId,
            record.testRailCaseId,
            record.testrailCaseId,
            record.id,
            record.metadata?.caseId,
            record.metadata?.testRailCaseId,
        ];
        for (const candidate of direct) {
            const parsed = toPositiveInt(candidate);
            if (parsed)
                return parsed;
        }
        return undefined;
    }
    return toPositiveInt(value);
}
function normalizeStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}
function normalizeLaunchScenario(value, _fallbackPrefix, index) {
    if (!value || typeof value !== "object")
        return null;
    const record = value;
    const metadata = (record.metadata && typeof record.metadata === "object")
        ? record.metadata
        : undefined;
    const testRailCaseId = extractCaseIdFromValue(record);
    const rawScenarioId = typeof record.scenarioId === "string"
        ? record.scenarioId.trim()
        : typeof record.id === "string"
            ? record.id.trim()
            : "";
    const scenarioId = rawScenarioId || (testRailCaseId ? `TR-CASE-${testRailCaseId}` : "");
    const rawTitle = typeof record.title === "string" ? record.title.trim() : "";
    const title = rawTitle || (testRailCaseId ? `TestRail Case ${testRailCaseId}` : `Scenario ${index + 1}`);
    const scenario = {
        scenarioId,
        title,
        steps: normalizeStringArray(record.steps),
        expectedResult: typeof record.expectedResult === "string" ? record.expectedResult : "",
        preconditions: normalizeStringArray(record.preconditions),
        routeProfile: record.routeProfile,
        sourceIssueKey: typeof record.sourceIssueKey === "string" ? record.sourceIssueKey : undefined,
        testRailCaseId,
        metadata: (record.metadata && typeof record.metadata === "object") ? record.metadata : undefined,
        mcpExecutable: typeof record.mcpExecutable === "boolean" ? record.mcpExecutable : typeof metadata?.mcpExecutable === "boolean" ? metadata.mcpExecutable : undefined,
        executionReadiness: typeof record.executionReadiness === "string" ? record.executionReadiness : typeof metadata?.executionReadiness === "string" ? metadata.executionReadiness : undefined,
        semanticValidity: typeof record.semanticValidity === "string" ? record.semanticValidity : typeof metadata?.semanticValidity === "string" ? metadata.semanticValidity : undefined,
        automationType: typeof record.automationType === "string" ? record.automationType : typeof metadata?.automationType === "string" ? metadata.automationType : undefined,
        launchClassification: record.launchClassification === "standard" || record.launchClassification === "adaptive" || record.launchClassification === "nonAutomatable"
            ? record.launchClassification
            : undefined,
        publicationClassification: typeof record.publicationClassification === "string" ? record.publicationClassification : undefined,
        nonAutomatable: typeof record.nonAutomatable === "boolean" ? record.nonAutomatable : undefined,
        targetScreen: typeof record.targetScreen === "string" ? record.targetScreen : typeof metadata?.targetScreen === "string" ? metadata.targetScreen : undefined,
        actualChain: record.actualChain ?? metadata?.actualChain,
        requiredChain: record.requiredChain ?? metadata?.requiredChain,
        branchId: typeof record.branchId === "string" ? record.branchId : typeof metadata?.branchId === "string" ? metadata.branchId : undefined,
        functionalBranch: (record.functionalBranch ?? metadata?.functionalBranch),
        branchAssociation: (record.branchAssociation ?? metadata?.branchAssociation),
        requirementDependencies: Array.isArray(record.requirementDependencies) ? record.requirementDependencies : Array.isArray(metadata?.requirementDependencies) ? metadata.requirementDependencies : undefined,
        stepRequirementRefs: Array.isArray(record.stepRequirementRefs) ? record.stepRequirementRefs : Array.isArray(metadata?.stepRequirementRefs) ? metadata.stepRequirementRefs : undefined,
    };
    return scenario;
}
function collectCaseIdsFromArray(value) {
    if (!Array.isArray(value))
        return [];
    const ids = [];
    for (const item of value) {
        const parsed = extractCaseIdFromValue(item);
        if (parsed)
            ids.push(parsed);
    }
    return ids;
}
function extractLaunchScenariosFromPayload(body) {
    const dedup = new Map();
    const append = (items, fallbackPrefix) => {
        if (!Array.isArray(items))
            return;
        for (let i = 0; i < items.length; i++) {
            const normalized = normalizeLaunchScenario(items[i], fallbackPrefix, i);
            if (!normalized)
                continue;
            const key = normalized.testRailCaseId
                ? `case:${normalized.testRailCaseId}`
                : normalized.scenarioId
                    ? `scenario:${normalized.scenarioId.toLowerCase()}`
                    : `missing-id:${fallbackPrefix}:${i}`;
            if (!dedup.has(key)) {
                dedup.set(key, normalized);
            }
        }
    };
    append(body.selectedScenarios, "SELECTED");
    append(body.selectedGeneratedScenarios, "GENERATED");
    append(body.selectedJiraScenarios, "JIRA");
    append(body.generatedScenarios, "GENERATED");
    append(body.selectedTestRailCases, "TR-CASE");
    return Array.from(dedup.values());
}
function extractExistingTestRailCaseIdsFromPayload(body, selectedScenarios) {
    const ids = new Set();
    const sources = [
        body.existingTestRailCaseIds,
        body.selectedCaseIds,
        body.testRailCaseIds,
        body.caseIds,
        body.selectedTestRailCases,
        body.selectedScenarios,
    ];
    for (const source of sources) {
        for (const id of collectCaseIdsFromArray(source)) {
            ids.add(id);
        }
    }
    for (const scenario of selectedScenarios) {
        const caseId = extractCaseIdFromValue(scenario);
        if (caseId)
            ids.add(caseId);
    }
    return Array.from(ids);
}
function buildRunStreamPayload(job, terminal = false) {
    const payload = {
        status: job.status,
        summary: job.summary,
        currentCase: job.currentCase,
        currentCaseId: job.currentCaseId,
        currentCaseTitle: job.currentCaseTitle,
        startedAt: job.startedAt,
        issueKey: job.issueKey,
        checklistUrl: job.checklistUrl,
        defectCount: job.defectCount,
        ...(terminal ? {
            exitCode: job.exitCode,
            errorMessage: job.errorMessage ?? job.summary?.errorMessage,
            completedAt: job.completedAt,
            durationMs: job.durationMs,
        } : {}),
    };
    return payload;
}
exports.runsRouter.post("/scenario-preview", (req, res) => {
    const body = req.body;
    if (!body.scenarios || body.scenarios.length === 0) {
        res.status(400).json({
            ok: false,
            error: "invalid_preview_scenarios",
            message: "No hay escenarios válidos para ejecutar.",
        });
        return;
    }
    const validScenarios = body.scenarios.filter((s) => s.mcpExecutable === true && s.validation?.valid !== false);
    if (validScenarios.length === 0) {
        res.status(400).json({
            ok: false,
            error: "invalid_preview_scenarios",
            message: "No hay escenarios válidos para ejecutar.",
        });
        return;
    }
    for (const sc of validScenarios) {
        if (!sc.steps || sc.steps.length === 0) {
            res.status(400).json({
                ok: false,
                error: "invalid_preview_scenarios",
                message: `El escenario "${sc.sourceIssueKey}" no tiene steps.`,
            });
            return;
        }
        if (containsSensitiveAction(sc.steps)) {
            res.status(400).json({
                ok: false,
                error: "sensitive_action_blocked",
                message: `El escenario "${sc.sourceIssueKey}" contiene acciones sensibles no permitidas.`,
            });
            return;
        }
    }
    const inferred = inferTargetAppSlug({ ...body, scenarios: validScenarios });
    const inferredTargetAppSlug = inferred.effectiveTargetAppSlug;
    const inferredTargetAppName = body.targetAppName ?? validScenarios[0]?.targetAppName;
    if (!body.appSlug && !body.targetAppSlug) {
        res.status(400).json({
            ok: false,
            error: "invalid_preview_scenarios",
            message: "appSlug es requerido.",
        });
        return;
    }
    const requiresTestRailSync = body.publishToTestRail === true || body.createTestRun === true || body.reportResults === true;
    if (requiresTestRailSync) {
        if (!body.testrailProjectId || !body.testrailSuiteId || !body.testrailSectionId) {
            res.status(400).json({
                ok: false,
                error: "invalid_preview_scenarios",
                message: "projectId, suiteId y sectionId son requeridos para publicar y reportar en TestRail.",
            });
            return;
        }
    }
    const issueKey = (validScenarios[0]?.sourceIssueKey || body.source?.projectKey || body.jiraKey || "").trim();
    let checklistUrl;
    if (issueKey) {
        const list = defect_checklist_store_1.defectChecklistStore.getOrCreate(issueKey);
        checklistUrl = `/checklist/${list.urlSlug}`;
    }
    const jobPayload = {
        ...body,
        issueKey,
        checklistUrl,
        targetAppSlug: inferredTargetAppSlug,
        targetAppName: inferredTargetAppName,
    };
    console.log(`[scenario-preview] received sectionName="${body.sectionName ?? "(none)"}" sectionSlug="${body.sectionSlug ?? "(none)"}" sectionId="${body.sectionId ?? "(none)"}"`);
    // Log launch metadata sync forwarding
    const bodyAny = req.body;
    const launchId = bodyAny.launchId;
    const testRunIdVal = bodyAny.testRunId;
    const jiraKeyVal = bodyAny.jiraKey;
    const hasLaunchMeta = Boolean(launchId && testRunIdVal);
    if (hasLaunchMeta) {
        const rawPub = bodyAny.publishedCases;
        const pubCount = Array.isArray(rawPub) ? rawPub.length : 0;
        console.log(`[scenario-preview] received launch metadata launchId=${launchId} testRunId=${testRunIdVal} publishedCases=${pubCount} jiraKey=${jiraKeyVal ?? '—'}`);
    }
    const job = job_store_1.jobStore.create("scenario-preview", jobPayload);
    checklistUrl = checklistUrl ? `${checklistUrl}${checklistUrl.includes("?") ? "&" : "?"}jobId=${encodeURIComponent(job.id)}` : checklistUrl;
    if (issueKey) {
        job_store_1.jobStore.update(job.id, { issueKey, checklistUrl });
    }
    setImmediate(() => (0, scenario_preview_runner_1.startScenarioPreviewRun)(job.id));
    res.status(202).json({
        ok: true,
        jobId: job.id,
        issueKey,
        checklistUrl,
        status: job.status,
        mode: "scenario-preview",
        scenarioCount: validScenarios.length,
    });
});
exports.runsRouter.post("/discovery-batch", (req, res) => {
    const body = req.body;
    if (!body.caseIds || body.caseIds.length === 0) {
        res.status(400).json({ error: "caseIds is required and must be a non-empty array" });
        return;
    }
    const invalidIds = body.caseIds.filter((id) => !Number.isInteger(id) || id <= 0);
    if (invalidIds.length > 0) {
        res.status(400).json({ error: "All caseIds must be positive integers", invalidIds });
        return;
    }
    const job = job_store_1.jobStore.create("discovery-batch", body);
    console.log((0, discovery_batch_runner_1.buildRediscoveryProvenanceLine)({ boundary: "request", caseId: body.caseIds[0], value: body.forceRediscovery }));
    job_store_1.jobStore.appendLog(job.id, (0, discovery_batch_runner_1.buildRediscoveryProvenanceLine)({
        boundary: "job_store",
        jobId: job.id,
        value: job.params.forceRediscovery,
    }) + ` sourceJobId=${resolveJobStoreSourceJobId(job.params)}`);
    const checklistIdentity = (0, discovery_batch_runner_1.buildDiscoveryBatchChecklistIdentity)({
        jobId: job.id,
        launchId: body.launchId,
    });
    const checklist = defect_checklist_store_1.defectChecklistStore.getOrCreate(checklistIdentity);
    const checklistUrl = `/checklist/${checklist.urlSlug}?jobId=${encodeURIComponent(job.id)}`;
    const defectCount = checklist.defects.filter((defect) => defect.jobId === job.id).length;
    const issueKey = (0, discovery_batch_runner_1.resolveDiscoveryBatchIssueKeyMetadata)({
        jiraKey: body.jiraKey,
        publishedCases: body.publishedCases,
    });
    job_store_1.jobStore.update(job.id, {
        checklistUrl,
        defectCount,
        ...(issueKey ? { issueKey } : {}),
    });
    setImmediate(() => (0, discovery_batch_runner_1.startDiscoveryBatchRun)(job.id));
    res.status(202).json({
        jobId: job.id,
        status: job.status,
        checklistUrl,
        defectCount,
        ...(issueKey ? { issueKey } : {}),
    });
});
exports.runsRouter.post("/sprint", (req, res) => {
    const body = req.body;
    if (!body.projectKey) {
        res.status(400).json({ error: "projectKey is required" });
        return;
    }
    if (!body.activeSprint && !body.sprintId) {
        res.status(400).json({ error: "activeSprint: true or sprintId is required" });
        return;
    }
    const job = job_store_1.jobStore.create("sprint", body);
    setImmediate(() => (0, run_runner_1.startSprintRun)(job.id));
    res.status(202).json({ jobId: job.id, status: job.status });
});
exports.runsRouter.get("/", (_req, res) => {
    res.json({ jobs: job_store_1.jobStore.list() });
});
exports.runsRouter.get("/:jobId", (req, res) => {
    const job = job_store_1.jobStore.get(req.params.jobId);
    if (!job) {
        res.status(404).json({ error: "Job not found" });
        return;
    }
    res.json(job);
});
exports.runsRouter.get("/:jobId/logs", (req, res) => {
    const jobId = req.params.jobId;
    const current = job_store_1.jobStore.get(jobId);
    if (!current) {
        res.status(404).json({ error: "Job not found" });
        return;
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();
    // Prevent an unhandled 'error' event (e.g. writing after the client disconnected
    // mid-stream) from crashing the whole process — Node re-throws unhandled 'error'
    // events on EventEmitters, which takes down the server otherwise.
    res.on("error", (err) => {
        console.error(`[runs:logs] SSE write error jobId=${jobId}: ${err.message}`);
    });
    const send = (event, data) => {
        if (res.writableEnded)
            return;
        try {
            res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        }
        catch (err) {
            console.error(`[runs:logs] SSE write failed jobId=${jobId}: ${err instanceof Error ? err.message : err}`);
        }
    };
    // Replay buffered logs immediately
    for (const line of current.logs) {
        send("log", { line });
    }
    // If already finished, close right away
    if (current.status === "done" || current.status === "failed" || current.status === "cancelled") {
        send("done", buildRunStreamPayload({
            status: current.status,
            exitCode: current.exitCode,
            summary: current.summary,
            errorMessage: current.errorMessage,
            currentCase: current.currentCase,
            currentCaseId: current.currentCaseId,
            currentCaseTitle: current.currentCaseTitle,
            startedAt: current.startedAt,
            completedAt: current.completedAt,
            durationMs: current.durationMs,
            issueKey: current.issueKey,
            checklistUrl: current.checklistUrl,
            defectCount: current.defectCount,
        }, true));
        res.end();
        return;
    }
    if (current.status === "completed_with_failures" || current.status === "completed_with_sync_errors") {
        send("done", buildRunStreamPayload({
            status: current.status,
            exitCode: current.exitCode,
            summary: current.summary,
            errorMessage: current.errorMessage,
            currentCase: current.currentCase,
            currentCaseId: current.currentCaseId,
            currentCaseTitle: current.currentCaseTitle,
            startedAt: current.startedAt,
            completedAt: current.completedAt,
            durationMs: current.durationMs,
            issueKey: current.issueKey,
            checklistUrl: current.checklistUrl,
            defectCount: current.defectCount,
        }, true));
        res.end();
        return;
    }
    const unsubscribe = job_store_1.jobStore.subscribe(jobId, {
        onLog: (line) => send("log", { line }),
        onUpdate: (job) => {
            if (job.status === "done" || job.status === "failed" || job.status === "cancelled" || job.status === "completed_with_failures" || job.status === "completed_with_sync_errors") {
                send("done", buildRunStreamPayload({
                    status: job.status,
                    exitCode: job.exitCode,
                    summary: job.summary,
                    errorMessage: job.errorMessage,
                    currentCase: job.currentCase,
                    currentCaseId: job.currentCaseId,
                    currentCaseTitle: job.currentCaseTitle,
                    startedAt: job.startedAt,
                    completedAt: job.completedAt,
                    durationMs: job.durationMs,
                    issueKey: job.issueKey,
                    checklistUrl: job.checklistUrl,
                    defectCount: job.defectCount,
                }, true));
                unsubscribe();
                res.end();
            }
            else {
                send("status", buildRunStreamPayload({
                    status: job.status,
                    summary: job.summary,
                    currentCase: job.currentCase,
                    currentCaseId: job.currentCaseId,
                    currentCaseTitle: job.currentCaseTitle,
                    startedAt: job.startedAt,
                    issueKey: job.issueKey,
                    checklistUrl: job.checklistUrl,
                    defectCount: job.defectCount,
                }));
            }
        }
    });
    req.on("close", unsubscribe);
});
exports.runsRouter.post("/:jobId/rerun", async (req, res) => {
    const jobId = req.params.jobId;
    const mode = req.body?.mode === "failed_only" ? "failed_only" : "all";
    // 1. Check memory first
    const previous = job_store_1.jobStore.get(jobId);
    if (previous) {
        if (previous.status === "running" || previous.status === "queued") {
            res.status(400).json({ ok: false, error: "job_in_progress", message: `Cannot rerun job ${jobId}: status is ${previous.status}. Wait until it completes.` });
            return;
        }
    }
    const memoryJobMiss = !previous;
    // 2. Prepare rerun from canonical artifacts by job type.
    const prepared = (0, rerun_runner_1.prepareRerun)(jobId, mode, previous?.type);
    if (!prepared.ok) {
        // No in-memory job and no persisted source artifacts → explicit source-not-found error.
        if (memoryJobMiss && (prepared.error === "missing_preview_scenarios" || prepared.error === "missing_mobile_rerun_manifest")) {
            res.status(404).json({
                ok: false,
                error: "rerun_source_not_found",
                sourceJobId: jobId,
                message: prepared.message,
            });
            return;
        }
        if (prepared.error === "missing_preview_scenarios" || prepared.error === "missing_mobile_rerun_manifest") {
            res.status(404).json(prepared);
            return;
        }
        res.status(400).json(prepared);
        return;
    }
    console.log(`[runs:rerun] sourceResolution=${previous ? "memory" : "artifact"}`);
    console.log(`[runs:rerun] sourceJobId=${jobId} memoryJob=${!memoryJobMiss} artifactFallback=${memoryJobMiss} sourceJobType=${prepared.jobType}`);
    // Resolve issueKey: body > sourceJob > sourceJob.params > artifact > scenarios
    let issueKey = String(req.body?.issueKey || req.body?.jiraKey || "");
    if (!issueKey && previous) {
        issueKey = String(previous.issueKey || previous.params?.issueKey || previous.params?.jiraKey || "");
    }
    if (!issueKey) {
        // Try to infer from the first scenario in prepared.scenarios
        const firstSc = prepared.jobType === "scenario-preview"
            ? (Array.isArray(prepared.scenarios) ? prepared.scenarios[0] : null)
            : (Array.isArray(prepared.mobileParams.scenarios) ? prepared.mobileParams.scenarios[0] : null);
        if (firstSc) {
            issueKey = String(firstSc.sourceIssueKey || firstSc.issueKey || firstSc.jiraKey || firstSc.refs || "");
        }
    }
    const source = issueKey ? (req.body?.issueKey ? "body" : previous ? "sourceJob" : "artifact") : "missing";
    console.log(`[runs:rerun] resolved issueKey=${issueKey || "missing"} source=${source}`);
    // Build checklistUrl if issueKey resolved
    let checklistUrl;
    if (issueKey && issueKey !== "undefined" && issueKey !== "") {
        const { defectChecklistStore } = await Promise.resolve().then(() => __importStar(require("../services/defect-checklist-store")));
        const list = defectChecklistStore.getOrCreate(issueKey);
        checklistUrl = `/checklist/${list.urlSlug}`;
    }
    else {
        console.log(`[runs:rerun] warning missing_issue_key sourceJobId=${jobId}`);
    }
    // 4. Build new job payload
    let newPayload;
    if (prepared.jobType === "mobile-launch-execution") {
        newPayload = {
            ...prepared.mobileParams,
            sourceJobId: jobId,
            rerunMode: mode,
            rerun: true,
        };
    }
    else if (previous) {
        // Memory path: inherit all previous params
        const prevParams = previous.params;
        newPayload = {
            ...prevParams,
            scenarios: prepared.scenarios,
            sourceJobId: jobId,
            rerunMode: mode,
            rerun: true,
            issueKey,
            checklistUrl,
            sectionName: prevParams.sectionName,
            sectionSlug: prevParams.sectionSlug,
            publishToTestRail: prevParams.publishToTestRail ?? false,
            createTestRun: prevParams.createTestRun ?? false,
            reportResults: prevParams.reportResults ?? false,
        };
    }
    else {
        // Disk-only path: build payload from artifact metadata. Recover launch context
        // (launchId/testRunId/publishedCases) from the persisted launch manifest when present.
        const launchMeta = resolveLaunchContextForRerun(jobId, prepared);
        newPayload = {
            scenarios: prepared.scenarios,
            appSlug: prepared.appSlug,
            targetAppSlug: prepared.targetAppSlug,
            targetAppName: prepared.targetAppName,
            sourceJobId: jobId,
            rerunMode: mode,
            rerun: true,
            issueKey,
            checklistUrl,
            launchId: launchMeta?.launchId,
            testRunId: launchMeta?.testRunId,
            publishedCases: launchMeta?.publishedCases,
            sectionName: prepared.sectionName,
            sectionSlug: prepared.sectionSlug,
            publishToTestRail: false,
            createTestRun: false,
            reportResults: false,
            options: prepared.options ?? {
                overwrite: true,
                autoPromote: true,
                autoPom: true,
                rerunActive: true,
                headed: false,
            },
        };
    }
    const newJob = job_store_1.jobStore.create(prepared.jobType, newPayload);
    const scopedChecklistUrl = checklistUrl
        ? `${checklistUrl}${checklistUrl.includes("?") ? "&" : "?"}jobId=${encodeURIComponent(newJob.id)}`
        : checklistUrl;
    if (issueKey && issueKey !== "undefined" && issueKey !== "") {
        job_store_1.jobStore.update(newJob.id, { issueKey, checklistUrl: scopedChecklistUrl });
    }
    job_store_1.jobStore.appendLog(newJob.id, `[runs:rerun] sourceJobId=${jobId} mode=${mode} selected=${prepared.selectedCount} total=${prepared.totalCount}`);
    job_store_1.jobStore.appendLog(newJob.id, `[runs:rerun] newJobId=${newJob.id} issueKey=${issueKey || "?"} checklistUrl=${scopedChecklistUrl || "?"}`);
    job_store_1.jobStore.appendLog(newJob.id, `[runs:rerun] appSlug=${prepared.appSlug}`);
    job_store_1.jobStore.appendLog(newJob.id, `[runs:rerun] sourceJobType=${prepared.jobType}`);
    if (prepared.jobType === "mobile-launch-execution") {
        setImmediate(() => (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJob)(newJob.id));
    }
    else {
        setImmediate(() => (0, scenario_preview_runner_1.startScenarioPreviewRun)(newJob.id));
    }
    res.json({
        ok: true,
        jobId: newJob.id,
        status: newJob.status,
        issueKey,
        checklistUrl: scopedChecklistUrl,
        mode: "rerun",
        rerunMode: mode,
        scenarioCount: prepared.selectedCount,
        totalOriginal: prepared.totalCount,
        memoryJob: !!previous,
        artifactFallback: memoryJobMiss,
    });
});
exports.runsRouter.post("/launch-execution", async (req, res, next) => {
    try {
        const body = req.body;
        const requestHasContextOnly = Object.prototype.hasOwnProperty.call(body, "contextOnly");
        const requestContextOnly = body.contextOnly;
        console.log(`[context-only-trace] boundary=backend_route requestHasField=${requestHasContextOnly} requestValue=${requestContextOnly === undefined ? "undefined" : requestContextOnly} parsedValue=${requestContextOnly === undefined ? "undefined" : requestContextOnly}`);
        const appSlug = String(body.appSlug ?? "");
        const selectedScenarios = extractLaunchScenariosFromPayload(body);
        const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(body, selectedScenarios);
        console.log(`[launch-execution] received payload appSlug=${appSlug} scenarios=${selectedScenarios.length} existingCaseIds=${existingTestRailCaseIds.length} projectId=${body.projectId} sectionId=${body.sectionId}`);
        const launchInput = {
            appSlug: String(body.appSlug ?? ""),
            sectionSlug: body.sectionSlug,
            sectionName: body.sectionName,
            sectionId: body.sectionId,
            projectId: body.projectId ? Number(body.projectId) : undefined,
            suiteId: body.suiteId ? Number(body.suiteId) : undefined,
            testrailSectionId: body.testrailSectionId ? Number(body.testrailSectionId) : undefined,
            jiraKey: body.jiraKey,
            jiraTitle: (body.jiraTitle ?? body.storyTitle ?? body.huTitle),
            sprintName: body.sprintName,
            selectedScenarios,
            existingTestRailCaseIds,
            ...(Object.prototype.hasOwnProperty.call(body, "forceRediscovery")
                ? { forceRediscovery: body.forceRediscovery === true }
                : {}),
            ...(Object.prototype.hasOwnProperty.call(body, "overwrite")
                ? { overwrite: body.overwrite === true }
                : {}),
            contextOnly: body.contextOnly === true,
            ...(body.runtimeEntriesByCase && typeof body.runtimeEntriesByCase === "object" && !Array.isArray(body.runtimeEntriesByCase)
                ? { runtimeEntriesByCase: body.runtimeEntriesByCase }
                : {}),
            adaptiveScenarios: Array.isArray(body.adaptiveScenarios) ? body.adaptiveScenarios : undefined,
            publishStrategy: body.publishStrategy === "use_existing" ? "use_existing" : "always_create",
        };
        const result = await (0, launch_orchestrator_1.launchExecution)(launchInput);
        if (!result.ok) {
            console.log(`[launch-execution] failed error=${result.error} message=${result.message}`);
            res.status(400).json(result);
            return;
        }
        res.json(result);
    }
    catch (err) {
        next(err);
    }
});
exports.runsRouter.delete("/:jobId", (req, res) => {
    const internal = job_store_1.jobStore.getInternal(req.params.jobId);
    if (!internal) {
        res.status(404).json({ error: "Job not found" });
        return;
    }
    if (internal.status !== "running") {
        res.status(400).json({ error: `Cannot cancel a job in status: ${internal.status}` });
        return;
    }
    internal.process?.kill("SIGTERM");
    job_store_1.jobStore.update(req.params.jobId, {
        status: "cancelled",
        completedAt: new Date().toISOString()
    });
    res.json({ ok: true, jobId: req.params.jobId });
});
// ── TestRail result sync backfill — sync results from a completed launch to the TestRun ──
const LAUNCH_ARTIFACTS_DIR = path_1.default.resolve(__dirname, "..", "..", "..", ".artifacts", "scenario-launch-runs");
const PREVIEW_ARTIFACTS_DIR = path_1.default.resolve(__dirname, "..", "..", "..", ".artifacts", "scenario-preview-runs");
const EVIDENCE_ROOT_DIR = path_1.default.resolve(__dirname, "..", "..", "..", ".artifacts", "evidence");
// Rebuilds the minimal launch context for a rerun from persisted artifacts when the
// in-memory job is gone after a server restart. Scans the launch manifests for one that
// references the same source job or scenarios; returns undefined when nothing persisted.
function resolveLaunchContextForRerun(sourceJobId, prepared) {
    const sourceDir = path_1.default.join(PREVIEW_ARTIFACTS_DIR, sourceJobId);
    const sourceJobMetaPath = path_1.default.join(sourceDir, "job.json");
    let sourceJobMeta = null;
    try {
        if (fs_1.default.existsSync(sourceJobMetaPath)) {
            sourceJobMeta = JSON.parse(fs_1.default.readFileSync(sourceJobMetaPath, "utf-8"));
        }
    }
    catch {
        sourceJobMeta = null;
    }
    const sourceLaunchId = typeof sourceJobMeta?.launchId === "string" ? sourceJobMeta.launchId : undefined;
    if (sourceLaunchId) {
        const manifestPath = path_1.default.join(LAUNCH_ARTIFACTS_DIR, sourceLaunchId, "launch-manifest.json");
        try {
            if (fs_1.default.existsSync(manifestPath)) {
                const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
                return {
                    launchId: sourceLaunchId,
                    testRunId: typeof manifest.testRunId === "number" ? manifest.testRunId : typeof manifest.testRunId === "string" ? Number(manifest.testRunId) : undefined,
                    publishedCases: Array.isArray(manifest.publishedCases) ? manifest.publishedCases : undefined,
                };
            }
        }
        catch {
            // fall through to scan below
        }
    }
    // Fallback scan: find a launch manifest whose jobId/sourceJobId matches this source job.
    if (!fs_1.default.existsSync(LAUNCH_ARTIFACTS_DIR))
        return undefined;
    const launchIds = fs_1.default.readdirSync(LAUNCH_ARTIFACTS_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    for (const launchId of launchIds) {
        const manifestPath = path_1.default.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
        if (!fs_1.default.existsSync(manifestPath))
            continue;
        try {
            const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
            const manifestJobIds = [manifest.jobId, manifest.sourceJobId, manifest.originJobId].filter((v) => typeof v === "string");
            if (manifestJobIds.includes(sourceJobId)) {
                return {
                    launchId,
                    testRunId: typeof manifest.testRunId === "number" ? manifest.testRunId : typeof manifest.testRunId === "string" ? Number(manifest.testRunId) : undefined,
                    publishedCases: Array.isArray(manifest.publishedCases) ? manifest.publishedCases : undefined,
                };
            }
        }
        catch {
            // ignore unreadable manifests
        }
    }
    return undefined;
}
const TERMINAL_RUN_STATUSES = new Set([
    "done",
    "completed",
    "completed_with_failures",
    "completed_with_sync_errors",
    "failed",
    "error",
    "cancelled",
    "canceled",
    "stopped",
    "timeout",
]);
const ERROR_TERMINAL_RUN_STATUSES = new Set([
    "failed",
    "error",
    "cancelled",
    "canceled",
    "stopped",
    "timeout",
    "completed_with_failures",
    "completed_with_sync_errors",
]);
function toNonEmptyString(value) {
    if (typeof value !== "string")
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
function toBoolean(value) {
    if (typeof value === "boolean")
        return value;
    return undefined;
}
function readPreviewJobMetadata(jobId) {
    const jobMetaPath = path_1.default.join(PREVIEW_ARTIFACTS_DIR, jobId, "job.json");
    if (!fs_1.default.existsSync(jobMetaPath))
        return undefined;
    try {
        const parsed = JSON.parse(fs_1.default.readFileSync(jobMetaPath, "utf-8"));
        return parsed && typeof parsed === "object" ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
function findEvidenceDocxByJobId(rootDir, jobId) {
    if (!fs_1.default.existsSync(rootDir))
        return undefined;
    const stack = [rootDir];
    while (stack.length > 0) {
        const dir = stack.pop();
        if (!dir)
            continue;
        const entries = fs_1.default.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path_1.default.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(fullPath);
                continue;
            }
            if (entry.name === "evidencia.docx"
                && fullPath.includes(path_1.default.sep + "runs" + path_1.default.sep + jobId + path_1.default.sep)) {
                return fullPath;
            }
        }
    }
    return undefined;
}
function resolveEvidenceDocxForJob(jobId) {
    const job = job_store_1.jobStore.get(jobId);
    const params = (job?.params ?? {});
    const summary = (job?.summary ?? {});
    const diskMeta = readPreviewJobMetadata(jobId);
    const appSlug = toNonEmptyString(params.appSlug)
        ?? toNonEmptyString(params.targetAppSlug)
        ?? toNonEmptyString(diskMeta?.appSlug)
        ?? toNonEmptyString(diskMeta?.targetAppSlug);
    const sectionSlug = toNonEmptyString(params.sectionSlug) ?? toNonEmptyString(diskMeta?.sectionSlug);
    const jobStatus = toNonEmptyString(job?.status) ?? toNonEmptyString(diskMeta?.status);
    const previewJobDir = path_1.default.join(PREVIEW_ARTIFACTS_DIR, jobId);
    const jobExists = Boolean(job || fs_1.default.existsSync(previewJobDir));
    const candidatePaths = [];
    if (appSlug && sectionSlug) {
        candidatePaths.push(path_1.default.join(EVIDENCE_ROOT_DIR, appSlug, sectionSlug, "runs", jobId, "evidencia.docx"));
    }
    candidatePaths.push(path_1.default.join(PREVIEW_ARTIFACTS_DIR, jobId, "evidencia.docx"));
    for (const candidate of candidatePaths) {
        if (fs_1.default.existsSync(candidate)) {
            return {
                jobId,
                status: "ready",
                reasonCode: "ready",
                documentReady: true,
                documentPath: candidate,
                jobExists: true,
                jobStatus,
                appSlug,
                sectionSlug,
            };
        }
    }
    const foundInEvidenceTree = findEvidenceDocxByJobId(EVIDENCE_ROOT_DIR, jobId);
    if (foundInEvidenceTree) {
        return {
            jobId,
            status: "ready",
            reasonCode: "ready",
            documentReady: true,
            documentPath: foundInEvidenceTree,
            jobExists: true,
            jobStatus,
            appSlug,
            sectionSlug,
        };
    }
    if (!jobExists) {
        return {
            jobId,
            status: "unavailable",
            reasonCode: "job_not_found",
            documentReady: false,
            jobExists: false,
            jobStatus,
            appSlug,
            sectionSlug,
        };
    }
    const summaryReasonCode = toNonEmptyString(summary.reasonCode);
    if (summaryReasonCode === "cases_not_executable") {
        return {
            jobId,
            status: "unavailable",
            reasonCode: "cases_not_executable",
            documentReady: false,
            jobExists: true,
            jobStatus,
            appSlug,
            sectionSlug,
        };
    }
    if (summaryReasonCode === "document_generation_failed") {
        return {
            jobId,
            status: "unavailable",
            reasonCode: "document_generation_failed",
            documentReady: false,
            jobExists: true,
            jobStatus,
            appSlug,
            sectionSlug,
        };
    }
    if (summaryReasonCode === "evidence_initialization_failed") {
        return {
            jobId,
            status: "unavailable",
            reasonCode: "evidence_initialization_failed",
            documentReady: false,
            jobExists: true,
            jobStatus,
            appSlug,
            sectionSlug,
        };
    }
    const normalizedStatus = (jobStatus ?? "").trim().toLowerCase();
    const terminal = TERMINAL_RUN_STATUSES.has(normalizedStatus);
    if (!terminal) {
        return {
            jobId,
            status: "preparing",
            reasonCode: "document_preparing",
            documentReady: false,
            jobExists: true,
            jobStatus,
            appSlug,
            sectionSlug,
        };
    }
    const documentAttempted = toBoolean(summary.documentAttempted) === true;
    const documentGenerated = toBoolean(summary.documentGenerated) === true;
    const documentPathPresent = toBoolean(summary.documentPathPresent) === true;
    if (documentAttempted && !documentGenerated) {
        return {
            jobId,
            status: "unavailable",
            reasonCode: "document_generation_failed",
            documentReady: false,
            jobExists: true,
            jobStatus,
            appSlug,
            sectionSlug,
        };
    }
    if (documentGenerated && !documentPathPresent) {
        return {
            jobId,
            status: "unavailable",
            reasonCode: "document_not_found_after_completion",
            documentReady: false,
            jobExists: true,
            jobStatus,
            appSlug,
            sectionSlug,
        };
    }
    return {
        jobId,
        status: ERROR_TERMINAL_RUN_STATUSES.has(normalizedStatus) ? "failed" : "unavailable",
        reasonCode: ERROR_TERMINAL_RUN_STATUSES.has(normalizedStatus)
            ? "document_generation_failed"
            : "document_not_found_after_completion",
        documentReady: false,
        jobExists: true,
        jobStatus,
        appSlug,
        sectionSlug,
    };
}
exports.runsRouter.post("/:jobId/sync-results", async (req, res) => {
    const jobId = req.params.jobId;
    console.log(`[sync-results] requested jobId=${jobId}`);
    // Try to find launch metadata from the job store
    const job = job_store_1.jobStore.get(jobId);
    let launchId;
    let testRunId;
    let publishedCases;
    if (job) {
        const p = job.payload;
        launchId = p?.launchId || undefined;
        testRunId = p?.testRunId ? Number(p.testRunId) : undefined;
        publishedCases = Array.isArray(p?.publishedCases) ? p.publishedCases : undefined;
    }
    if (!testRunId) {
        res.status(400).json({ ok: false, error: "No TestRun ID found in job metadata. Provide launchId in body." });
        return;
    }
    const { TestRailClient } = await Promise.resolve().then(() => __importStar(require("../../clients/testrail.client")));
    const { requireTestRailConfig } = await Promise.resolve().then(() => __importStar(require("../../config/env")));
    const config = requireTestRailConfig(await (await Promise.resolve().then(() => __importStar(require("../../config/env")))).config);
    if (!config) {
        res.status(500).json({ ok: false, error: "TestRail not configured" });
        return;
    }
    const trClient = new TestRailClient(config);
    // Read results from job artifact dir
    const jobArtifacts = path_1.default.join(PREVIEW_ARTIFACTS_DIR, jobId);
    const resultsPath = path_1.default.join(jobArtifacts, "results.json");
    const manifestPath = launchId ? path_1.default.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json") : undefined;
    console.log(`[sync-results] artifacts path=${jobArtifacts} resultsPath=${resultsPath} manifestPath=${manifestPath}`);
    if (!fs_1.default.existsSync(resultsPath)) {
        res.status(400).json({ ok: false, error: `No results.json found at ${resultsPath}` });
        return;
    }
    let resultsData;
    try {
        resultsData = JSON.parse(fs_1.default.readFileSync(resultsPath, "utf-8"));
    }
    catch {
        res.status(400).json({ ok: false, error: "Failed to parse results.json" });
        return;
    }
    const rawResults = resultsData.results ?? resultsData.cases ?? [];
    if (rawResults.length === 0) {
        res.status(400).json({ ok: false, error: "No results found in results.json" });
        return;
    }
    // Build results map and scenario-to-case mapping
    const scenarioToCaseMap = new Map();
    if (publishedCases) {
        for (const pc of publishedCases) {
            scenarioToCaseMap.set(pc.scenarioId, pc.caseId);
        }
    }
    // Also try to read manifest for publishedCases if not available from job
    if (manifestPath && fs_1.default.existsSync(manifestPath) && publishedCases && publishedCases.length === 0) {
        try {
            const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
            launchId = manifest.launchId ?? launchId;
            testRunId = manifest.testRunId ?? testRunId;
            if (Array.isArray(manifest.publishedCases)) {
                for (const pc of manifest.publishedCases) {
                    scenarioToCaseMap.set(pc.scenarioId, pc.caseId);
                }
            }
        }
        catch { /* ignore */ }
    }
    // Read manifest for existing results if present
    let manifest = { results: [] };
    if (manifestPath && fs_1.default.existsSync(manifestPath)) {
        try {
            manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
        }
        catch { /* ignore */ }
    }
    const { syncDiscoveryResultToTestRail, updateLaunchManifestWithResult } = await Promise.resolve().then(() => __importStar(require("../jobs/testrail-result-sync")));
    const syncResults = [];
    const errors = [];
    const runIdValue = testRunId;
    if (!runIdValue) {
        const availableIds = Array.from(scenarioToCaseMap.keys()).join(",");
        res.status(400).json({ ok: false, error: "No TestRun ID available", scenarioIds: availableIds });
        return;
    }
    for (const r of rawResults) {
        const scenarioId = r.scenarioId ?? r.caseId ?? r.title ?? "unknown";
        const caseId = scenarioToCaseMap.get(scenarioId) || 0;
        if (!caseId) {
            const availableIds = Array.from(scenarioToCaseMap.keys()).join(",");
            console.log(`[sync-results] skipped scenarioId=${scenarioId} reason="no_matching_case_id" availableScenarioIds=${availableIds}`);
            syncResults.push({ scenarioId, status: r.status, syncStatus: "skipped_no_case_id", caseId: 0 });
            continue;
        }
        try {
            const syncResult = await syncDiscoveryResultToTestRail({
                runId: runIdValue,
                caseId,
                scenarioId,
                discoveryStatus: r.status === "passed" ? "passed" : r.status === "failed" ? "failed" : r.status === "skipped" ? "skipped" : "review_needed",
                title: r.title,
                errorMessage: r.failureReason,
                durationMs: r.durationMs,
                launchId,
            });
            if (manifestPath && launchId) {
                updateLaunchManifestWithResult(launchId, {
                    scenarioId,
                    caseId,
                    discoveryStatus: r.status,
                    testRailStatusId: syncResult.statusId,
                    syncStatus: syncResult.syncStatus,
                    syncedAt: syncResult.syncedAt,
                    error: syncResult.error,
                }, publishedCases?.length ?? rawResults.length);
            }
            console.log(`[sync-results] synced scenarioId=${scenarioId} caseId=${caseId} status=${r.status} syncStatus=${syncResult.syncStatus}`);
            syncResults.push({ scenarioId, status: r.status, syncStatus: syncResult.syncStatus, caseId });
        }
        catch (err) {
            const errMsg = err.message ?? String(err);
            console.error(`[sync-results] failed scenarioId=${scenarioId} caseId=${caseId}: ${errMsg}`);
            errors.push(`scenarioId=${scenarioId}: ${errMsg}`);
        }
    }
    res.json({
        ok: errors.length === 0,
        synced: syncResults.filter(sr => sr.syncStatus === "synced").length,
        skipped: syncResults.filter(sr => sr.syncStatus === "skipped_no_case_id").length,
        failed: errors.length,
        total: rawResults.length,
        results: syncResults,
        errors: errors.length > 0 ? errors : undefined,
    });
});
// ── Jira link backfill — link an existing TestRun to a Jira issue without rerunning ──
exports.runsRouter.post("/:jobId/link-jira", async (req, res) => {
    const jobId = req.params.jobId;
    const b = req.body;
    console.log(`[link-jira] requested jobId=${jobId}`);
    const { linkTestRunToJiraIssue } = await Promise.resolve().then(() => __importStar(require("../jobs/jira-traceability")));
    const { updateLaunchManifestJiraLink } = await Promise.resolve().then(() => __importStar(require("../jobs/testrail-result-sync")));
    const job = job_store_1.jobStore.get(jobId);
    let launchId = b.launchId;
    let testRunId = b.testRunId ? Number(b.testRunId) : undefined;
    let jiraKey = b.jiraKey;
    if (job) {
        const p = job.payload;
        launchId = launchId || p?.launchId;
        testRunId = testRunId || (p?.testRunId ? Number(p.testRunId) : undefined);
        jiraKey = jiraKey || p?.jiraKey;
    }
    if (!launchId) {
        res.status(400).json({ ok: false, error: "No launchId found. Provide launchId in body." });
        return;
    }
    if (!jiraKey) {
        res.status(400).json({ ok: false, error: "No jiraKey found. Provide jiraKey in body." });
        return;
    }
    if (!testRunId) {
        res.status(400).json({ ok: false, error: "No testRunId found. Provide testRunId in body." });
        return;
    }
    try {
        const jiraResult = await linkTestRunToJiraIssue({
            jiraKey,
            testRunId,
            launchId,
            appSlug: b.appSlug,
            sectionSlug: b.sectionSlug,
            finalStatus: b.finalStatus,
        });
        updateLaunchManifestJiraLink(launchId, jiraResult);
        res.json({ ok: jiraResult.linkStatus === "linked", ...jiraResult });
    }
    catch (err) {
        const errMsg = err.message ?? String(err);
        res.status(500).json({ ok: false, error: errMsg, jiraKey, launchId, testRunId });
    }
});
// ── Link Jira Run Ref backfill — set refs on an existing TestRun to enable TestRail Runs panel ──
exports.runsRouter.post("/:jobId/link-jira-run-ref", async (req, res) => {
    const jobId = req.params.jobId;
    const b = req.body;
    console.log(`[link-jira-run-ref] requested jobId=${jobId}`);
    const { config, requireTestRailConfig } = await Promise.resolve().then(() => __importStar(require("../../config/env")));
    const { TestRailClient } = await Promise.resolve().then(() => __importStar(require("../../clients/testrail.client")));
    let testRunId = b.testRunId ? Number(b.testRunId) : undefined;
    let jiraKey = b.jiraKey;
    // Try job payload for fallback
    const job = job_store_1.jobStore.get(jobId);
    if (job) {
        const p = job.payload;
        testRunId = testRunId || (p?.testRunId ? Number(p.testRunId) : undefined);
        jiraKey = jiraKey || p?.jiraKey;
    }
    if (!testRunId) {
        res.status(400).json({ ok: false, error: "No testRunId provided and not found in job. Provide testRunId in body." });
        return;
    }
    if (!jiraKey) {
        res.status(400).json({ ok: false, error: "No jiraKey provided and not found in job. Provide jiraKey in body." });
        return;
    }
    try {
        const trConfig = requireTestRailConfig(config);
        const trClient = new TestRailClient(trConfig);
        const result = await trClient.updateRun(testRunId, { refs: jiraKey });
        console.log(`[link-jira-run-ref] updated runId=${testRunId} refs=${jiraKey} resultId=${result.id}`);
        // Try to update manifest
        const launchId = b.launchId;
        if (launchId) {
            const { updateLaunchManifestJiraLink } = await Promise.resolve().then(() => __importStar(require("../jobs/testrail-result-sync")));
            updateLaunchManifestJiraLink(launchId, {
                jiraKey,
                linkStatus: "linked",
                linkedAt: new Date().toISOString(),
            });
        }
        res.json({ ok: true, testRunId, jiraKey });
    }
    catch (err) {
        const errMsg = err.message ?? String(err);
        console.error(`[link-jira-run-ref] failed testRunId=${testRunId} jiraKey=${jiraKey} error="${errMsg}"`);
        res.status(500).json({ ok: false, error: errMsg, testRunId, jiraKey });
    }
});
// ── Evidence DOCX status ──
exports.runsRouter.get("/:jobId/evidence-docx/status", (req, res) => {
    const jobId = req.params.jobId;
    const resolution = resolveEvidenceDocxForJob(jobId);
    if (!resolution.jobExists && resolution.reasonCode === "job_not_found") {
        res.status(404).json({
            jobId,
            status: "not_found",
            documentReady: false,
            reasonCode: "job_not_found",
        });
        return;
    }
    const statusCode = resolution.status === "preparing" ? 202 : 200;
    res.status(statusCode).json({
        jobId,
        status: resolution.status,
        documentReady: resolution.documentReady,
        reasonCode: resolution.reasonCode,
        jobStatus: resolution.jobStatus,
        appSlug: resolution.appSlug,
        sectionSlug: resolution.sectionSlug,
    });
});
// ── Download evidence DOCX ──
exports.runsRouter.get("/:jobId/evidence-docx", (req, res) => {
    const jobId = req.params.jobId;
    const resolution = resolveEvidenceDocxForJob(jobId);
    const docxPath = resolution.documentPath;
    if (!docxPath) {
        if (!resolution.jobExists && resolution.reasonCode === "job_not_found") {
            res.status(404).json({
                error: "Job not found",
                jobId,
                reasonCode: "job_not_found",
                message: "No existe un job con ese ID.",
            });
            return;
        }
        if (resolution.status === "preparing") {
            res.status(409).json({
                error: "Evidence DOCX is still being prepared",
                jobId,
                reasonCode: "document_preparing",
                message: "La ejecución aún está consolidando el documento de evidencia.",
            });
            return;
        }
        console.error(`[evidence-docx] file not found jobId=${jobId} reason=${resolution.reasonCode}`);
        res.status(404).json({
            error: "Evidence DOCX not found",
            jobId,
            reasonCode: resolution.reasonCode,
            message: "El documento de evidencia no está disponible para este job.",
        });
        return;
    }
    const filename = `evidencia-${jobId}.docx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    const stream = fs_1.default.createReadStream(docxPath);
    stream.on("error", (err) => {
        console.error(`[evidence-docx] stream error jobId=${jobId}:`, err);
        if (!res.headersSent) {
            res.status(500).json({ error: "Failed to stream evidence file" });
        }
    });
    stream.pipe(res);
});
