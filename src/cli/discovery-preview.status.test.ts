import assert from "node:assert";
import { resolvePreviewCompletion } from "./discovery-preview";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

test("keeps valid discovered_partial as a successful event", () => {
  const result = resolvePreviewCompletion({
    caseResult: {
      status: "discovered_partial",
      steps: [{ status: "found" }, { status: "skipped" }],
    },
    promotionStatus: "pending",
  }, true);

  assert.strictEqual(result.eventStatus, "passed");
});

test("keeps failed for a real partial step error", () => {
  const result = resolvePreviewCompletion({
    caseResult: {
      status: "discovered_partial",
      steps: [{ status: "found" }, { status: "failed", error: "target not found" }],
      failedAtStep: 1,
      failedReason: "target not found",
    },
    promotionStatus: "pending",
  }, true);

  assert.strictEqual(result.eventStatus, "failed");
});

test("a passed replay whose spec promotion is deferred (runtime check not executed) is pending, not failed", () => {
  const result = resolvePreviewCompletion({
    caseResult: { status: "discovered_passed", steps: [{ status: "found" }] },
    promotionStatus: "spec_deferred",
    specGeneration: {
      provider: null,
      model: null,
      invocations: 0,
      invocationsConsumed: 0,
      promotionAllowed: false,
      specWritten: false,
      validation: { structure: "passed", typescript: "passed", functionalExecution: "skipped" },
      finalSpec: { origin: "deterministic_compiler", fallback: null },
    },
  }, true, true);

  assert.strictEqual(result.eventStatus, "passed");
  assert.strictEqual(result.specGenerationStatus, "deferred");
  assert.strictEqual(result.automationReady, false, "nothing was promoted, so the case is not automation-ready");
  assert.strictEqual(result.reason, "spec_promotion_deferred_runtime_not_executed");
});

test("a spec that failed a gate stays failed even if the promotion was also deferred", () => {
  const result = resolvePreviewCompletion({
    caseResult: { status: "discovered_passed", steps: [{ status: "found" }] },
    promotionStatus: "spec_deferred",
    specGeneration: {
      provider: null,
      model: null,
      invocations: 0,
      invocationsConsumed: 0,
      promotionAllowed: false,
      validation: { structure: "passed", typescript: "failed" },
      finalSpec: { origin: "deterministic_compiler", fallback: null },
    },
  }, true, true);

  assert.strictEqual(result.eventStatus, "failed");
  assert.strictEqual(result.specGenerationStatus, "failed");
});
