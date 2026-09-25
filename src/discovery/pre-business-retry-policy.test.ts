import test from "node:test";
import assert from "node:assert/strict";
import { isTransientPreBusinessFailure, shouldRetryScenario } from "./pre-business-retry-policy";

const transientFailure = {
  businessSurfaceReached: false,
  failureClassification: "POST_AUTH_NAVIGATION_FAILURE",
  authRejected: false,
  applicationError: false,
  functionalBusinessExecutionStarted: false,
  oracleEvaluationStarted: false,
};

test("pre-business post-auth navigation failure retries once", () => {
  assert.equal(shouldRetryScenario({ ...transientFailure, attempt: 1 }), true);
  assert.equal(shouldRetryScenario({ ...transientFailure, attempt: 2 }), false);
});

test("second transient failure is terminal", () => {
  assert.equal(isTransientPreBusinessFailure(transientFailure), true);
  assert.equal(shouldRetryScenario({ ...transientFailure, attempt: 2 }), false);
});

test("auth rejection never retries", () => {
  assert.equal(isTransientPreBusinessFailure({ ...transientFailure, authRejected: true }), false);
});

test("business failure never retries", () => {
  assert.equal(isTransientPreBusinessFailure({ ...transientFailure, businessSurfaceReached: true }), false);
});

test("application and functional failures never retry", () => {
  assert.equal(isTransientPreBusinessFailure({ ...transientFailure, applicationError: true }), false);
  assert.equal(isTransientPreBusinessFailure({ ...transientFailure, functionalBusinessExecutionStarted: true }), false);
  assert.equal(isTransientPreBusinessFailure({ ...transientFailure, oracleEvaluationStarted: true }), false);
});
