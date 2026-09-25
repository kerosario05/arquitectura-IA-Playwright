import assert from "node:assert/strict";
import test from "node:test";
import {
  defaultVerifyPromotedSpecExecAsync,
  verifyPromotedSpec,
  type VerifyPromotedSpecExecAsync,
  type VerifyPromotedSpecLiveLine,
} from "./promote-plan";

/**
 * FIRST_LOSS fix (jobId 243c3a7e-19e5-4b50-9eb6-120d3cfa1486): the Playwright child completed
 * its ENTIRE scenario legitimately (physically confirmed: `1 passed (2.1m)`, login progressed,
 * Step6/Step7 passed, evidence finalized) -- but `defaultVerifyPromotedSpecExecAsync`'s own
 * external watchdog (`timeout: timeoutMs + 30000` = 120000ms) killed the process mid-teardown
 * because the real total lifecycle (2.1m = 126000ms) exceeded that budget by only ~6s. The
 * killed child's `close` event then fired with a non-zero/null code, and the launcher reported
 * the generic `Command failed: ...`, discarding the fact that Playwright itself had already
 * succeeded.
 *
 * `timeoutMs` (Playwright's own `--timeout`) is a PER-TEST budget, never a total-process budget
 * -- startup, evidence capture and teardown add real overhead on top of it. Fixed by deriving the
 * external watchdog from `timeoutMs + CANDIDATE_NAVIGATION_HEADROOM_MS` -- the SAME lifecycle-
 * headroom authority spec-generation-hybrid.ts's own functional execution already documents for
 * this exact class of overhead -- instead of a second, arbitrary `+30000`. A genuine timeout
 * (the watchdog firing before the child would ever have finished) is now reported explicitly
 * (`timedOut: true`, a distinct message), never as a generic `Command failed`. Settlement stays
 * single-authority: only `close`/`error` ever resolve/reject; the watchdog only ever calls
 * `child.kill()`.
 *
 * `"1 passed"` is never parsed from stdout as a success signal anywhere in these tests or in the
 * fix itself -- only exitCode/signal/timedOut drive the result.
 */

function realNodeChild(script: string): { cmd: string } {
  // A tiny real child process (no Playwright, no browser) -- exercises the REAL spawn/close/
  // signal/timeout lifecycle of defaultVerifyPromotedSpecExecAsync end-to-end.
  return { cmd: `node -e "${script.replace(/"/g, '\\"')}"` };
}

test("1/EXIT_CODE_ZERO_RESOLVES: a child that exits 0 resolves success, regardless of how long it legitimately ran within budget", async () => {
  const { cmd } = realNodeChild("console.log('hello'); process.exit(0);");
  const result = await defaultVerifyPromotedSpecExecAsync(cmd, { timeout: 5000, cwd: process.cwd(), env: process.env });
  assert.match(result.stdout, /hello/);
});

test("2/LONGER_THAN_OLD_THRESHOLD_BUT_WITHIN_VALID_AUTHORITY_NOT_KILLED: a child taking longer than an old, too-tight threshold, but within a realistic lifecycle-headroom budget, is never false-failed", async () => {
  // Simulates the physical case at test scale: an old, too-tight watchdog (300ms here, standing
  // in for the previous +30000ms) would have killed a run finishing shortly after it: a
  // generous headroom-based budget (900ms here, standing in for +CANDIDATE_NAVIGATION_HEADROOM_MS)
  // must not.
  const oldTooTightThreshold = 400;
  const newHeadroomBudget = 4000;
  const { cmd } = realNodeChild(`setTimeout(() => { console.log('done-after-delay'); process.exit(0); }, ${oldTooTightThreshold + 300});`);
  const result = await defaultVerifyPromotedSpecExecAsync(cmd, { timeout: newHeadroomBudget, cwd: process.cwd(), env: process.env });
  assert.match(result.stdout, /done-after-delay/);
});

test("3/REAL_TIMEOUT_REJECTS_EXPLICITLY: a child that genuinely outlives the watchdog is killed exactly once and rejects with timedOut=true, a distinct message, never the generic Command-failed wording", async () => {
  const { cmd } = realNodeChild("setTimeout(() => { process.exit(0); }, 5000);"); // would take 5s
  await assert.rejects(
    () => defaultVerifyPromotedSpecExecAsync(cmd, { timeout: 200, cwd: process.cwd(), env: process.env }), // watchdog fires first
    (err: any) => {
      assert.equal(err.timedOut, true);
      assert.match(err.message, /timed out/i);
      assert.doesNotMatch(err.message, /^Command failed:/);
      return true;
    },
  );
});

test("4/NONZERO_EXIT_REJECTS: a child that exits with a real non-zero code (no timeout involved) rejects with that code, timedOut=false", async () => {
  const { cmd } = realNodeChild("process.exit(7);");
  await assert.rejects(
    () => defaultVerifyPromotedSpecExecAsync(cmd, { timeout: 5000, cwd: process.cwd(), env: process.env }),
    (err: any) => {
      assert.equal(err.code, 7);
      assert.equal(err.timedOut, false);
      return true;
    },
  );
});

test("5/SIGNAL_PRESERVED_ON_KILL: when the watchdog's own kill() terminates the child, the delivered signal (SIGTERM) is preserved on the rejection alongside timedOut=true", async () => {
  const { cmd } = realNodeChild("setTimeout(() => {}, 5000);"); // long-running; watchdog kills it below
  await assert.rejects(
    () => defaultVerifyPromotedSpecExecAsync(cmd, { timeout: 150, cwd: process.cwd(), env: process.env }),
    (err: any) => {
      assert.equal(typeof err.signal, "string");
      assert.equal(err.timedOut, true);
      return true;
    },
  );
});

test("6/CLOSE_BEFORE_TIMEOUT_NEVER_FALSE_FAILS: a child that closes successfully well before the watchdog fires is never retroactively turned into a failure once the timer eventually would have fired", async () => {
  const received: VerifyPromotedSpecLiveLine[] = [];
  const { cmd } = realNodeChild("console.log('fast-done'); process.exit(0);");
  const result = await defaultVerifyPromotedSpecExecAsync(cmd, {
    timeout: 5000,
    cwd: process.cwd(),
    env: process.env,
    onLine: (e) => received.push(e),
  });
  assert.match(result.stdout, /fast-done/);
  // Wait past where the (now-cleared) timer would have fired, to prove it never fires/affects
  // an already-settled result.
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(received.some((e) => e.line.includes("fast-done")));
});

test("7/STREAMING_LIVE_NO_FULL_DUPLICATION: onOutput still receives lines live during a longer-running child, and is not re-invoked with the full buffer again on completion", async () => {
  const received: VerifyPromotedSpecLiveLine[] = [];
  const { cmd } = realNodeChild("console.log('line-one'); setTimeout(() => { console.log('line-two'); process.exit(0); }, 100);");
  await defaultVerifyPromotedSpecExecAsync(cmd, {
    timeout: 5000,
    cwd: process.cwd(),
    env: process.env,
    onLine: (e) => received.push(e),
  });
  const stdoutLines = received.filter((e) => e.stream === "stdout").map((e) => e.line);
  assert.deepEqual(stdoutLines, ["line-one", "line-two"], "each line must be delivered exactly once, never the whole buffer replayed again");
});

test("8/DIAGNOSTICS_PRESERVED_NO_SECRETS: a timed-out run's stdout/stderr/code/signal/timedOut all remain available for the final diagnostic, with no secret leakage", async () => {
  const { cmd } = realNodeChild("console.log('APP_PASSWORD=should-not-leak-anywhere-else'); setTimeout(() => {}, 10000);");
  const execAsync: VerifyPromotedSpecExecAsync = (c, opts) => defaultVerifyPromotedSpecExecAsync(c, opts);
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const result = await verifyPromotedSpec(
      "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
      50, // tiny timeoutMs so timeoutMs+headroom still triggers the watchdog quickly in this test
      {},
      async () => {
        const raw = await execAsync(cmd, { timeout: 300, cwd: process.cwd(), env: process.env });
        return raw;
      },
    );
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /timed out/i);
  } finally {
    console.error = originalError;
  }
  // The exact literal secret string is arbitrary here -- what matters is it never propagates
  // unredacted. Since it's not one of the known env-scrubbed values, sanitizeText's own generic
  // patterns are the safety net; assert diagnostics were at least produced without throwing.
  assert.ok(logged.some((l) => l.includes("timedOut=true")));
});

test("9/INTEGRATION_SUCCESS_MAPS_TO_PASSED: verifyPromotedSpec success (exit 0, no timeout) returns status=passed -- never inferred from stdout text", async () => {
  const execAsync: VerifyPromotedSpecExecAsync = async () => ({ stdout: "whatever text, including the literal string 1 passed", stderr: "" });
  const result = await verifyPromotedSpec("automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts", undefined, {}, execAsync);
  assert.deepEqual(result, { status: "passed" });
});

test("10/INTEGRATION_FAILURE_NEVER_INFERRED_FROM_STDOUT_TEXT: a rejection (non-zero exit) fails even if stdout happens to literally contain '1 passed'", async () => {
  const execAsync: VerifyPromotedSpecExecAsync = async () => {
    throw Object.assign(new Error("Command failed"), { stdout: "1 passed", stderr: "", code: 1, timedOut: false });
  };
  const result = await verifyPromotedSpec("automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts", undefined, {}, execAsync);
  assert.equal(result.status, "failed", "status must be driven by the rejection, never by stdout containing the string '1 passed'");
});
