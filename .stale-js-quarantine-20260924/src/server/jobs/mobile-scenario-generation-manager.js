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
Object.defineProperty(exports, "__esModule", { value: true });
exports.startOrReuseMobileScenarioGenerationJob = startOrReuseMobileScenarioGenerationJob;
exports.getMobileScenarioGenerationJob = getMobileScenarioGenerationJob;
exports.isMobileScenarioGenerationJobTerminal = isMobileScenarioGenerationJobTerminal;
exports.__setMobileScenarioGenerationRunnerForTesting = __setMobileScenarioGenerationRunnerForTesting;
exports.__awaitMobileScenarioGenerationForTesting = __awaitMobileScenarioGenerationForTesting;
exports.__resetMobileScenarioGenerationStateForTesting = __resetMobileScenarioGenerationStateForTesting;
const node_crypto_1 = require("node:crypto");
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const env_1 = require("../../config/env");
const jira_client_1 = require("../../clients/jira.client");
const mobile_scenario_generator_1 = require("../../scenarios/mobile-scenario-generator");
const MOBILE_SCENARIO_GENERATION_VERSION = "mobile-scenarios-async-v1";
const jobsById = new Map();
const idempotencyToJobId = new Map();
const runningPromisesByJobId = new Map();
let generationRunnerForTesting = null;
// ── Durable persistence of terminal generation results ─────────────────────
// Survives a Node process restart so a completed/failed generation can be
// recovered by generationJobId without re-invoking the AI provider.
const GENERATION_DISK_DIR = path.join(process.cwd(), ".artifacts", "mobile-scenario-generations");
function toPersistedDTO(record) {
    return {
        version: MOBILE_SCENARIO_GENERATION_VERSION,
        generationJobId: record.generationJobId,
        requestId: record.requestId,
        launchDraftId: record.launchDraftId,
        appSlug: record.appSlug,
        issueKeys: [...record.issueKeys],
        idempotencyKey: record.idempotencyKey,
        idempotencyKeyHash: record.idempotencyKeyHash,
        status: record.status,
        createdAt: record.createdAt,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        consumersWaiting: record.consumersWaiting,
        issueProgress: record.issueProgress.map((entry) => ({ ...entry })),
        partial: {
            scenariosByIssue: record.partial.scenariosByIssue,
            rejectedByIssue: record.partial.rejectedByIssue,
            completedIssues: record.partial.completedIssues,
            totalIssues: record.partial.totalIssues,
            totalScenarios: record.partial.totalScenarios,
            totalRejected: record.partial.totalRejected,
        },
        result: record.result,
        error: record.error,
        normalizedPayload: record.normalizedPayload,
    };
}
function generationDiskPath(generationJobId) {
    return path.join(GENERATION_DISK_DIR, `${generationJobId}.json`);
}
/** Atomic write: write to a .tmp file, then rename over the definitive file. */
function persistGenerationRecord(record) {
    try {
        fs.mkdirSync(GENERATION_DISK_DIR, { recursive: true });
        const finalPath = generationDiskPath(record.generationJobId);
        const tmpPath = `${finalPath}.tmp`;
        fs.writeFileSync(tmpPath, JSON.stringify(toPersistedDTO(record), null, 2), "utf-8");
        fs.renameSync(tmpPath, finalPath);
    }
    catch {
        // Persistence is best-effort: a failure must never break the in-memory flow.
    }
}
/**
 * Lazy recovery: reconstruct a record from disk when it is absent from memory.
 * Returns null (=> NOT_FOUND) when the file is missing, corrupt, or the id does
 * not match. Never triggers a new AI call.
 */
function loadGenerationRecord(generationJobId) {
    try {
        const finalPath = generationDiskPath(generationJobId);
        if (!fs.existsSync(finalPath))
            return null;
        const raw = fs.readFileSync(finalPath, "utf-8");
        const dto = JSON.parse(raw);
        if (!dto || typeof dto !== "object" || dto.generationJobId !== generationJobId)
            return null;
        if (typeof dto.status !== "string" || !Array.isArray(dto.issueKeys))
            return null;
        return {
            generationJobId: dto.generationJobId,
            requestId: dto.requestId,
            launchDraftId: dto.launchDraftId,
            appSlug: dto.appSlug,
            issueKeys: [...dto.issueKeys],
            idempotencyKey: dto.idempotencyKey,
            idempotencyKeyHash: dto.idempotencyKeyHash,
            status: dto.status,
            createdAt: dto.createdAt,
            startedAt: dto.startedAt,
            finishedAt: dto.finishedAt,
            consumersWaiting: typeof dto.consumersWaiting === "number" ? dto.consumersWaiting : 0,
            issueProgress: Array.isArray(dto.issueProgress) ? dto.issueProgress.map((entry) => ({ ...entry })) : [],
            partial: {
                scenariosByIssue: dto.partial?.scenariosByIssue ?? {},
                rejectedByIssue: dto.partial?.rejectedByIssue ?? {},
                completedIssues: dto.partial?.completedIssues ?? 0,
                totalIssues: dto.partial?.totalIssues ?? 0,
                totalScenarios: dto.partial?.totalScenarios ?? 0,
                totalRejected: dto.partial?.totalRejected ?? 0,
            },
            result: dto.result,
            error: dto.error,
            normalizedPayload: dto.normalizedPayload,
        };
    }
    catch {
        return null;
    }
}
function isTerminalStatus(status) {
    return status === "completed" || status === "failed" || status === "cancelled";
}
function normalizeSelectedIssueKeys(value) {
    if (!Array.isArray(value))
        return [];
    return Array.from(new Set(value
        .map((entry) => String(entry ?? "").trim())
        .filter((entry) => entry.length > 0))).sort();
}
function normalizeRequest(input) {
    const selectedIssueKeys = normalizeSelectedIssueKeys(input.selectedIssueKeys);
    return {
        projectKey: String(input.projectKey ?? "").trim(),
        sprintId: typeof input.sprintId === "number" && Number.isFinite(input.sprintId) ? Number(input.sprintId) : undefined,
        activeSprint: input.activeSprint === true,
        status: typeof input.status === "string" && input.status.trim().length > 0 ? input.status.trim() : undefined,
        maxResults: typeof input.maxResults === "number" && Number.isFinite(input.maxResults) && input.maxResults > 0
            ? Number(input.maxResults)
            : (selectedIssueKeys.length > 0 ? selectedIssueKeys.length : 50),
        appSlug: typeof input.appSlug === "string" && input.appSlug.trim().length > 0 ? input.appSlug.trim() : undefined,
        selectedIssueKeys,
        sourceRevision: typeof input.sourceRevision === "string" && input.sourceRevision.trim().length > 0 ? input.sourceRevision.trim() : undefined,
        launchDraftId: typeof input.launchDraftId === "string" && input.launchDraftId.trim().length > 0 ? input.launchDraftId.trim() : undefined,
    };
}
function buildIdempotencyKey(payload) {
    const idempotencyInput = {
        scope: "mobile-scenarios-generation",
        version: MOBILE_SCENARIO_GENERATION_VERSION,
        appSlug: payload.appSlug ?? "",
        projectKey: payload.projectKey,
        sprintId: payload.sprintId ?? null,
        activeSprint: payload.activeSprint === true,
        status: payload.status ?? "",
        maxResults: payload.maxResults,
        selectedIssueKeys: payload.selectedIssueKeys,
        sourceRevision: payload.sourceRevision ?? "",
        provider: process.env.AI_PROVIDER_NAME?.trim() || process.env.AI_PROVIDER?.trim() || "",
        model: process.env.AI_SCENARIO_MODEL?.trim() || process.env.AI_MODEL?.trim() || "",
    };
    return JSON.stringify(idempotencyInput);
}
function hashString(value) {
    return (0, node_crypto_1.createHash)("sha256").update(value).digest("hex");
}
function toSnapshot(record) {
    return {
        generationJobId: record.generationJobId,
        requestId: record.requestId,
        launchDraftId: record.launchDraftId,
        appSlug: record.appSlug,
        issueKeys: [...record.issueKeys],
        idempotencyKey: record.idempotencyKey,
        idempotencyKeyHash: record.idempotencyKeyHash,
        status: record.status,
        createdAt: record.createdAt,
        startedAt: record.startedAt,
        finishedAt: record.finishedAt,
        consumersWaiting: record.consumersWaiting,
        issueProgress: record.issueProgress.map((entry) => ({ ...entry })),
        partial: {
            scenariosByIssue: Object.fromEntries(Object.entries(record.partial.scenariosByIssue).map(([issueKey, scenarios]) => [issueKey, [...scenarios]])),
            rejectedByIssue: Object.fromEntries(Object.entries(record.partial.rejectedByIssue).map(([issueKey, rejected]) => [issueKey, [...rejected]])),
            completedIssues: record.partial.completedIssues,
            totalIssues: record.partial.totalIssues,
            totalScenarios: record.partial.totalScenarios,
            totalRejected: record.partial.totalRejected,
        },
        result: record.result,
        error: record.error,
    };
}
function updateIssueProgress(record, issueKey, patch) {
    const index = record.issueProgress.findIndex((entry) => entry.issueKey === issueKey);
    if (index < 0) {
        record.issueProgress.push({
            issueKey,
            status: "pending",
            scenarioCount: 0,
            rejectedCount: 0,
            ...patch,
        });
        return;
    }
    record.issueProgress[index] = { ...record.issueProgress[index], ...patch };
}
async function defaultRunner(input, handlers) {
    const jiraConfig = (0, env_1.requireJiraConfig)(env_1.config);
    let resolvedSprintId = input.sprintId;
    if (!resolvedSprintId && input.activeSprint) {
        const jira = new jira_client_1.JiraClient(jiraConfig);
        const activeSprint = await jira.getActiveSprint(input.projectKey);
        if (!activeSprint) {
            throw new Error(`No active sprint found for project ${input.projectKey}`);
        }
        resolvedSprintId = activeSprint.id;
    }
    if (!resolvedSprintId) {
        throw new Error("Missing sprintId (or activeSprint) for mobile scenario generation.");
    }
    return (0, mobile_scenario_generator_1.generateMobileScenarios)(jiraConfig, input.projectKey, resolvedSprintId, input.status, input.maxResults, input.appSlug, {
        selectedIssueKeys: input.selectedIssueKeys,
        onIssuesResolved: handlers.onIssuesResolved,
        onIssueStart: handlers.onIssueStart,
        onIssueCompleted: handlers.onIssueCompleted,
    });
}
async function runGeneration(record) {
    record.status = "running";
    record.startedAt = new Date().toISOString();
    record.error = undefined;
    const runner = generationRunnerForTesting ?? defaultRunner;
    try {
        const result = await runner(record.normalizedPayload, {
            onIssuesResolved: (issueKeys) => {
                record.issueKeys = [...issueKeys];
                record.partial.totalIssues = issueKeys.length;
                record.issueProgress = issueKeys.map((issueKey) => ({
                    issueKey,
                    status: "pending",
                    scenarioCount: 0,
                    rejectedCount: 0,
                }));
            },
            onIssueStart: (event) => {
                updateIssueProgress(record, event.issueKey, {
                    status: "running",
                    startedAt: event.startedAt,
                    errorMessage: undefined,
                    reasonCode: undefined,
                });
            },
            onIssueCompleted: (event) => {
                updateIssueProgress(record, event.issueKey, {
                    status: event.status,
                    startedAt: event.startedAt,
                    finishedAt: event.finishedAt,
                    durationMs: event.durationMs,
                    scenarioCount: event.scenarios.length,
                    rejectedCount: event.rejected.length,
                    reasonCode: event.classifiedReason,
                    errorMessage: event.errorMessage,
                });
                record.partial.scenariosByIssue[event.issueKey] = [...event.scenarios];
                record.partial.rejectedByIssue[event.issueKey] = [...event.rejected];
                record.partial.completedIssues = record.issueProgress.filter((issue) => issue.status === "completed" || issue.status === "failed").length;
                record.partial.totalScenarios = Object.values(record.partial.scenariosByIssue).reduce((sum, scenarios) => sum + scenarios.length, 0);
                record.partial.totalRejected = Object.values(record.partial.rejectedByIssue).reduce((sum, rejected) => sum + rejected.length, 0);
            },
        });
        const perIssueScenarioCount = {};
        const perIssueRejectedCount = {};
        for (const [issueKey, issueScenarios] of Object.entries(record.partial.scenariosByIssue)) {
            perIssueScenarioCount[issueKey] = issueScenarios.length;
        }
        for (const [issueKey, issueRejected] of Object.entries(record.partial.rejectedByIssue)) {
            perIssueRejectedCount[issueKey] = issueRejected.length;
        }
        record.result = {
            ...result,
            scenariosByIssue: record.partial.scenariosByIssue,
            rejectedByIssue: record.partial.rejectedByIssue,
            consolidated: {
                totalScenarios: result.scenarios.length,
                totalRejected: result.rejected.length,
                perIssueScenarioCount,
                perIssueRejectedCount,
            },
        };
        record.status = "completed";
        record.finishedAt = new Date().toISOString();
        record.consumersWaiting = 0;
        // Durable: a completed job must persist its final result.scenarios to disk.
        persistGenerationRecord(record);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        record.status = "failed";
        record.finishedAt = new Date().toISOString();
        record.consumersWaiting = 0;
        record.error = {
            code: "mobile_scenario_generation_failed",
            message,
        };
        persistGenerationRecord(record);
    }
}
async function startOrReuseMobileScenarioGenerationJob(input, metadata = {}) {
    const normalizedPayload = normalizeRequest(input);
    const idempotencyKey = buildIdempotencyKey(normalizedPayload);
    const idempotencyKeyHash = hashString(idempotencyKey);
    const existingJobId = idempotencyToJobId.get(idempotencyKeyHash);
    if (existingJobId) {
        const existing = jobsById.get(existingJobId);
        if (existing) {
            if (existing.status === "pending" || existing.status === "running") {
                existing.consumersWaiting += 1;
                return { job: toSnapshot(existing), reused: true, cacheHit: false };
            }
            if (existing.status === "completed") {
                return { job: toSnapshot(existing), reused: true, cacheHit: true };
            }
        }
    }
    const createdAt = new Date().toISOString();
    const record = {
        generationJobId: (0, node_crypto_1.randomUUID)(),
        requestId: metadata.requestId?.trim() || (0, node_crypto_1.randomUUID)(),
        launchDraftId: normalizedPayload.launchDraftId,
        appSlug: normalizedPayload.appSlug,
        issueKeys: [...normalizedPayload.selectedIssueKeys],
        idempotencyKey,
        idempotencyKeyHash,
        status: "pending",
        createdAt,
        consumersWaiting: 1,
        issueProgress: normalizedPayload.selectedIssueKeys.map((issueKey) => ({
            issueKey,
            status: "pending",
            scenarioCount: 0,
            rejectedCount: 0,
        })),
        partial: {
            scenariosByIssue: {},
            rejectedByIssue: {},
            completedIssues: 0,
            totalIssues: normalizedPayload.selectedIssueKeys.length,
            totalScenarios: 0,
            totalRejected: 0,
        },
        normalizedPayload,
    };
    jobsById.set(record.generationJobId, record);
    idempotencyToJobId.set(idempotencyKeyHash, record.generationJobId);
    const runningPromise = runGeneration(record).finally(() => {
        runningPromisesByJobId.delete(record.generationJobId);
    });
    runningPromisesByJobId.set(record.generationJobId, runningPromise);
    return { job: toSnapshot(record), reused: false, cacheHit: false };
}
function getMobileScenarioGenerationJob(generationJobId) {
    const record = jobsById.get(generationJobId);
    if (record)
        return toSnapshot(record);
    // Lazy recovery from durable disk storage (post-restart): reconstruct only from
    // serializable data and re-insert into memory. Never re-invokes the AI provider.
    const recovered = loadGenerationRecord(generationJobId);
    if (!recovered)
        return null;
    jobsById.set(recovered.generationJobId, recovered);
    idempotencyToJobId.set(recovered.idempotencyKeyHash, recovered.generationJobId);
    return toSnapshot(recovered);
}
function isMobileScenarioGenerationJobTerminal(status) {
    return isTerminalStatus(status);
}
function __setMobileScenarioGenerationRunnerForTesting(runner) {
    generationRunnerForTesting = runner;
}
async function __awaitMobileScenarioGenerationForTesting(generationJobId) {
    const running = runningPromisesByJobId.get(generationJobId);
    if (running)
        await running;
}
function __resetMobileScenarioGenerationStateForTesting() {
    jobsById.clear();
    idempotencyToJobId.clear();
    runningPromisesByJobId.clear();
    generationRunnerForTesting = null;
}
