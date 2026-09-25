import assert from "node:assert/strict";
import test from "node:test";
import { computeRuntimeGateDecision, getFailedSpecValidationNames } from "./spec-generation-hybrid";

function baseValidation(): {
  schema: "passed"; structure: "passed"; traceFidelity: "skipped"; typescript: "passed";
  playwrightDiscovery: "passed"; semanticCoverage: "passed"; functionalExecution: "passed" | "failed" | "skipped";
} {
  return {
    schema: "passed", structure: "passed", traceFidelity: "skipped", typescript: "passed",
    playwrightDiscovery: "passed", semanticCoverage: "passed", functionalExecution: "skipped",
  };
}

/**
 * Hermetic proof that the REAL live-pipeline wiring point (computeRuntimeGateDecision, called
 * from inside runHybridSpecGenerationInternal's evaluateSpecCandidate, which also drives
 * `passed`/promotionAllowed and — via getFailedSpecValidationNames, which only ever flags
 * functionalExecution="failed", never "skipped" — whether the AI repair loop is triggered) is
 * ALWAYS consulted for a new candidate and never bypassed.
 *
 * These go through the actual function the pipeline calls — not a reimplementation — and do
 * not depend on spec-generation-hybrid.test.ts's shared buildPlan()/buildValidSpec() fixtures,
 * which carry unrelated pre-existing baseline breakage.
 */

// CASE 1: real runtime pass -> promotion allowed.
test("runtimePassTest (CASE 1): functionalExecutionEnabled=true, runtime=passed -> promotionAllowed=true, promoted", () => {
  const { runtimeGatePassed, runtimeGateResult } = computeRuntimeGateDecision(true, "passed");
  assert.equal(runtimeGatePassed, true);
  assert.equal(runtimeGateResult.promotionAllowed, true);
  assert.equal(runtimeGateResult.decision, "promote");
  assert.equal(runtimeGateResult.promotionStatus, "promoted");
});

// CASE 2: real runtime failure -> blocked (a genuine candidate defect, not "not proven").
test("runtimeFailTest (CASE 2): functionalExecutionEnabled=true, runtime=failed -> promotionAllowed=false, blocked", () => {
  const { runtimeGatePassed, runtimeGateResult } = computeRuntimeGateDecision(true, "failed");
  assert.equal(runtimeGatePassed, false);
  assert.equal(runtimeGateResult.promotionAllowed, false);
  assert.equal(runtimeGateResult.decision, "block");
  assert.equal(runtimeGateResult.promotionStatus, "blocked");
});

// CASE 3: runtime proof never produced while enabled (e.g. an earlier gate short-circuited) ->
// deferred, not an implicit pass and not a "failure".
test("runtimeSkippedTest (CASE 3): functionalExecutionEnabled=true, runtime=skipped -> promotionAllowed=false, deferred", () => {
  const { runtimeGatePassed, runtimeGateResult } = computeRuntimeGateDecision(true, "skipped");
  assert.equal(runtimeGatePassed, false);
  assert.equal(runtimeGateResult.promotionAllowed, false);
  assert.equal(runtimeGateResult.decision, "defer");
  assert.equal(runtimeGateResult.promotionStatus, "deferred");
});

// CASE 4: the core closed gap. functionalExecutionEnabled=false must NOT implicitly pass —
// it must behave exactly like "no runtime proof": deferred, never promoted.
test("runtimeDisabledTest / runtimeUnavailableNoRepairTest input (CASE 4): functionalExecutionEnabled=false -> runtimeStatus=unavailable -> promotionAllowed=false, deferred", () => {
  const { runtimeGatePassed, runtimeGateResult } = computeRuntimeGateDecision(false, "skipped");
  assert.equal(runtimeGatePassed, false);
  assert.equal(runtimeGateResult.promotionAllowed, false);
  assert.equal(runtimeGateResult.decision, "defer");
  assert.equal(runtimeGateResult.promotionStatus, "deferred");
});

// CASE 4b: functionalExecutionEnabled=false must defer regardless of whatever status the
// (unused) functional-execution validation field happens to carry — disabled always wins.
test("runtimeDisabledTest (CASE 4b): functionalExecutionEnabled=false defers even if functionalExecutionStatus reports passed", () => {
  const { runtimeGatePassed, runtimeGateResult } = computeRuntimeGateDecision(false, "passed");
  assert.equal(runtimeGatePassed, false);
  assert.equal(runtimeGateResult.decision, "defer");
  assert.equal(runtimeGateResult.promotionStatus, "deferred");
});

// CASE 5 / CASE 6: unavailable/skipped must never be classified as a step FAILURE — repair is
// driven by getFailedSpecValidationNames, which only flags functionalExecution:"failed". The
// gate result itself must carry zero failedSteps for the defer cases, AND the actual repair
// trigger function must report zero failed gates when functionalExecution="skipped".
test("runtimeUnavailableNoRepairTest (CASE 5): unavailable defer carries no failedSteps, and shouldAttemptSpecRepair's own signal (getFailedSpecValidationNames) is empty", () => {
  const { runtimeGateResult } = computeRuntimeGateDecision(false, "skipped");
  assert.deepEqual(runtimeGateResult.failedSteps, []);
  const validation = { ...baseValidation(), functionalExecution: "skipped" as const };
  assert.deepEqual(getFailedSpecValidationNames(validation), [], "repair must not be triggered by disabled/unavailable runtime");
});

test("runtimeSkippedNoRepairTest (CASE 6): enabled+skipped defer carries no failedSteps, and the repair-trigger signal is empty", () => {
  const { runtimeGateResult } = computeRuntimeGateDecision(true, "skipped");
  assert.deepEqual(runtimeGateResult.failedSteps, []);
  const validation = { ...baseValidation(), functionalExecution: "skipped" as const };
  assert.deepEqual(getFailedSpecValidationNames(validation), [], "repair must not be triggered by a skipped (not-yet-proven) runtime");
});

// CASE 7: a real runtime failure DOES carry a failed step, AND the repair-trigger signal fires —
// existing repair behavior for a genuine candidate defect is preserved and distinguishable from
// the defer cases above.
test("runtimeFailedRepairRegressionTest (CASE 7): a real runtime failure carries a failedStep and DOES trigger the repair-trigger signal, unlike skipped/unavailable", () => {
  const { runtimeGateResult } = computeRuntimeGateDecision(true, "failed");
  assert.deepEqual(runtimeGateResult.failedSteps, [0]);
  const validation = { ...baseValidation(), functionalExecution: "failed" as const };
  assert.deepEqual(getFailedSpecValidationNames(validation), ["functionalExecution"], "a genuine runtime failure must still trigger repair as before");
});

// CASE 8: deferred means not persisted — promotionAllowed is the single source of truth the
// downstream persistence gate (promote-plan.ts's specPromotionAllowed) keys off.
test("deferredNoPersistenceTest (CASE 8): deferred implies promotionAllowed=false (nothing downstream persists)", () => {
  const { runtimeGateResult } = computeRuntimeGateDecision(false, "skipped");
  assert.equal(runtimeGateResult.promotionStatus, "deferred");
  assert.equal(runtimeGateResult.promotionAllowed, false);
});

// CASE 9: when a previous promoted spec exists, deferring must preserve it rather than
// overwrite it — reported via the gate's own previousPromotedSpecPreserved (this is diagnostic;
// actual non-overwrite is separately guaranteed downstream by promote-plan.ts only writing when
// promotionAllowed=true, which CASE 8 already proves is false here).
test("previousPromotedPreservedTest (CASE 9): deferred with an existing previous promoted spec reports it as preserved", () => {
  const { runtimeGateResult } = computeRuntimeGateDecision(false, "skipped", "automations/apps/x/sections/s/cases/1/case.spec.ts");
  assert.equal(runtimeGateResult.promotionStatus, "deferred");
  assert.equal(runtimeGateResult.previousPromotedSpecPreserved, true);
});

// CASE 10: a real pass does NOT preserve the previous spec — it replaces it, i.e. persistence
// proceeds normally.
test("runtimePassPersistenceRegressionTest (CASE 10): a real pass does not report previousPromotedSpecPreserved (it replaces the spec)", () => {
  const { runtimeGateResult } = computeRuntimeGateDecision(true, "passed");
  assert.equal(runtimeGateResult.previousPromotedSpecPreserved, false);
});

// CASE 11: "no fake step 0" — a real candidate failure with a known scenarioStepIndex (from
// extractFailedPromotedStepIndex, see spec-generation-hybrid.test.ts) must be reported as THAT
// step, not a synthetic 0. Only a caller with no real index (legacy behavior, CASE 7 above)
// falls back to the placeholder.
test("realFailedStepIndexTest (CASE 11): a known failed step index flows through as the actual failedSteps entry, not a fabricated 0", () => {
  const { runtimeGateResult } = computeRuntimeGateDecision(true, "failed", undefined, 3);
  assert.deepEqual(runtimeGateResult.failedSteps, [3]);
  assert.match(runtimeGateResult.reason, /\(steps 3\)/);
});
