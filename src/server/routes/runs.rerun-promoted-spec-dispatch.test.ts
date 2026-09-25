import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

/**
 * Structural regression guard for POST /api/runs/:jobId/rerun's promoted-spec reuse dispatch.
 * Mounting the full route needs a real job store / filesystem fixtures for a disproportionate
 * request-shape check — the runtime behavior itself (reuse job runs headless with zero
 * discovery/AI) is already covered by scenario-preview-runner.reuse-existing-job.test.ts and
 * rerun-runner.promoted-spec-reuse.test.ts. This pins the exact dispatch contract: an
 * all-reusable rerun goes through startReuseExistingPromotedSpecRun and returns before ever
 * reaching startScenarioPreviewRun.
 */
const source = fs.readFileSync(path.join(__dirname, "runs.ts"), "utf-8");

type AsyncTestFn = () => void | Promise<void>;

async function test(label: string, fn: AsyncTestFn): Promise<void> {
  try {
    await fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

async function main(): Promise<void> {
  console.log("\nruns /rerun — promoted-spec reuse dispatch");

  await test("1. prepareRerun is awaited (its promoted-spec resolution is async)", () => {
    assert.ok(source.includes("await prepareRerun(jobId, mode, previous?.type)"));
  });

  await test("2. an all-reusable rerun dispatches startReuseExistingPromotedSpecRun and returns before the scenario-preview payload/dispatch block", () => {
    const reuseIdx = source.indexOf("if (prepared.allReusable)");
    const dispatchIdx = source.indexOf("setImmediate(() => startReuseExistingPromotedSpecRun(reuseJob.id))");
    const returnIdx = source.indexOf("return;", dispatchIdx);
    const fallbackBuildPayloadIdx = source.indexOf("// 4. Build new job payload");
    assert.ok(reuseIdx !== -1 && dispatchIdx !== -1 && returnIdx !== -1 && fallbackBuildPayloadIdx !== -1);
    assert.ok(reuseIdx < dispatchIdx, "the allReusable check must precede the reuse dispatch");
    assert.ok(dispatchIdx < returnIdx, "the reuse dispatch must be followed by an early return");
    assert.ok(returnIdx < fallbackBuildPayloadIdx, "the reuse branch must return before ever reaching the scenario-preview payload/dispatch block");
  });

  await test("3. the reuse branch never calls startScenarioPreviewRun (no discovery/AI reachable from it)", () => {
    const reuseIdx = source.indexOf("if (prepared.allReusable)");
    const returnIdx = source.indexOf("return;", source.indexOf("setImmediate(() => startReuseExistingPromotedSpecRun(reuseJob.id))"));
    const reuseBlock = source.slice(reuseIdx, returnIdx);
    assert.ok(!reuseBlock.includes("startScenarioPreviewRun"));
  });

  await test("4. a non-all-reusable rerun (missing/stale spec) still falls through to the existing startScenarioPreviewRun fallback, unchanged", () => {
    assert.ok(source.includes("setImmediate(() => startScenarioPreviewRun(newJob.id));"), "the pre-existing fallback dispatch must still exist for mixed/non-reusable reruns");
  });

  await test("5. a mixed batch (some reusable, some not) is dispatched to the mixed-rerun orchestrator, not silently folded into the full scenario-preview fallback", () => {
    assert.ok(source.includes("classification=MIXED_RERUN dispatch=mixed_rerun_orchestrator"));
    assert.ok(source.includes("startMixedRerun("));
  });

  await test("6. canonical identity flows through: reuse job scenarios are built from promotedSpecReuse entries, not from title/index-derived data", () => {
    assert.ok(source.includes("prepared.promotedSpecReuse.map((entry) => ({"));
    assert.ok(source.includes("scenarioId: entry.scenarioId"));
  });

  if (process.exitCode === 1) {
    console.error("\nrerun promoted-spec dispatch tests FAILED");
  } else {
    console.log("\nrerun promoted-spec dispatch tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
