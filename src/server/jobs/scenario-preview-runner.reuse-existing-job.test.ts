import assert from "node:assert";
import { startReuseExistingPromotedSpecRun, type ReuseExistingPromotedSpecScenario } from "./scenario-preview-runner";
import { jobStore } from "./job-store";
import type { VerifyPromotedSpecOptions } from "../../automations/promote-plan";

/**
 * Proves the async job orchestration for `reuse_existing`: the job runs the persisted spec
 * headless, reports case_started/case_finished through the same jobStore log contract the
 * SSE stream already reads, and reaches a real terminal status — without ever spawning a
 * real Playwright process (a fake `verify` is injected).
 */

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

function scenario(overrides: Partial<ReuseExistingPromotedSpecScenario> = {}): ReuseExistingPromotedSpecScenario {
  return { scenarioId: "REC-A1DCF6A5-01", caseId: 46735, specPath: "automations/apps/kiosko/sections/default-section/cases/preview-001-kiosko2/case.spec.ts", title: "Kiosko2", ...overrides };
}

function fakeVerify(outcomeByScenarioId: Record<string, "passed" | "failed">, calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }>) {
  return async (specPath: string, _timeoutMs?: number, options?: VerifyPromotedSpecOptions) => {
    calls.push({ specPath, options });
    const status = outcomeByScenarioId[options?.scenarioId ?? ""] ?? "passed";
    return status === "passed" ? { status: "passed" as const } : { status: "failed" as const, error: "boom" };
  };
}

async function main(): Promise<void> {
  console.log("\nreuse_existing async job orchestration");

  // CASE 1/2: job is created with a queued status before the run starts, proving the caller
  // can return 202+jobId immediately — the run only transitions it once invoked.
  await test("CASE 1/2: job exists as 'queued' immediately after creation, before the run starts", () => {
    const job = jobStore.create("scenario-preview", { scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
    assert.strictEqual(job.status, "queued");
    assert.ok(job.id);
  });

  // CASE 3/4/5: the job executes exactly the persisted specPath, headless=true,
  // executionSource=qalab — and nothing else (no generation flags to check because nothing
  // else is invoked at all: verify is the only external call).
  await test("CASE 3/4/5: runs the exact persisted specPath, headless, executionSource=qalab", async () => {
    const calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }> = [];
    const job = jobStore.create("scenario-preview", { scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({}, calls));

    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].specPath, scenario().specPath);
    assert.strictEqual(calls[0].options?.headless, true);
    assert.strictEqual(calls[0].options?.executionSource, "qalab");
    assert.strictEqual(calls[0].options?.scenarioId, "REC-A1DCF6A5-01");
  });

  // CASE 7: promoted execution pass -> job finishes "done", passed=1 failed=0.
  await test("CASE 7: passing spec -> job status=done, summary passed=1 failed=0", async () => {
    const calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }> = [];
    const job = jobStore.create("scenario-preview", { scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({ "REC-A1DCF6A5-01": "passed" }, calls));

    const finalJob = jobStore.get(job.id)!;
    assert.strictEqual(finalJob.status, "done");
    assert.strictEqual(finalJob.summary?.passed, 1);
    assert.strictEqual(finalJob.summary?.failed, 0);
    assert.ok(finalJob.completedAt);
  });

  // CASE 6: promoted execution failure -> job finishes "failed", case_finished emitted with
  // status=failed, technical error preserved for diagnosis.
  await test("CASE 6: failing spec -> job status=failed, case_finished status=failed, error preserved", async () => {
    const calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }> = [];
    const job = jobStore.create("scenario-preview", { scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({ "REC-A1DCF6A5-01": "failed" }, calls));

    const finalJob = jobStore.get(job.id)!;
    assert.strictEqual(finalJob.status, "failed");
    assert.strictEqual(finalJob.summary?.passed, 0);
    assert.strictEqual(finalJob.summary?.failed, 1);
    const caseFinishedLog = finalJob.logs.find((line) => line.includes('"type":"case_finished"'));
    assert.ok(caseFinishedLog, "a case_finished event must be logged");
    const parsed = JSON.parse(caseFinishedLog!);
    assert.strictEqual(parsed.status, "failed");
    assert.strictEqual(parsed.error, "boom");
  });

  // CASE 8: multiple reuse scenarios — counts correct, each scenario resolved independently.
  await test("CASE 8: multiple scenarios — mixed outcome produces correct counts and completed_with_failures", async () => {
    const calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }> = [];
    const scenarios = [scenario({ scenarioId: "A", specPath: "a/case.spec.ts" }), scenario({ scenarioId: "B", specPath: "b/case.spec.ts" })];
    const job = jobStore.create("scenario-preview", { scenarios, executionMode: "reuse_existing_promoted_spec" });
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({ A: "passed", B: "failed" }, calls));

    const finalJob = jobStore.get(job.id)!;
    assert.strictEqual(calls.length, 2);
    assert.strictEqual(finalJob.summary?.passed, 1);
    assert.strictEqual(finalJob.summary?.failed, 1);
    assert.strictEqual(finalJob.status, "completed_with_failures");
  });

  // case_started is emitted with the right scenario identity before verification runs.
  await test("case_started is logged with the scenario's identity before verification", async () => {
    const calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }> = [];
    const job = jobStore.create("scenario-preview", { scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({}, calls));

    const finalJob = jobStore.get(job.id)!;
    const caseStartedLog = finalJob.logs.find((line) => line.includes('"type":"case_started"'));
    assert.ok(caseStartedLog);
    const parsed = JSON.parse(caseStartedLog!);
    assert.strictEqual(parsed.caseId, "REC-A1DCF6A5-01");
    assert.strictEqual(parsed.title, "Kiosko2");
  });

  // Never invokes discovery/AI/generation machinery — nothing beyond `verify` is called at
  // all, so there is nothing else to assert false; the log line documents the invariant for
  // anyone reading job logs during a real run.
  await test("logs the reuse invariants explicitly (no discovery/AI/generation/publish)", async () => {
    const calls: Array<{ specPath: string; options?: VerifyPromotedSpecOptions }> = [];
    const job = jobStore.create("scenario-preview", { scenarios: [scenario()], executionMode: "reuse_existing_promoted_spec" });
    await startReuseExistingPromotedSpecRun(job.id, fakeVerify({}, calls));

    const finalJob = jobStore.get(job.id)!;
    const startLog = finalJob.logs.find((line) => line.includes("[reuse-existing] starting"));
    assert.ok(startLog);
    for (const flag of ["routeDiscoveryInvoked=false", "mcpDiscoveryInvoked=false", "aiInvoked=false", "specGenerationInvoked=false", "recordingReplayInvoked=false"]) {
      assert.ok(startLog!.includes(flag), `expected ${flag} in: ${startLog}`);
    }
  });

  if (process.exitCode === 1) {
    console.error("\nreuse_existing async job orchestration tests FAILED");
  } else {
    console.log("\nreuse_existing async job orchestration tests PASSED");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
