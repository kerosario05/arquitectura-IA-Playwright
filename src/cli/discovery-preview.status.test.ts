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
