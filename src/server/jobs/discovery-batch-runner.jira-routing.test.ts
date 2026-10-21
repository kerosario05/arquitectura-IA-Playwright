import assert from "node:assert/strict";
import test from "node:test";
import { selectJiraSemanticScenario } from "./discovery-batch-runner";
import { buildDiscoveryBatchParamsFromLaunch } from "./launch-orchestrator";

const origin = { kind: "jira_generated", jiraKey: "AA-1" };
const scenario = { scenarioId: "AA-1:jira:1", title: "t", sourceIssueKey: "AA-1" };
const jiraEntry = { scenarioId: "L-1", caseId: 10, title: "t", sourceType: "jira_preview", launchScenarioId: "AA-1:jira:1" } as const;
const jiraParams = { executionEngine: "jira_semantic", scenarioOrigin: origin, jiraSemanticScenarios: [scenario] };

test("jira_preview case on a jira_semantic launch routes to its Jira scenario, regardless of appSlug", () => {
  assert.equal(selectJiraSemanticScenario(jiraParams, jiraEntry), scenario);
});

test("TestRail-only, legacy, and unmatched cases keep the generic discovery path", () => {
  assert.equal(selectJiraSemanticScenario(jiraParams, { ...jiraEntry, sourceType: "testrail_case" }), undefined);
  assert.equal(selectJiraSemanticScenario({ jiraSemanticScenarios: [scenario] }, jiraEntry), undefined);
  assert.equal(selectJiraSemanticScenario(jiraParams, { ...jiraEntry, launchScenarioId: "other" }), undefined);
  assert.equal(selectJiraSemanticScenario(jiraParams, undefined), undefined);
});

test("launch handoff carries Jira scenarios only for jira_semantic launches", () => {
  const base = { appSlug: "x", selectedScenarios: [scenario] } as any;
  const common = { executionCaseIds: [10], publishedCases: [jiraEntry], launchId: "l" };
  const jira = buildDiscoveryBatchParamsFromLaunch({ ...common, launch: { ...base, executionEngine: "jira_semantic", scenarioOrigin: origin } });
  assert.deepEqual(jira.jiraSemanticScenarios, [scenario]);
  assert.equal(jira.executionEngine, "jira_semantic");
  const legacy = buildDiscoveryBatchParamsFromLaunch({ ...common, launch: base });
  assert.equal("jiraSemanticScenarios" in legacy, false);
});
