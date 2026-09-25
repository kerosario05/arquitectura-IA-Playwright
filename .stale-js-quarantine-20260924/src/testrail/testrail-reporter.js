"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapExecutionStatusToTestRail = mapExecutionStatusToTestRail;
exports.formatDuration = formatDuration;
exports.buildComment = buildComment;
exports.reportToTestRail = reportToTestRail;
const STATUS_MAP = {
    passed: 1,
    blocked: 2,
    untested: 3,
    retest: 4,
    failed: 5
};
function mapExecutionStatusToTestRail(status) {
    if (status === "passed")
        return STATUS_MAP.passed;
    if (status === "failed")
        return STATUS_MAP.failed;
    if (status === "partial")
        return STATUS_MAP.failed;
    if (status === "skipped")
        return STATUS_MAP.blocked;
    return STATUS_MAP.untested;
}
function formatDuration(ms) {
    const totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60)
        return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}
function buildComment(result) {
    const parts = [];
    const stepSummary = result.steps.filter((s) => s.status !== "skipped");
    const failedSteps = stepSummary.filter((s) => s.status === "failed");
    if (failedSteps.length > 0) {
        parts.push(`Failed steps: ${failedSteps.map((s) => `#${s.index} (${s.action})`).join(", ")}`);
        const firstError = failedSteps.find((s) => s.error)?.error;
        if (firstError) {
            parts.push(`Error: ${firstError}`);
        }
    }
    parts.push(`Evidence: ${result.evidenceDir}`);
    return parts.join(" | ");
}
async function reportToTestRail(client, input) {
    const { resultsSummary, projectId, suiteId, runName, runDescription, dryRun } = input;
    const testrailResults = resultsSummary.results.filter((r) => r.scenario.source === "testrail" && r.scenario.caseId != null);
    const caseIds = testrailResults.map((r) => r.scenario.caseId);
    const results = testrailResults.map((r) => ({
        runId: 0,
        caseId: r.scenario.caseId,
        statusId: mapExecutionStatusToTestRail(r.status),
        comment: buildComment(r),
        elapsed: formatDuration(r.durationMs)
    }));
    const resultDetails = testrailResults.map((r) => ({
        caseId: r.scenario.caseId,
        externalId: r.scenario.externalId ?? `C${r.scenario.caseId}`,
        status: r.status,
        statusId: mapExecutionStatusToTestRail(r.status),
        comment: buildComment(r)
    }));
    if (dryRun) {
        return {
            dryRun: true,
            runName,
            caseIds,
            resultsCount: results.length,
            results: resultDetails
        };
    }
    const run = await client.addRun({
        projectId,
        suiteId,
        name: runName,
        description: runDescription,
        caseIds
    });
    for (const result of results) {
        result.runId = run.id;
    }
    await client.addResultsForCases(run.id, results);
    return {
        dryRun: false,
        runId: run.id,
        runUrl: run.url,
        runName: run.name,
        caseIds,
        resultsCount: results.length,
        results: resultDetails
    };
}
