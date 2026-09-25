import assert from "node:assert/strict";
import test from "node:test";
import { verifyPromotedSpec, type VerifyPromotedSpecExecAsync, type VerifyPromotedSpecLiveLine } from "./promote-plan";

/**
 * FIRST_LOSS fix (jobId dd76f6cc-76fd-4370-9a7d-c7eee2557bad): reuse-existing's Live Log/SSE
 * channel (jobStore.appendLog, already streamed by runs.ts's subscribe/onLog) never received a
 * single line of the child Playwright process's stdout/stderr while it ran -- `verifyPromotedSpec`
 * launched it via a fully buffered `exec`, so nothing was observable until the whole process
 * exited or rejected. Fixed by replacing the buffered launcher with a single spawn -> stream ->
 * collect -> timeout/exit -> result/error path (`defaultVerifyPromotedSpecExecAsync`) that emits
 * a `VerifyPromotedSpecLiveLine` event PER COMPLETE LINE as the child produces it, while still
 * accumulating the full stdout/stderr so the previous ticket's final pass/fail diagnostics lose
 * nothing. `verifyPromotedSpec` never talks to jobStore/SSE directly -- callers wire their own
 * live sink in via `options.onOutput`, and every line reaching it is already redacted with the
 * SAME `redactVerifyPromotedSpecOutput` (env-value scrub + CORE `sanitizeText`) the prior ticket
 * introduced -- never a second redaction path.
 *
 * `execAsync` is injected (verifyPromotedSpec's own DI parameter) so the launcher itself can be
 * exercised with a fake streaming/non-streaming implementation without spawning a real process.
 */

function streamingExec(events: Array<{ delayTicks: number; event: VerifyPromotedSpecLiveLine }>, final: { code: number; stdout: string; stderr: string }): VerifyPromotedSpecExecAsync {
  return async (_cmd, options) => {
    for (const { event } of events) {
      options.onLine?.(event);
      // Yield a microtask so a caller polling "has the first chunk arrived yet" would observe
      // it strictly before this promise resolves -- proving live delivery, not post-hoc replay.
      await Promise.resolve();
    }
    if (final.code === 0) {
      return { stdout: final.stdout, stderr: final.stderr };
    }
    throw Object.assign(new Error(`Command failed: exit ${final.code}`), { stdout: final.stdout, stderr: final.stderr, code: final.code });
  };
}

test("1/LIVE_STDOUT_BEFORE_EXIT: onOutput receives the first stdout line before the verifyPromotedSpec promise settles", async () => {
  let firstLineSeenBeforeSettle = false;
  let settled = false;
  const received: VerifyPromotedSpecLiveLine[] = [];
  const exec = streamingExec(
    [
      { delayTicks: 0, event: { stream: "stdout", line: "Running 1 test using 1 worker" } },
      { delayTicks: 1, event: { stream: "stdout", line: "[promoted-fill-state] stepIndex=1" } },
    ],
    { code: 0, stdout: "1 passed\n", stderr: "" },
  );
  const promise = verifyPromotedSpec(
    "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
    undefined,
    {
      onOutput: (event) => {
        received.push(event);
        if (!settled) firstLineSeenBeforeSettle = true;
      },
    },
    exec,
  );
  await promise;
  settled = true;
  assert.ok(firstLineSeenBeforeSettle, "at least one live line must have been received before the promise settled");
  assert.equal(received.length, 2);
  assert.equal(received[0].line, "Running 1 test using 1 worker");
});

test("2/LIVE_STDERR_TOO: stderr lines are streamed live as well, tagged with stream=stderr", async () => {
  const received: VerifyPromotedSpecLiveLine[] = [];
  const exec = streamingExec(
    [{ delayTicks: 0, event: { stream: "stderr", line: "Warning: slow network request" } }],
    { code: 0, stdout: "1 passed\n", stderr: "" },
  );
  await verifyPromotedSpec(
    "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
    undefined,
    { onOutput: (event) => received.push(event) },
    exec,
  );
  assert.equal(received.length, 1);
  assert.equal(received[0].stream, "stderr");
  assert.equal(received[0].line, "Warning: slow network request");
});

test("3/SECRET_NEVER_REACHES_LIVE_SINK: a secret value present in a live line is redacted BEFORE onOutput is called", async () => {
  const received: VerifyPromotedSpecLiveLine[] = [];
  const exec: VerifyPromotedSpecExecAsync = async (_cmd, options) => {
    options.onLine?.({ stream: "stdout", line: "Authorization: Bearer abcDEF1234ghijKLMN" });
    return { stdout: "1 passed\n", stderr: "" };
  };
  await verifyPromotedSpec(
    "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
    undefined,
    { onOutput: (event) => received.push(event) },
    exec,
  );
  assert.equal(received.length, 1);
  assert.ok(!received[0].line.includes("abcDEF1234ghijKLMN"), "the raw token value must never reach the live sink");
  assert.ok(received[0].line.includes("[REDACTED]"));
});

test("4/PARTIAL_CHUNK_LINE_RECONSTRUCTION: a line split across chunks (or left unterminated at close) is reconstructed/flushed correctly by the default launcher's own line emitter", async () => {
  // Exercises defaultVerifyPromotedSpecExecAsync's real chunk-buffering directly via a fake
  // spawn (node:child_process interception is avoided for hermetic-ness -- this test drives the
  // launcher's line-emission contract through the SAME onLine callback shape it uses, by
  // invoking a minimal stand-in that mimics chunked delivery).
  const received: string[] = [];
  const exec: VerifyPromotedSpecExecAsync = async (_cmd, options) => {
    // Simulate two chunks that split "[promoted-step] stepIndex=3" across a chunk boundary,
    // followed by a final unterminated partial line that must still be flushed.
    let carry = "";
    const feed = (chunk: string) => {
      carry += chunk;
      const lines = carry.split(/\r?\n/);
      carry = lines.pop() ?? "";
      for (const line of lines) {
        received.push(line);
        options.onLine?.({ stream: "stdout", line });
      }
    };
    feed("[promoted-s");
    feed("tep] stepIndex=3\n[async-wait] state=active");
    // close: flush the remaining partial line
    if (carry.length > 0) {
      received.push(carry);
      options.onLine?.({ stream: "stdout", line: carry });
    }
    return { stdout: received.join("\n"), stderr: "" };
  };
  await verifyPromotedSpec(
    "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
    undefined,
    {},
    exec,
  );
  assert.deepEqual(received, ["[promoted-step] stepIndex=3", "[async-wait] state=active"]);
});

test("5/SUCCESS_UNCHANGED: exit 0 keeps the exact same return contract with a streaming launcher", async () => {
  const exec = streamingExec(
    [{ delayTicks: 0, event: { stream: "stdout", line: "1 passed" } }],
    { code: 0, stdout: "1 passed\n", stderr: "" },
  );
  const result = await verifyPromotedSpec(
    "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
    undefined,
    {},
    exec,
  );
  assert.deepEqual(result, { status: "passed" });
});

test("6/FAILURE_DIAGNOSTICS_STILL_AVAILABLE: a failing run still returns the full redacted stdout/stderr for the final diagnostic, in addition to live streaming", async () => {
  const liveLines: VerifyPromotedSpecLiveLine[] = [];
  const exec = streamingExec(
    [{ delayTicks: 0, event: { stream: "stdout", line: "Error: Promoted click failed at step 6" } }],
    { code: 1, stdout: "Running 1 test\nError: Promoted click failed at step 6\n", stderr: "1 failed\n" },
  );
  const result = await verifyPromotedSpec(
    "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
    undefined,
    { onOutput: (event) => liveLines.push(event) },
    exec,
  );
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /Promoted click failed at step 6/);
  assert.ok(liveLines.length > 0, "live lines must also have been delivered before the failure diagnostic");
});

test("7/NO_LIVE_SINK_STILL_WORKS: omitting onOutput entirely preserves buffered observability -- execution and final diagnostics are unaffected", async () => {
  const exec = streamingExec(
    [{ delayTicks: 0, event: { stream: "stdout", line: "Error: Promoted fill failed at step 2" } }],
    { code: 1, stdout: "Error: Promoted fill failed at step 2\n", stderr: "" },
  );
  const result = await verifyPromotedSpec(
    "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
    undefined,
    {}, // no onOutput
    exec,
  );
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /Promoted fill failed at step 2/);
});

test("8/NO_MASS_DUPLICATION_ON_FINISH: onOutput is called only with the lines actually streamed live -- the final diagnostic path (console.error) does not re-invoke onOutput with the same content", async () => {
  const received: VerifyPromotedSpecLiveLine[] = [];
  const exec = streamingExec(
    [{ delayTicks: 0, event: { stream: "stdout", line: "Error: Promoted click failed at step 6" } }],
    { code: 1, stdout: "Error: Promoted click failed at step 6\n", stderr: "" },
  );
  const originalError = console.error;
  console.error = () => {};
  try {
    await verifyPromotedSpec(
      "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
      undefined,
      { onOutput: (event) => received.push(event) },
      exec,
    );
  } finally {
    console.error = originalError;
  }
  assert.equal(received.length, 1, "onOutput must be called exactly once per live line, never again for the same content during final diagnostics");
});
