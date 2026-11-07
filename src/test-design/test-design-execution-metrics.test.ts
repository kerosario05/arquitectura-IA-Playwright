import assert from "node:assert/strict";
import test from "node:test";
import { computeTestDesignExecutionMetrics, executionMetricsRange, type DesignCaseExecution } from "./test-design-execution-metrics";
import type { TestDesignDraftWithStories, TestDesignScenario } from "./test-design.types";

const NOW = new Date("2026-10-27T12:00:00.000Z");

function scenario(id: string, caseId: number | null): TestDesignScenario {
  return {
    id, title: `Caso ${id}`, preconditions: "", steps: [{ action: "a", expected: "b" }], data: [],
    expectedResult: "ok", priority: "medium", type: "functional", selectedForTestRail: true, selectedForJira: false,
    testRailCaseId: caseId, origin: "ai", edited: false,
  };
}

function draft(id: string, projectSlug: string | null, scenarios: TestDesignScenario[], status: TestDesignDraftWithStories["status"] = "published"): TestDesignDraftWithStories {
  return {
    id, title: null, projectSlug, jiraProjectKey: "AA", testRail: { projectId: 1, suiteId: null, sectionId: 2 },
    instructions: null, status, createdBy: null, createdByName: null, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    stories: [{
      id: `${id}-s`, draftId: id, issueKey: "AA-1", issueSummary: "", position: 0, generationStatus: "ready", generationError: null,
      scenarios, jiraSubtaskKey: null, jiraPublishedAt: null, testRailPublishedAt: null,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(),
    }],
  };
}

const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const run = (caseId: number, result: "passed" | "failed", days: number, launchId = `L${caseId}-${days}`): DesignCaseExecution =>
  ({ caseId, result, executedAt: daysAgo(days), launchId });

test("funnel counts designed, published, executed and the latest result per case", () => {
  const drafts = [draft("d1", "fenix", [scenario("a", 101), scenario("b", 102), scenario("c", 103), scenario("d", null)])];
  const executions = [
    run(101, "failed", 5), run(101, "passed", 2), // latest passed wins
    run(102, "failed", 1),
    run(999, "passed", 1), // not a design case
  ];
  const m = computeTestDesignExecutionMetrics(drafts, executions, executionMetricsRange(30, NOW));
  assert.deepEqual(m.funnel, { designed: 4, published: 3, executed: 2, passed: 1, failed: 1, notExecuted: 1 });
  assert.equal(m.passRate, 0.5);
  assert.equal(m.executions, 3);
  assert.deepEqual(m.recent.map((r) => [r.caseId, r.result]), [[102, "failed"], [101, "passed"], [101, "failed"]]);
});

test("executions outside the period are ignored", () => {
  const drafts = [draft("d1", "fenix", [scenario("a", 101)])];
  const m = computeTestDesignExecutionMetrics(drafts, [run(101, "passed", 40)], executionMetricsRange(30, NOW));
  assert.equal(m.funnel.executed, 0);
  assert.equal(m.funnel.notExecuted, 1);
  assert.equal(m.passRate, null);
});

test("archived drafts keep their published cases but leave the designed count", () => {
  const drafts = [draft("d1", "fenix", [scenario("a", 101), scenario("b", null)], "archived")];
  const m = computeTestDesignExecutionMetrics(drafts, [run(101, "passed", 1)], executionMetricsRange(30, NOW));
  assert.equal(m.funnel.designed, 0);
  assert.equal(m.funnel.published, 1);
  assert.equal(m.funnel.passed, 1);
});

test("a case present in two drafts counts once", () => {
  const drafts = [draft("d1", "fenix", [scenario("a", 101)]), draft("d2", "fenix", [scenario("a2", 101)])];
  const m = computeTestDesignExecutionMetrics(drafts, [run(101, "passed", 1)], executionMetricsRange(30, NOW));
  assert.equal(m.funnel.published, 1);
  assert.equal(m.funnel.executed, 1);
});

test("weekly buckets, per-project rows and TestRail links", () => {
  const drafts = [
    draft("d1", "fenix", [scenario("a", 101), scenario("b", 102)]),
    draft("d2", "kiosko", [scenario("c", 201)]),
  ];
  const executions = [run(101, "passed", 1), run(102, "failed", 10), run(201, "passed", 25)];
  const m = computeTestDesignExecutionMetrics(drafts, executions, executionMetricsRange(28, NOW), {
    projectNames: new Map([["fenix", "Fénix"]]),
    testRailBaseUrl: "https://tr.example/",
  });
  assert.equal(m.weekly.length, 4);
  assert.deepEqual(m.weekly.map((w) => [w.passed, w.failed]), [[1, 0], [0, 0], [0, 1], [1, 0]]);
  assert.deepEqual(
    m.byProject.map((p) => [p.projectName, p.published, p.executed, p.passed, p.failed]),
    [["Fénix", 2, 2, 1, 1], ["kiosko", 1, 1, 1, 0]],
  );
  assert.equal(m.recent[0].caseUrl, "https://tr.example/index.php?/cases/view/101");
});
