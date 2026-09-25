import assert from "node:assert";
import test from "node:test";
import { evaluateSpecRuntimeGate } from "./spec-runtime-gate";

// CASE J: runtime unavailable/skipped -> deferred, never silently promoted.
test("CASE J: runtime unavailable defers promotion instead of allowing it", () => {
  const result = evaluateSpecRuntimeGate({ availability: "unavailable", steps: [] });
  assert.equal(result.decision, "defer");
  assert.equal(result.promotionAllowed, false);
  assert.equal(result.promotionStatus, "deferred");
});

// CASE H: a required step fails -> blocked, and any previous promoted spec is preserved.
test("CASE H: a failed required step blocks promotion and preserves the previous promoted spec", () => {
  const result = evaluateSpecRuntimeGate({
    availability: "available",
    steps: [
      { stepIndex: 1, required: true, status: "passed" },
      { stepIndex: 4, required: true, status: "failed" },
    ],
    previousPromotedSpecPath: "automations/apps/kiosko/.../case.spec.ts",
  });
  assert.equal(result.decision, "block");
  assert.equal(result.promotionAllowed, false);
  assert.equal(result.promotionStatus, "blocked");
  assert.deepEqual(result.failedSteps, [4]);
  assert.equal(result.previousPromotedSpecPreserved, true);
});

// CASE I: every required step passes -> promotion allowed.
test("CASE I: all required steps passing allows promotion", () => {
  const result = evaluateSpecRuntimeGate({
    availability: "available",
    steps: [
      { stepIndex: 1, required: true, status: "passed" },
      { stepIndex: 2, required: true, status: "passed" },
      { stepIndex: 3, required: false, status: "failed" }, // non-required failure is irrelevant
    ],
  });
  assert.equal(result.decision, "promote");
  assert.equal(result.promotionAllowed, true);
  assert.equal(result.promotionStatus, "promoted");
  assert.deepEqual(result.failedSteps, []);
});

// Runtime ran but reported nothing required -> nothing was actually proven; defer, not promote.
test("runtime available with zero required steps defers rather than promoting blindly", () => {
  const result = evaluateSpecRuntimeGate({ availability: "available", steps: [] });
  assert.equal(result.decision, "defer");
  assert.equal(result.promotionAllowed, false);
});

// CASE K: this policy only governs NEW candidate promotion — it says nothing about, and must
// never be consulted by, the reuse_existing fast path for an already-fresh promoted spec. This
// test documents that boundary: the gate has no notion of "reuse", it only ever answers "is
// this brand-new candidate's runtime proof sufficient to promote it".
test("CASE K: the gate has no reuse-path concept — it only ever evaluates a new candidate's own runtime proof", () => {
  const result = evaluateSpecRuntimeGate({
    availability: "available",
    steps: [{ stepIndex: 1, required: true, status: "passed" }],
  });
  assert.deepEqual(Object.keys(result).sort(), [
    "decision",
    "failedSteps",
    "previousPromotedSpecPreserved",
    "promotionAllowed",
    "promotionStatus",
    "reason",
  ]);
  // No field references TestRail, jobs, SSE, headless, or reuse — confirming this module
  // cannot accidentally be mistaken for, or interfere with, the reuse_existing decision engine.
  // Word-boundary matched: "passed" legitimately contains the substring "sse".
  const serialized = JSON.stringify(result).toLowerCase();
  for (const forbidden of ["testrail", "reuse_existing", "headless", "jobid", "\\bsse\\b"]) {
    assert.ok(!new RegExp(forbidden).test(serialized), `result must not reference "${forbidden}"`);
  }
});

test("previousPromotedSpecPreserved is false only on a successful promotion (it replaces the previous spec then)", () => {
  const promoted = evaluateSpecRuntimeGate({
    availability: "available",
    steps: [{ stepIndex: 1, required: true, status: "passed" }],
    previousPromotedSpecPath: "some/path/case.spec.ts",
  });
  assert.equal(promoted.previousPromotedSpecPreserved, false);

  const deferred = evaluateSpecRuntimeGate({
    availability: "unavailable",
    steps: [],
    previousPromotedSpecPath: "some/path/case.spec.ts",
  });
  assert.equal(deferred.previousPromotedSpecPreserved, true);
});
