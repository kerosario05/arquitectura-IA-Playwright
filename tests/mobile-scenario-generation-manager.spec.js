"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const mobile_scenario_generation_manager_1 = require("../src/server/jobs/mobile-scenario-generation-manager");
function diagnostics() {
    return {
        providerExitCode: 0,
        rawOutputLength: 10,
        parsed: true,
        contractValid: true,
        rawScenarioCount: 1,
        rawRejectedCount: 0,
        normalizationDroppedCount: 0,
        dropReasons: [],
        finalScenarioCount: 1,
        finalRejectedCount: 0,
        classifiedReason: undefined,
    };
}
test_1.test.describe("mobile scenario generation manager", () => {
    test_1.test.afterEach(() => {
        (0, mobile_scenario_generation_manager_1.__setMobileScenarioGenerationRunnerForTesting)(null);
        (0, mobile_scenario_generation_manager_1.__resetMobileScenarioGenerationStateForTesting)();
    });
    (0, test_1.test)("shares one running job for equivalent concurrent requests", async () => {
        let releaseFirstIssue = null;
        let runnerCalls = 0;
        (0, mobile_scenario_generation_manager_1.__setMobileScenarioGenerationRunnerForTesting)(async (_input, handlers) => {
            runnerCalls += 1;
            handlers.onIssuesResolved(["AA-94", "AA-93"]);
            handlers.onIssueStart({ issueKey: "AA-94", index: 0, total: 2, startedAt: new Date().toISOString() });
            await new Promise((resolve) => {
                releaseFirstIssue = resolve;
            });
            handlers.onIssueCompleted({
                issueKey: "AA-94",
                index: 0,
                total: 2,
                status: "completed",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 10,
                scenarios: [{ scenarioId: "MOBILE-AA-94-001", sourceIssueKey: "AA-94", title: "S1", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] }],
                rejected: [],
                diagnostics: diagnostics(),
            });
            handlers.onIssueStart({ issueKey: "AA-93", index: 1, total: 2, startedAt: new Date().toISOString() });
            handlers.onIssueCompleted({
                issueKey: "AA-93",
                index: 1,
                total: 2,
                status: "completed",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 10,
                scenarios: [{ scenarioId: "MOBILE-AA-93-001", sourceIssueKey: "AA-93", title: "S2", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] }],
                rejected: [],
                diagnostics: diagnostics(),
            });
            return {
                scenarios: [
                    { scenarioId: "MOBILE-AA-94-001", sourceIssueKey: "AA-94", title: "S1", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] },
                    { scenarioId: "MOBILE-AA-93-001", sourceIssueKey: "AA-93", title: "S2", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] },
                ],
                rejected: [],
                issuesFound: 2,
                diagnosticsByIssue: { "AA-94": diagnostics(), "AA-93": diagnostics() },
            };
        });
        const payload = { projectKey: "AA", sprintId: 1, appSlug: "app-a", selectedIssueKeys: ["AA-94", "AA-93"] };
        const first = await (0, mobile_scenario_generation_manager_1.startOrReuseMobileScenarioGenerationJob)(payload, { requestId: "req-1" });
        const second = await (0, mobile_scenario_generation_manager_1.startOrReuseMobileScenarioGenerationJob)(payload, { requestId: "req-2" });
        (0, test_1.expect)(first.reused).toBe(false);
        (0, test_1.expect)(second.reused).toBe(true);
        (0, test_1.expect)(second.cacheHit).toBe(false);
        (0, test_1.expect)(first.job.generationJobId).toBe(second.job.generationJobId);
        (0, test_1.expect)(runnerCalls).toBe(1);
        const running = (0, mobile_scenario_generation_manager_1.getMobileScenarioGenerationJob)(first.job.generationJobId);
        (0, test_1.expect)(running?.status).toBe("running");
        (0, test_1.expect)(running?.issueProgress.some((issue) => issue.issueKey === "AA-94" && issue.status === "running")).toBe(true);
        releaseFirstIssue?.();
        await (0, mobile_scenario_generation_manager_1.__awaitMobileScenarioGenerationForTesting)(first.job.generationJobId);
        const completed = (0, mobile_scenario_generation_manager_1.getMobileScenarioGenerationJob)(first.job.generationJobId);
        (0, test_1.expect)(completed?.status).toBe("completed");
        (0, test_1.expect)(completed?.result?.consolidated.totalScenarios).toBe(2);
    });
    (0, test_1.test)("retries after failed job create a new generation job", async () => {
        (0, mobile_scenario_generation_manager_1.__setMobileScenarioGenerationRunnerForTesting)(async () => {
            throw new Error("provider unavailable");
        });
        const payload = { projectKey: "AA", sprintId: 1, appSlug: "app-a", selectedIssueKeys: ["AA-94"] };
        const first = await (0, mobile_scenario_generation_manager_1.startOrReuseMobileScenarioGenerationJob)(payload, { requestId: "req-1" });
        await (0, mobile_scenario_generation_manager_1.__awaitMobileScenarioGenerationForTesting)(first.job.generationJobId);
        const failed = (0, mobile_scenario_generation_manager_1.getMobileScenarioGenerationJob)(first.job.generationJobId);
        (0, test_1.expect)(failed?.status).toBe("failed");
        const second = await (0, mobile_scenario_generation_manager_1.startOrReuseMobileScenarioGenerationJob)(payload, { requestId: "req-2" });
        (0, test_1.expect)(second.reused).toBe(false);
        (0, test_1.expect)(second.job.generationJobId).not.toBe(first.job.generationJobId);
    });
    (0, test_1.test)("cache hit returns completed job without new execution", async () => {
        let calls = 0;
        (0, mobile_scenario_generation_manager_1.__setMobileScenarioGenerationRunnerForTesting)(async (_input, handlers) => {
            calls += 1;
            handlers.onIssuesResolved(["AA-94"]);
            handlers.onIssueStart({ issueKey: "AA-94", index: 0, total: 1, startedAt: new Date().toISOString() });
            handlers.onIssueCompleted({
                issueKey: "AA-94",
                index: 0,
                total: 1,
                status: "completed",
                startedAt: new Date().toISOString(),
                finishedAt: new Date().toISOString(),
                durationMs: 5,
                scenarios: [{ scenarioId: "MOBILE-AA-94-001", sourceIssueKey: "AA-94", title: "S1", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] }],
                rejected: [],
                diagnostics: diagnostics(),
            });
            return {
                scenarios: [{ scenarioId: "MOBILE-AA-94-001", sourceIssueKey: "AA-94", title: "S1", steps: [], expectedResult: "OK", preconditions: [], requiredData: [] }],
                rejected: [],
                issuesFound: 1,
                diagnosticsByIssue: { "AA-94": diagnostics() },
            };
        });
        const payload = { projectKey: "AA", sprintId: 1, appSlug: "app-a", selectedIssueKeys: ["AA-94"] };
        const first = await (0, mobile_scenario_generation_manager_1.startOrReuseMobileScenarioGenerationJob)(payload, { requestId: "req-1" });
        await (0, mobile_scenario_generation_manager_1.__awaitMobileScenarioGenerationForTesting)(first.job.generationJobId);
        const second = await (0, mobile_scenario_generation_manager_1.startOrReuseMobileScenarioGenerationJob)(payload, { requestId: "req-2" });
        (0, test_1.expect)(second.reused).toBe(true);
        (0, test_1.expect)(second.cacheHit).toBe(true);
        (0, test_1.expect)(second.job.generationJobId).toBe(first.job.generationJobId);
        (0, test_1.expect)(calls).toBe(1);
    });
});
