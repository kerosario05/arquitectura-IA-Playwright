import assert from "node:assert/strict";
import test from "node:test";
import { projectJiraChildEvent, type JiraRelayCaseState } from "./discovery-batch-runner";

const CASE = "AA-116:jira:1:edited-abc";
const line = (event: Record<string, unknown>) => JSON.stringify({ executionEngine: "jira_semantic", caseId: CASE, ...event });
const fresh = (): JiraRelayCaseState => ({ steps: [], startedAt: new Map() });

test("a step event names its step and the total, and a finished step reports its duration", () => {
  const state = fresh();
  projectJiraChildEvent(line({ type: "case_started", title: "t", steps: ["Abrir la aplicación", "Presionar \"Nueva solicitud\""] }), CASE, state, 1000);
  const resolving = projectJiraChildEvent(line({ type: "step_progress", stepIndex: 2, phase: "resolving" }), CASE, state, 2000);
  assert.equal(resolving?.stepText, "Presionar \"Nueva solicitud\"");
  assert.equal(resolving?.totalSteps, 2);
  assert.equal(resolving?.durationMs, undefined);
  const passed = projectJiraChildEvent(line({ type: "step_progress", stepIndex: 2, phase: "passed" }), CASE, state, 11500);
  assert.equal(passed?.durationMs, 9500);
  assert.equal(passed?.stepText, "Presionar \"Nueva solicitud\"");
});

test("a failed case shows which step failed and the failure code", () => {
  const state = fresh();
  projectJiraChildEvent(line({ type: "case_started", steps: ["a", "b", "Presionar \"Nueva solicitud\""] }), CASE, state);
  const finished = projectJiraChildEvent(line({ type: "case_finished", status: "failed", failedAtStep: 3, failedReason: "JIRA_TARGET_AMBIGUOUS", title: "t" }), CASE, state);
  assert.equal(finished?.failedStepText, "Presionar \"Nueva solicitud\"");
  assert.equal(finished?.failedReason, "JIRA_TARGET_AMBIGUOUS");
  assert.equal(finished?.failedAtStep, 3);
});

test("only an error code is shown as the reason, never a free-form message", () => {
  const state = fresh();
  const finished = projectJiraChildEvent(line({ type: "case_finished", status: "failed", failedAtStep: 1, failedReason: "locator.fill: Error: could not type secret value" }), CASE, state);
  assert.equal(finished?.failedReason, undefined);
});

test("a passed case carries no failure fields, and other cases' events are ignored", () => {
  const state = fresh();
  const passed = projectJiraChildEvent(line({ type: "case_finished", status: "passed", failedReason: "JIRA_X_Y" }), CASE, state);
  assert.equal(passed?.status, "passed");
  assert.equal(passed?.failedReason, undefined);
  assert.equal(projectJiraChildEvent(JSON.stringify({ executionEngine: "jira_semantic", caseId: "other", type: "step_progress", stepIndex: 1, phase: "passed" }), CASE, state), undefined);
});
