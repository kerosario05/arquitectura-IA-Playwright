import { expect, test } from "@playwright/test";
import {
  __awaitMobileScenarioGenerationForTesting,
  __resetMobileScenarioGenerationStateForTesting,
  __setMobileScenarioGenerationRunnerForTesting,
  getMobileScenarioGenerationJob,
  startOrReuseMobileScenarioGenerationJob,
} from "../src/server/jobs/mobile-scenario-generation-manager";

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
  } as const;
}

test.describe("mobile scenario generation manager", () => {
  test.afterEach(() => {
    __setMobileScenarioGenerationRunnerForTesting(null);
    __resetMobileScenarioGenerationStateForTesting();
  });

  test("shares one running job for equivalent concurrent requests", async () => {
    let releaseFirstIssue: (() => void) | null = null;
    let runnerCalls = 0;
    __setMobileScenarioGenerationRunnerForTesting(async (_input, handlers) => {
      runnerCalls += 1;
      handlers.onIssuesResolved(["AA-94", "AA-93"]);
      handlers.onIssueStart({ issueKey: "AA-94", index: 0, total: 2, startedAt: new Date().toISOString() });
      await new Promise<void>((resolve) => {
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
    const first = await startOrReuseMobileScenarioGenerationJob(payload, { requestId: "req-1" });
    const second = await startOrReuseMobileScenarioGenerationJob(payload, { requestId: "req-2" });

    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(second.cacheHit).toBe(false);
    expect(first.job.generationJobId).toBe(second.job.generationJobId);
    expect(runnerCalls).toBe(1);

    const running = getMobileScenarioGenerationJob(first.job.generationJobId);
    expect(running?.status).toBe("running");
    expect(running?.issueProgress.some((issue) => issue.issueKey === "AA-94" && issue.status === "running")).toBe(true);

    releaseFirstIssue?.();
    await __awaitMobileScenarioGenerationForTesting(first.job.generationJobId);
    const completed = getMobileScenarioGenerationJob(first.job.generationJobId);
    expect(completed?.status).toBe("completed");
    expect(completed?.result?.consolidated.totalScenarios).toBe(2);
  });

  test("retries after failed job create a new generation job", async () => {
    __setMobileScenarioGenerationRunnerForTesting(async () => {
      throw new Error("provider unavailable");
    });
    const payload = { projectKey: "AA", sprintId: 1, appSlug: "app-a", selectedIssueKeys: ["AA-94"] };
    const first = await startOrReuseMobileScenarioGenerationJob(payload, { requestId: "req-1" });
    await __awaitMobileScenarioGenerationForTesting(first.job.generationJobId);
    const failed = getMobileScenarioGenerationJob(first.job.generationJobId);
    expect(failed?.status).toBe("failed");

    const second = await startOrReuseMobileScenarioGenerationJob(payload, { requestId: "req-2" });
    expect(second.reused).toBe(false);
    expect(second.job.generationJobId).not.toBe(first.job.generationJobId);
  });

  test("cache hit returns completed job without new execution", async () => {
    let calls = 0;
    __setMobileScenarioGenerationRunnerForTesting(async (_input, handlers) => {
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
    const first = await startOrReuseMobileScenarioGenerationJob(payload, { requestId: "req-1" });
    await __awaitMobileScenarioGenerationForTesting(first.job.generationJobId);
    const second = await startOrReuseMobileScenarioGenerationJob(payload, { requestId: "req-2" });

    expect(second.reused).toBe(true);
    expect(second.cacheHit).toBe(true);
    expect(second.job.generationJobId).toBe(first.job.generationJobId);
    expect(calls).toBe(1);
  });
});
