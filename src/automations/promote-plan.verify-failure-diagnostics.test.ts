import assert from "node:assert/strict";
import test from "node:test";
import { verifyPromotedSpec, type VerifyPromotedSpecExecAsync } from "./promote-plan";

/**
 * FIRST_LOSS fix (jobId db4842b6-ed3a-440b-9aa1-49d4f423fbca): `verifyPromotedSpec`'s catch
 * block only ever read `error.message` ("Command failed: npx playwright test ...") from
 * execAsync's rejection -- node:child_process always attaches the real `stdout`/`stderr`/
 * `code`/`signal` to that same error object, but they were never read, so the actual Playwright
 * failure (first failing step, runtime error) was silently discarded before it could reach any
 * log a reuse-existing job's caller could see.
 *
 * This is purely diagnostic -- it does not change what causes the spec to fail, only makes the
 * existing failure observable, with secrets redacted using the SAME CORE `sanitizeText` helper
 * (spec-generation-hybrid.ts) generated spec content already uses, plus a value-based scrub of
 * this run's own known-sensitive env values (APP_USERNAME/APP_PASSWORD/PROMOTED_*) -- never a
 * parallel redaction scheme.
 *
 * `execAsync` is injected directly (verifyPromotedSpec's own DI parameter) rather than
 * monkeypatching node:child_process -- hermetic, and never touches unrelated modules that also
 * import child_process.
 */

type ExecError = Error & { stdout?: string; stderr?: string; code?: number; signal?: string };

function failingExec(err: ExecError): VerifyPromotedSpecExecAsync {
  return async () => {
    throw err;
  };
}

function passingExec(stdout: string, stderr = ""): VerifyPromotedSpecExecAsync {
  return async () => ({ stdout, stderr });
}

test("1/STDOUT_STDERR_REACH_DIAGNOSTIC: an execAsync failure with real Playwright stdout+stderr surfaces both in the returned error and in a console.error diagnostic line", async () => {
  const err: ExecError = Object.assign(
    new Error("Command failed: npx playwright test \"x.spec.ts\" --config=playwright.config.ts --timeout=90000"),
    {
      stdout: "Running 1 test\n1) case.spec.ts:12:5 > Segunta Prueba\n  Error: Promoted click failed at step 6 target=\"role:button\"\n",
      stderr: "1 failed\n",
      code: 1,
    },
  );
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const result = await verifyPromotedSpec(
      "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
      undefined,
      {},
      failingExec(err),
    );
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /Promoted click failed at step 6/, "the real Playwright failure must reach the returned error");
    assert.ok(logged.some((line) => line.includes("Promoted click failed at step 6")), "the real stdout must reach a console.error diagnostic");
    assert.ok(logged.some((line) => /exitCode=1/.test(line)), "exitCode must be logged");
  } finally {
    console.error = originalError;
  }
});

test("2/SECRETS_REDACTED: a known env value (APP_PASSWORD, via appContext) AND a generic Bearer-token literal never appear in the returned error or logged output", async () => {
  const err: ExecError = Object.assign(new Error("Command failed"), {
    // "hunter2-secret-pw" mirrors execEnv.APP_PASSWORD (set below via a spied exec that reports
    // back the env it actually received) -- a bare, unquoted leak sanitizeText's own quoted-
    // literal patterns would NOT catch on their own, which is exactly why the value-based pass
    // exists. The Bearer token IS covered by sanitizeText's own existing pattern.
    stdout: "login failed for hunter2-secret-pw\nAuthorization: Bearer abcDEF1234ghijKLMN\n",
    stderr: "",
    code: 1,
  });
  const originalError = console.error;
  const logged: string[] = [];
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const result = await verifyPromotedSpec(
      "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
      undefined,
      {},
      async (_cmd, options) => {
        (options.env as NodeJS.ProcessEnv).APP_PASSWORD = "hunter2-secret-pw";
        throw err;
      },
    );
    assert.equal(result.status, "failed");
    const allOutput = [result.error ?? "", ...logged].join("\n");
    assert.ok(!allOutput.includes("hunter2-secret-pw"), "the literal APP_PASSWORD value must never appear anywhere");
    assert.ok(!allOutput.includes("abcDEF1234ghijKLMN"), "the literal Bearer token value must never appear anywhere");
    assert.ok(allOutput.includes("[REDACTED]"), "a redaction marker must be present where the secrets were");
  } finally {
    console.error = originalError;
  }
});

test("3/SUCCESS_PATH_UNCHANGED: a passing spec keeps the exact same return contract and success logging as before", async () => {
  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const result = await verifyPromotedSpec(
      "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
      undefined,
      {},
      passingExec("1 passed\n"),
    );
    assert.deepEqual(result, { status: "passed" });
    assert.ok(logged.some((line) => line.includes("Spec verification passed")));
  } finally {
    console.log = originalLog;
  }
});

test("4/NO_STDOUT_STDERR_FALLBACK: a failure with no stdout/stderr on the error object still falls back safely to error.message", async () => {
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = await verifyPromotedSpec(
      "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
      undefined,
      {},
      failingExec(new Error("spawn ENOENT")),
    );
    assert.equal(result.status, "failed");
    assert.match(result.error ?? "", /spawn ENOENT/);
  } finally {
    console.error = originalError;
  }
});

test("5/EXECUTION_ENV_UNCHANGED: the diagnostic redaction pass never mutates process.env, and the injected execAsync still receives the resolved app-scoped env", async () => {
  const before = { ...process.env };
  const err: ExecError = Object.assign(new Error("Command failed"), { stdout: "APP_PASSWORD leaking somehow", code: 1 });
  let receivedEnv: NodeJS.ProcessEnv | undefined;
  const spyExec: VerifyPromotedSpecExecAsync = async (_cmd, options) => {
    receivedEnv = options.env;
    throw err;
  };
  const originalError = console.error;
  console.error = () => {};
  try {
    await verifyPromotedSpec(
      "automations/apps/portal-comercial/sections/default-section/cases/x/case.spec.ts",
      undefined,
      { appContext: { appSlug: "portal-comercial" } },
      spyExec,
    );
  } finally {
    console.error = originalError;
  }
  assert.deepEqual({ ...process.env }, before, "process.env must be bit-for-bit unchanged after a failed verify+diagnostic pass");
  assert.ok(receivedEnv, "the child must still receive an explicit, app-scoped env (the execution-context fix from the prior ticket)");
  assert.equal(receivedEnv!.APP_SLUG, "portal-comercial");
});
