import test from "node:test";
import assert from "node:assert/strict";
import { resolveClickRetryPolicy } from "./click-retry-policy";

test("in-place click with no retry outcome does not escalate", () => {
  assert.deepEqual(resolveClickRetryPolicy({
    recordingActionType: "click",
    actionType: "action_click",
    transitionDetected: false,
    selectionApplied: false,
    observableOutcome: true,
  }), { navigationExpected: false, retryRequired: false });
});

test("editor activation is accepted from an observable in-place outcome", () => {
  assert.equal(resolveClickRetryPolicy({
    recordingActionType: "click",
    actionType: "action_click",
    transitionDetected: false,
    selectionApplied: false,
    observableOutcome: true,
  }).retryRequired, false);
});

test("force/JS fallback remains available when no outcome is observable", () => {
  assert.equal(resolveClickRetryPolicy({
    recordingActionType: "click",
    actionType: "action_click",
    transitionDetected: false,
    selectionApplied: false,
    observableOutcome: false,
  }).retryRequired, true);
});

test("navigation still requires transition when no transition was observed", () => {
  assert.deepEqual(resolveClickRetryPolicy({
    recordingActionType: "navigation",
    transitionDetected: false,
    selectionApplied: false,
    observableOutcome: true,
  }), { navigationExpected: true, retryRequired: true });
});
