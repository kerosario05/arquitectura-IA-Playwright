"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveInfrastructureBlockedStatusId = resolveInfrastructureBlockedStatusId;
exports.hasInfrastructureBlockedStatusMapping = hasInfrastructureBlockedStatusMapping;
exports.mapDiscoveryStatusToTestRail = mapDiscoveryStatusToTestRail;
exports.syncDiscoveryResultToTestRail = syncDiscoveryResultToTestRail;
exports.updateLaunchManifestJobId = updateLaunchManifestJobId;
exports.updateLaunchManifestJiraLink = updateLaunchManifestJiraLink;
exports.finalizeLaunchManifest = finalizeLaunchManifest;
exports.updateLaunchManifestWithResult = updateLaunchManifestWithResult;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const env_1 = require("../../config/env");
const testrail_client_1 = require("../../clients/testrail.client");
const ROOT = path_1.default.resolve(__dirname, "..", "..", "..");
const LAUNCH_ARTIFACTS_DIR = path_1.default.join(ROOT, ".artifacts", "scenario-launch-runs");
const DEFAULT_STATUS_IDS = {
    passed: Number(process.env.TESTRAIL_STATUS_PASSED_ID) || 1,
    failed: Number(process.env.TESTRAIL_STATUS_FAILED_ID) || 5,
};
function resolveInfrastructureBlockedStatusId() {
    const raw = process.env.TESTRAIL_STATUS_BLOCKED_ID?.trim();
    if (!raw)
        return undefined;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed <= 0)
        return undefined;
    return parsed;
}
function hasInfrastructureBlockedStatusMapping() {
    return resolveInfrastructureBlockedStatusId() !== undefined;
}
function mapDiscoveryStatusToTestRail(discoveryStatus) {
    switch (discoveryStatus) {
        case "passed":
            return DEFAULT_STATUS_IDS.passed;
        case "failed":
        case "exploration_failed":
        case "error":
        case "skipped":
        case "review_needed":
        case "needs_agent":
            return DEFAULT_STATUS_IDS.failed;
        case "blocked_infrastructure":
            return resolveInfrastructureBlockedStatusId() ?? DEFAULT_STATUS_IDS.failed;
        default:
            return DEFAULT_STATUS_IDS.failed;
    }
}
async function syncDiscoveryResultToTestRail(input) {
    if (!input.caseId) {
        return { statusId: 0, syncStatus: "skipped_no_case_id" };
    }
    const statusId = mapDiscoveryStatusToTestRail(input.discoveryStatus);
    try {
        const trConfig = (0, env_1.requireTestRailConfig)(env_1.config);
        const trClient = new testrail_client_1.TestRailClient(trConfig);
        const commentParts = [
            `QA Lab discovery result: ${input.discoveryStatus}`,
            `scenarioId=${input.scenarioId}`,
        ];
        if (input.launchId)
            commentParts.push(`launchId=${input.launchId}`);
        if (input.title)
            commentParts.push(`title="${input.title.slice(0, 100)}"`);
        if (input.artifactsDir)
            commentParts.push(`artifacts=${input.artifactsDir}`);
        if (input.errorMessage)
            commentParts.push(`error="${input.errorMessage.slice(0, 200)}"`);
        if (input.appSlug)
            commentParts.push(`appSlug=${input.appSlug}`);
        if (input.sectionSlug)
            commentParts.push(`sectionSlug=${input.sectionSlug}`);
        const result = {
            runId: input.runId,
            caseId: input.caseId,
            statusId,
            comment: commentParts.join(" | "),
        };
        if (input.durationMs) {
            const seconds = Math.round(input.durationMs / 1000);
            result.elapsed = `${seconds}s`;
        }
        await trClient.addResultsForCases(input.runId, [result]);
        return {
            statusId,
            syncStatus: "synced",
            syncedAt: new Date().toISOString(),
        };
    }
    catch (err) {
        const errorMsg = err.message ?? String(err);
        console.error(`[testrail-sync] failed to sync caseId=${input.caseId} scenarioId=${input.scenarioId}: ${errorMsg}`);
        return {
            statusId,
            syncStatus: "failed",
            error: errorMsg,
        };
    }
}
/**
 * Persists the executing job's id onto the launch manifest. The manifest is created at publish
 * time (before execution) without a jobId, but the Executions summary needs it to (a) filter the
 * defects registered for THIS run and (b) download the evidence docx (keyed by jobId). Best-effort.
 */
function updateLaunchManifestJobId(launchId, jobId) {
    if (!launchId)
        return;
    const manifestPath = path_1.default.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
    if (!fs_1.default.existsSync(manifestPath))
        return;
    try {
        const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
        if (manifest.jobId === jobId)
            return;
        manifest.jobId = jobId;
        fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
        console.log(`[launch-manifest] jobId persisted launchId=${launchId} jobId=${jobId}`);
    }
    catch (err) {
        console.error(`[launch-manifest] failed to persist jobId for launchId=${launchId}: ${err}`);
    }
}
function updateLaunchManifestJiraLink(launchId, jiraResult) {
    const manifestPath = path_1.default.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
    if (!fs_1.default.existsSync(manifestPath))
        return;
    try {
        const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
        manifest.jira = {
            key: jiraResult.jiraKey || null,
            linkStatus: jiraResult.linkStatus,
            linkedAt: jiraResult.linkedAt || null,
            ...(jiraResult.errorCode ? { errorCode: jiraResult.errorCode } : {}),
            ...(jiraResult.errorMessage ? { errorMessage: jiraResult.errorMessage } : {}),
        };
        fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
        console.log(`[launch-manifest] jira link updated status=${jiraResult.linkStatus} jiraKey=${jiraResult.jiraKey}`);
    }
    catch (err) {
        console.error(`[launch-manifest] failed to update jira link for launchId=${launchId}: ${err}`);
    }
}
function finalizeLaunchManifest(launchId, finalStatus, syncFailedCount, scenarioCount) {
    const manifestPath = path_1.default.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
    if (!fs_1.default.existsSync(manifestPath)) {
        console.log(`[launch-manifest] finalize skipped reason="missing_launch_id"`);
        return;
    }
    try {
        const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
        const results = manifest.results ?? [];
        const synced = results.filter((r) => r.syncStatus === "synced").length;
        const syncFailed = results.filter((r) => r.syncStatus === "failed").length;
        manifest.status = finalStatus;
        manifest.completedAt = new Date().toISOString();
        manifest.summary = {
            total: scenarioCount,
            passed: results.filter((r) => r.discoveryStatus === "passed").length,
            failed: results.filter((r) => r.discoveryStatus !== "passed").length,
            synced,
            syncFailed,
            syncSkipped: results.filter((r) => String(r.syncStatus).startsWith("skipped")).length,
        };
        fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
        console.log(`[launch-manifest] finalized launchId=${launchId} status=${finalStatus} synced=${synced} syncFailed=${syncFailed}`);
    }
    catch (err) {
        console.error(`[launch-manifest] failed to finalize for launchId=${launchId}: ${err}`);
    }
}
function updateLaunchManifestWithResult(launchId, entry, scenarioCount) {
    const manifestPath = path_1.default.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
    if (!fs_1.default.existsSync(manifestPath))
        return;
    try {
        const manifest = JSON.parse(fs_1.default.readFileSync(manifestPath, "utf-8"));
        if (!manifest.results)
            manifest.results = [];
        const existingIdx = manifest.results.findIndex((r) => r.scenarioId === entry.scenarioId);
        if (existingIdx >= 0) {
            manifest.results[existingIdx] = entry;
        }
        else {
            manifest.results.push(entry);
        }
        const passed = manifest.results.filter((r) => r.discoveryStatus === "passed").length;
        const failed = manifest.results.filter((r) => r.discoveryStatus !== "passed").length;
        const synced = manifest.results.filter((r) => r.syncStatus === "synced").length;
        const syncFailed = manifest.results.filter((r) => r.syncStatus === "failed").length;
        manifest.status = failed > 0 ? "completed_with_failures" : "completed";
        manifest.summary = {
            total: scenarioCount,
            passed,
            failed,
            synced,
            syncFailed,
        };
        fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    }
    catch (err) {
        console.error(`[testrail-sync] failed to update manifest for launchId=${launchId}: ${err}`);
    }
}
