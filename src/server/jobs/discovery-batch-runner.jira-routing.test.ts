import assert from "node:assert/strict";
import test from "node:test";
import { parseJiraSemanticChildOutcome, selectJiraSemanticScenario } from "./discovery-batch-runner";
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

test("Test Design-linked TestRail cases carry the original Jira scenario and route semantically without title matching", () => {
  const source = {
    scenarioId: "PAY-7:jira:1", title: "Pagar aprobado", sourceIssueKey: "PAY-7",
    preconditions: ["Sesión iniciada"], steps: ['Presionar "Pagar"'], expectedResult: "Recibo visible",
    acceptanceCriteriaRefs: ["AC1", "AC2"], validation: { valid: true, errors: [], warnings: [] },
  } as any;
  const designScenario = {
    id: "design-1", title: source.title, preconditions: "Sesión iniciada", steps: [{ action: source.steps[0], expected: "" }],
    expectedResult: source.expectedResult, data: [], inputRequirements: [], acceptanceCriteriaRefs: ["AC1", "AC2"],
    jiraSourceScenario: source,
  } as any;
  const link = {
    testRailCaseId: 77, testRailProjectId: 15, testRailSuiteId: 1, testRailSectionId: 2, projectSlug: "payments",
    jiraProjectKey: "PAY", issueKey: "PAY-7", draftId: "d", storyId: "s", designScenarioId: "design-1",
    jiraScenarioId: source.scenarioId, contentVersion: "v1", scenario: designScenario, publishedAt: "now",
  } as any;
  const entry = { caseId: 77, scenarioId: "design-1", title: "Changed title", sourceType: "jira_preview",
    sourceIssueKey: "PAY-7", launchScenarioId: "design-1", executionScenarioId: "design-1", lineageSource: "test_design" } as any;
  const params = buildDiscoveryBatchParamsFromLaunch({
    launch: { appSlug: "payments", selectedScenarios: [], testDesignLinkedCases: [link] } as any,
    executionCaseIds: [77], publishedCases: [entry], launchId: "launch-1",
  });
  assert.equal(params.executionEngine, "jira_semantic");
  assert.deepEqual(params.jiraSemanticCaseIds, [77]);
  assert.equal((params.jiraSemanticScenarios as any[])[0].scenarioId, "design-1");
  assert.deepEqual((params.jiraSemanticScenarios as any[])[0].acceptanceCriteriaRefs, ["AC1", "AC2"]);
  assert.equal(selectJiraSemanticScenario(params as any, entry), (params.jiraSemanticScenarios as any[])[0]);
  assert.equal(selectJiraSemanticScenario(params as any, { ...entry, caseId: 78 }), undefined);
});

test("parent launch retains the matching Jira child failure step, code, phase and evidence", () => {
  const unrelated = JSON.stringify({ executionEngine: "jira_semantic", type: "case_finished", scenarioId: "AA-1:jira:other", status: "passed" });
  const failure = JSON.stringify({ executionEngine: "jira_semantic", type: "case_finished", scenarioId: "AA-1:jira:1", status: "failed",
    failedAtStep: 6, failedReason: "JIRA_ASSERTION_NOT_SATISFIED", failurePhase: "discovery", screenshotPath: ".artifacts/run/failed-1.png" });
  assert.deepEqual(parseJiraSemanticChildOutcome([unrelated, failure], "AA-1:jira:1"), {
    status: "failed", failedAtStep: 6, failedReason: "JIRA_ASSERTION_NOT_SATISFIED", failurePhase: "discovery", screenshotPath: ".artifacts/run/failed-1.png",
  });
  assert.equal(parseJiraSemanticChildOutcome([failure], "AA-1:jira:2"), undefined);
});
