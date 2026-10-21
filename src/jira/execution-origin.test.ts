import assert from "node:assert/strict";
import test from "node:test";
import { inferLegacyJiraRerunOrigin, resolveExecutionEngine } from "./execution-origin";

const jiraScenarios = [
  { scenarioId: "PREVIEW-001", sourceIssueKey: "AA-88" },
  { scenarioId: "PREVIEW-002", sourceIssueKey: "AA-88" },
];

test("historical Jira reruns recover provenance only when every selected scenario has matching issue lineage", () => {
  const origin = inferLegacyJiraRerunOrigin("AA-88", jiraScenarios);
  assert.deepEqual(origin, { kind: "jira_generated", jiraKey: "AA-88" });
  assert.equal(resolveExecutionEngine({ executionEngine: "jira_semantic", scenarioOrigin: origin, jiraKey: "AA-88", scenarios: jiraScenarios }), "jira_semantic");
});

test("legacy Jira rerun inference rejects mixed Jira keys and incomplete scenario identity", () => {
  assert.equal(inferLegacyJiraRerunOrigin("AA-88", [{ ...jiraScenarios[0]!, sourceIssueKey: "BB-1" }]), undefined);
  assert.equal(inferLegacyJiraRerunOrigin("AA-88", [{ sourceIssueKey: "AA-88" }]), undefined);
  assert.equal(inferLegacyJiraRerunOrigin("not-a-key", jiraScenarios), undefined);
});

test("legacy Jira rerun inference rejects any persisted Recording lineage", () => {
  for (const recordingFields of [
    { recordingId: "recording-1" },
    { recordedScenarioId: "REC-01" },
    { recordingExecutionContract: {} },
    { canonicalInteractions: [] },
    { recordingHumanContent: true },
  ]) {
    assert.equal(inferLegacyJiraRerunOrigin("AA-88", [{ ...jiraScenarios[0]!, ...recordingFields }]), undefined);
  }
  assert.equal(resolveExecutionEngine({}), "legacy");
});
