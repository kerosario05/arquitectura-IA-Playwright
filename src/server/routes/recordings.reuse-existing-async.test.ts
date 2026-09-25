import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

/**
 * Structural regression guard: `/execute`'s reuse_existing branch must never await
 * Playwright inline. Mounting the full route needs a real TestRail client / recording
 * fixtures / a real spec file, which is disproportionate for what is, here, a request-shape
 * change — this pins the exact contract the runtime tests
 * (scenario-preview-runner.reuse-existing-job.test.ts) then exercise: a job is created, the
 * run is dispatched via setImmediate (never awaited by the request), and the response is
 * 202 with a jobId, not a 200 carrying a finished verification result.
 */
const source = fs.readFileSync(path.join(__dirname, "recordings.ts"), "utf-8");

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
  console.log("\nrecordings /execute — reuse_existing never blocks the request on Playwright");

  await test("the reuse branch never awaits verifyPromotedSpec inside the request handler", () => {
    // verifyPromotedSpec now only runs inside startReuseExistingPromotedSpecRun (the
    // background job), never directly in recordings.ts.
    assert.ok(!source.includes("await verifyPromotedSpec("));
    assert.ok(!source.includes('import { verifyPromotedSpec } from "../../automations/promote-plan"'));
  });

  await test("the reuse branch creates a job and dispatches it via setImmediate before responding", () => {
    assert.ok(source.includes('jobStore.create("scenario-preview"'));
    assert.ok(source.includes("setImmediate(() => startReuseExistingPromotedSpecRun(reuseJob.id))"));
  });

  await test("the all-reuse response is 202 with a jobId, not a synchronous 200", () => {
    const match = source.match(/if \(selected\.length === 0\) \{\s*res\.status\((\d+)\)\.json\(\{\s*ok: true,\s*jobId: reuseJobId,/);
    assert.ok(match, "expected the all-reuse branch to respond 202 with jobId: reuseJobId");
    assert.strictEqual(match?.[1], "202");
  });

  if (process.exitCode === 1) {
    console.error("\nreuse_existing async response tests FAILED");
  } else {
    console.log("\nreuse_existing async response tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
