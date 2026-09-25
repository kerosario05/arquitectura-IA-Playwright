import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveVerifyPromotedSpecAppExecEnv, type ResolveVerifyPromotedSpecAppExecEnvDeps } from "./promote-plan";

/**
 * FIRST_LOSS fix (job 066ec4e0-5350-4970-81d7-179944eee085): `verifyPromotedSpec`'s spawned
 * Playwright process (used by reuse-existing, scenario-preview-runner.ts's
 * `startReuseExistingPromotedSpecRun`) only ever received `EVIDENCE_APP_SLUG` -- pathing
 * metadata, never APP_SLUG/APP_PROFILE/APP_BASE_URL. The child therefore inherited whatever app
 * the parent server process happened to already be configured for (Kiosko, physically confirmed
 * in the reuse job's own DOCX evidence) instead of the reused scenario's own app (Portal
 * Comercial).
 *
 * `resolveVerifyPromotedSpecAppExecEnv` closes this by reusing the SAME resolvers
 * `npm run test:promoted` (src/cli/test-promoted.ts) already uses for functional execution
 * (`resolvePromotedExecutionEnv` for APP_BASE_URL, `preparePromotedRuntimeInputs` for PROMOTED_*
 * runtime inputs) -- never a second, independent app-config resolution. `deps` are injected here
 * so these are exercised without touching real app.config files, a database, or a process spawn.
 */

function stubDeps(overrides: Partial<ResolveVerifyPromotedSpecAppExecEnvDeps> = {}): ResolveVerifyPromotedSpecAppExecEnvDeps {
  return {
    resolvePromotedExecutionEnv: async (baseEnv, appSlug) => ({
      ...baseEnv,
      APP_BASE_URL: appSlug === "portal-comercial" ? "https://portal.invalid" : baseEnv.APP_BASE_URL,
    }),
    resolvePromotedRuntimeInputKeys: () => [],
    preparePromotedRuntimeInputs: async ({ baseEnv, requiredKeys }) => ({
      ok: true,
      env: { ...baseEnv },
      resolvedKeys: requiredKeys,
      resolvedSources: {},
    }),
    resolvePromotedScenarioRuntimeValues: () => ({}),
    readSpecSource: async () => "",
    ...overrides,
  };
}

test("1/REQUESTED_APP_CONTEXT_OVERRIDES_PARENT_ENV: a conflicting parent env (Kiosko) is fully overridden by the requested scenario's own app context (Portal Comercial)", async () => {
  const parentEnv: NodeJS.ProcessEnv = {
    APP_SLUG: "kiosko",
    APP_PROFILE: "kiosko",
    APP_BASE_URL: "https://kiosko.invalid",
  };
  const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
    parentEnv,
    { appSlug: "portal-comercial" },
    "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
    stubDeps(),
  );
  assert.equal(execEnv.APP_SLUG, "portal-comercial");
  assert.equal(execEnv.APP_PROFILE, "portal-comercial");
  assert.equal(execEnv.APP_BASE_URL, "https://portal.invalid");
  assert.notEqual(execEnv.APP_SLUG, "kiosko");
  assert.notEqual(execEnv.APP_BASE_URL, "https://kiosko.invalid");
});

test("2/EVIDENCE_METADATA_SEPARATE_FROM_EXECUTION_CONTEXT: EVIDENCE_APP_SLUG (pathing) and APP_SLUG (execution) are set independently and never substitute for each other", async () => {
  // Simulates buildVerifyPromotedSpecExecEnv's own evidenceContext overlay (unchanged, sync,
  // tested separately in promote-plan.evidence-context.test.ts) composed with this ticket's fix.
  const baseEnvWithEvidence: NodeJS.ProcessEnv = {
    APP_SLUG: "kiosko",
    EVIDENCE_APP_SLUG: "portal-comercial",
    EVIDENCE_RUN_ID: "reuse-job-123",
  };
  const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
    baseEnvWithEvidence,
    { appSlug: "portal-comercial" },
    "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
    stubDeps(),
  );
  // Execution context corrected...
  assert.equal(execEnv.APP_SLUG, "portal-comercial");
  assert.equal(execEnv.APP_BASE_URL, "https://portal.invalid");
  // ...while evidence-pathing metadata is untouched by this function (it is not its concern).
  assert.equal(execEnv.EVIDENCE_APP_SLUG, "portal-comercial");
  assert.equal(execEnv.EVIDENCE_RUN_ID, "reuse-job-123");
});

test("3/RUNTIME_INPUTS_FORWARDED_NO_SECRET_LOGGED: required PROMOTED_* runtime inputs reach the child env, and no console.log call from this function contains the actual secret value", async () => {
  const deps = stubDeps({
    resolvePromotedRuntimeInputKeys: () => ["auth.username", "auth.password"],
    preparePromotedRuntimeInputs: async ({ baseEnv, requiredKeys }) => ({
      ok: true,
      env: { ...baseEnv, APP_USERNAME: "qa_user_42", APP_PASSWORD: "s3cr3t-value" },
      resolvedKeys: requiredKeys,
      resolvedSources: { "auth.username": "runtime_context", "auth.password": "runtime_context" },
    }),
  });
  const originalLog = console.log;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
      { APP_SLUG: "kiosko" },
      { appSlug: "portal-comercial", caseId: 12345 },
      "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
      deps,
    );
    assert.equal(execEnv.APP_USERNAME, "qa_user_42");
    assert.equal(execEnv.APP_PASSWORD, "s3cr3t-value");
  } finally {
    console.log = originalLog;
  }
  assert.ok(!logged.some((line) => line.includes("s3cr3t-value")), "the secret value must never appear in a console.log call from this function");
});

test("4/FAIL_CLOSED_NO_APP_CONTEXT: an appContext with an empty/blank appSlug throws instead of silently falling back to another project", async () => {
  await assert.rejects(
    () => resolveVerifyPromotedSpecAppExecEnv(
      { APP_SLUG: "kiosko" },
      { appSlug: "" },
      "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
      stubDeps(),
    ),
    /appContext\.appSlug is required/,
  );
  await assert.rejects(
    () => resolveVerifyPromotedSpecAppExecEnv(
      { APP_SLUG: "kiosko" },
      { appSlug: "   " },
      "automations/apps/portal-comercial/sections/default-section/cases/preview-001-segunta-prueba/case.spec.ts",
      stubDeps(),
    ),
    /appContext\.appSlug is required/,
  );
});

test("5/REUSE_EXISTING_NEVER_INVOKES_DISCOVERY_OR_GENERATION: startReuseExistingPromotedSpecRun's own source is unchanged in this regard -- still only calls verify(...), no discovery/spec-generation/AI symbol referenced", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../server/jobs/scenario-preview-runner.ts"), "utf8");
  const start = source.indexOf("export async function startReuseExistingPromotedSpecRun(");
  const end = source.indexOf("\nfunction ", start);
  const fn = source.slice(start, end === -1 ? start + 6000 : end);
  assert.doesNotMatch(fn, /runDiscoverAndPromote|generateSpecFromPlan|createAIExplorer|runAgentAutoRepair/, "reuse-existing must never invoke discovery/generation/AI");
  assert.match(fn, /await verify\(scenario\.specPath/, "reuse-existing must still only run the already-promoted spec");
  assert.match(fn, /appContext:\s*\{\s*\n\s*appSlug,\s*\n\s*caseId: scenario\.caseId,/, "the fix must pass the scenario's own appSlug/caseId as appContext");
});
