import assert from "node:assert/strict";
import test from "node:test";
import { isAuthTransientNoResponse, resolveAuthTransientRetryMax } from "./auth-transient-retry";

const pendingAttempt = {
  submitClicked: true,
  requestObserved: true,
  responseObserved: false,
  requestFailed: false,
  authSurfacePresent: true,
  protectedSurfaceDetected: false,
  terminalErrorVisible: false,
  absoluteDeadlineReached: true,
  events: [{ state: "pending" as const }],
};

test("classifies pending auth submit as transient no-response", () => {
  assert.equal(isAuthTransientNoResponse(pendingAttempt), true);
});

test("does not retry a terminal response or authenticated state", () => {
  assert.equal(isAuthTransientNoResponse({ ...pendingAttempt, responseObserved: true }), false);
  assert.equal(isAuthTransientNoResponse({ ...pendingAttempt, protectedSurfaceDetected: true }), false);
  assert.equal(isAuthTransientNoResponse({ ...pendingAttempt, events: [{ state: "completed", status: 401 }] }), false);
});

test("retry maximum is bounded to one attempt", () => {
  assert.equal(resolveAuthTransientRetryMax(undefined), 1);
  assert.equal(resolveAuthTransientRetryMax("4"), 1);
  assert.equal(resolveAuthTransientRetryMax("0"), 0);
  assert.equal(resolveAuthTransientRetryMax("invalid"), 1);
});
