"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.reportScenarioPreviewResultsToTestRail = reportScenarioPreviewResultsToTestRail;
exports.buildTestRailRunName = buildTestRailRunName;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
function mapScenarioStatusToTestRailStatusId(status) {
    if (status === "passed")
        return 1;
    if (status === "skipped")
        return 2;
    return 5;
}
function buildComment(result, artifactDir) {
    const parts = [
        `scenarioId=${result.scenarioId}`,
        `status=${result.status}`,
    ];
    if (result.title)
        parts.push(`title=${result.title}`);
    if (result.failureReason)
        parts.push(`failureReason=${result.failureReason}`);
    parts.push(`artifactDir=${artifactDir}`);
    if (result.artifactPath)
        parts.push(`artifactPath=${result.artifactPath}`);
    if (result.screenshotPath)
        parts.push(`screenshotPath=${result.screenshotPath}`);
    if (result.videoPath)
        parts.push(`videoPath=${result.videoPath}`);
    if (result.logs && result.logs.length > 0) {
        parts.push(`logs=${result.logs.slice(-5).join(" | ")}`);
    }
    return parts.join(" | ");
}
function persistPendingReport(artifactDir, payload) {
    const filePath = node_path_1.default.join(artifactDir, "pending-testrail-report.json");
    node_fs_1.default.mkdirSync(node_path_1.default.dirname(filePath), { recursive: true });
    node_fs_1.default.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf-8");
    return filePath;
}
async function reportScenarioPreviewResultsToTestRail(client, input) {
    const results = input.results
        .map((result) => {
        const mapping = input.mappings.find((m) => m.scenarioId === result.scenarioId);
        if (!mapping)
            return null;
        return {
            runId: input.runId,
            caseId: mapping.testRailCaseId,
            statusId: mapScenarioStatusToTestRailStatusId(result.status),
            comment: buildComment(result, input.artifactDir),
            elapsed: undefined,
        };
    })
        .filter((entry) => Boolean(entry));
    try {
        const response = await client.addResultsForCases(input.runId, results);
        return { added: response.added };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const pendingReportPath = persistPendingReport(input.artifactDir, {
            runId: input.runId,
            projectId: input.projectId,
            suiteId: input.suiteId ?? null,
            sectionId: input.sectionId,
            runName: input.runName,
            error: message,
            results: results.map((r) => ({
                caseId: r.caseId,
                statusId: r.statusId,
                comment: r.comment,
            })),
        });
        return { added: 0, pendingReportPath };
    }
}
function buildTestRailRunName(appSlug, sectionId, scenarioCount) {
    return `[QA Lab] ${appSlug} section ${sectionId} - ${scenarioCount} scenarios`;
}
