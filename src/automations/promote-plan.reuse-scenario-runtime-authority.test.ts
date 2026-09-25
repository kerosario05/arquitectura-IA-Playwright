import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveVerifyPromotedSpecAppExecEnv, type ResolveVerifyPromotedSpecAppExecEnvDeps } from "./promote-plan";

/**
 * FIRST_LOSS fix (jobId 5c9de4b4-8d00-4066-af14-b6cc159b5ba5): the previous ticket's fix
 * correctly detected which PROMOTED_<KEY> values a compiled spec requires, but reconstructed
 * them from this app's GLOBAL/default testData (`loadPromotedAppConfigSync`) -- never the
 * SELECTED scenario's own current "Datos de este escenario" edits.
 *
 * Persistence trace (read-only, no code touched there):
 *   PUT /api/recordings/:recordingId/scenario-value (src/server/routes/recordings.ts) ->
 *   applyRuntimeDatasetValues(...) -> saveScenarios(...) writes onto
 *   RecordedScenario.runtimeDataset.resolvedValues (Record<string,string>,
 *   canonical-recording-contract.ts). Full (non-reuse) execution already consumes this SAME
 *   class of authority via promoteExecutionPlan's own `runtimeEntries` param (explicitly
 *   documented there as "CURRENT_QA_EDIT-sourced overrides", taking precedence over static/
 *   app-global data when building runtimeInputValues).
 *
 * For reuse-existing, `rerun-runner.ts`'s `resolvePromotedSpecReuse` already loads the matching
 * `RecordedScenario` (canonical scenarioId lineage) but never carried its `runtimeDataset.
 * resolvedValues` through `PromotedSpecReuseEntry` -> `ReuseExistingPromotedSpecScenario` ->
 * `verifyPromotedSpec`'s `appContext` -- THIS is where the authority was lost. Fixed by
 * threading `runtimeValues` through that exact chain and giving it precedence over the app's
 * global data in `resolveVerifyPromotedSpecAppExecEnv`, materialized through the SAME
 * `materializePromotedRuntimeEnv` as before (no second protocol).
 */

function stubDeps(overrides: Partial<ResolveVerifyPromotedSpecAppExecEnvDeps> = {}): ResolveVerifyPromotedSpecAppExecEnvDeps {
  return {
    resolvePromotedExecutionEnv: async (baseEnv) => ({ ...baseEnv, APP_BASE_URL: "https://synthetic.invalid" }),
    resolvePromotedRuntimeInputKeys: () => [],
    preparePromotedRuntimeInputs: async ({ baseEnv, requiredKeys }) => ({
      ok: true,
      env: { ...baseEnv },
      resolvedKeys: requiredKeys,
      resolvedSources: {},
    }),
    resolvePromotedScenarioRuntimeValues: () => ({}), // app-global fallback, empty unless overridden per test
    readSpecSource: async () => "",
    ...overrides,
  };
}

function specSourceReading(keys: string[]): ResolveVerifyPromotedSpecAppExecEnvDeps["readSpecSource"] {
  const body = keys.map((k) => `String(process.env['PROMOTED_${k.toUpperCase()}'] ?? '')`).join("\n");
  return async () => body;
}

test("1/SCENARIO_VALUES_REACH_CHILD_ENV: a selected scenario's own field_a/field_b/field_c reach the child env under PROMOTED_FIELD_A/B/C", async () => {
  const deps = stubDeps({ readSpecSource: specSourceReading(["field_a", "field_b", "field_c"]) });
  const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
    {},
    { appSlug: "synthetic-app", scenarioRuntimeValues: { field_a: "A", field_b: "B", field_c: "C" } },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(execEnv.PROMOTED_FIELD_A, "A");
  assert.equal(execEnv.PROMOTED_FIELD_B, "B");
  assert.equal(execEnv.PROMOTED_FIELD_C, "C");
});

test("2/SCENARIO_WINS_OVER_APP_GLOBAL_DEFAULT: the scenario's own value overrides this app's global/default testData for the same key", async () => {
  const deps = stubDeps({
    readSpecSource: specSourceReading(["field_a"]),
    resolvePromotedScenarioRuntimeValues: () => ({ field_a: "app-global-default" }),
  });
  const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
    {},
    { appSlug: "synthetic-app", scenarioRuntimeValues: { field_a: "scenario-current-edit" } },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(execEnv.PROMOTED_FIELD_A, "scenario-current-edit");
});

test("3/UPDATED_SCENARIO_VALUE_USED_NEXT_RUN: a later call with a NEW scenario value (simulating an edit between reuse runs) reflects the new value, never a stale snapshot", async () => {
  const deps = stubDeps({ readSpecSource: specSourceReading(["field_a"]) });
  const firstRun = await resolveVerifyPromotedSpecAppExecEnv(
    {},
    { appSlug: "synthetic-app", scenarioRuntimeValues: { field_a: "old-value" } },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(firstRun.PROMOTED_FIELD_A, "old-value");

  const secondRun = await resolveVerifyPromotedSpecAppExecEnv(
    {}, // a fresh base env, as a new reuse job would build
    { appSlug: "synthetic-app", scenarioRuntimeValues: { field_a: "new-edited-value" } },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(secondRun.PROMOTED_FIELD_A, "new-edited-value");
});

test("4/PER_SCENARIO_ISOLATION: two scenarios sharing the same key but different values each receive only their own scenario's value", async () => {
  const deps = stubDeps({ readSpecSource: specSourceReading(["field_a"]) });
  const scenarioOneEnv = await resolveVerifyPromotedSpecAppExecEnv(
    {},
    { appSlug: "synthetic-app", caseId: 1, scenarioRuntimeValues: { field_a: "scenario-one-value" } },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  const scenarioTwoEnv = await resolveVerifyPromotedSpecAppExecEnv(
    {},
    { appSlug: "synthetic-app", caseId: 2, scenarioRuntimeValues: { field_a: "scenario-two-value" } },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(scenarioOneEnv.PROMOTED_FIELD_A, "scenario-one-value");
  assert.equal(scenarioTwoEnv.PROMOTED_FIELD_A, "scenario-two-value");
});

test("5/MISSING_KEY_NO_FALLBACK_STILL_FAILS_CLOSED: a required key absent from both the scenario AND the app-global fallback still throws PROMOTED_FIELD_MISSING", async () => {
  const deps = stubDeps({
    readSpecSource: specSourceReading(["field_a", "field_missing"]),
    resolvePromotedScenarioRuntimeValues: () => ({}), // no app-global fallback for anything
  });
  await assert.rejects(
    () => resolveVerifyPromotedSpecAppExecEnv(
      {},
      { appSlug: "synthetic-app", scenarioRuntimeValues: { field_a: "A" } }, // field_missing genuinely absent
      "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
      deps,
    ),
    (err: Error) => {
      assert.match(err.message, /PROMOTED_FIELD_MISSING/);
      assert.doesNotMatch(err.message, /\bA\b(?!PP)/, "must never leak a present value in the diagnostic");
      return true;
    },
  );
});

test("6/SECURITY_NO_VALUE_LOGGING: resolving scenario runtime values never logs the actual values", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const deps = stubDeps({ readSpecSource: specSourceReading(["field_secret"]) });
    await resolveVerifyPromotedSpecAppExecEnv(
      {},
      { appSlug: "synthetic-app", scenarioRuntimeValues: { field_secret: "extremely-sensitive-9000" } },
      "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
      deps,
    );
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.ok(!logged.some((line) => line.includes("extremely-sensitive-9000")));
});

test("7/GENERICITY: this test file and the fix's own source use only synthetic keys (field_a/field_b/...), never this fixture's business key names", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "promote-plan.ts"), "utf8");
  const start = source.indexOf("export async function resolveVerifyPromotedSpecAppExecEnv");
  const fn = source.slice(start, start + 4000);
  assert.doesNotMatch(fn, /usuario|contrasena|numero_de_identificacion/i);
});

test("8/APP_CONTEXT_AND_STREAMING_UNCHANGED: APP_SLUG/APP_PROFILE/APP_BASE_URL resolution and the onOutput-based streaming wiring in scenario-preview-runner.ts are untouched by this fix", () => {
  const promotePlanSource = fs.readFileSync(path.resolve(__dirname, "promote-plan.ts"), "utf8");
  assert.match(promotePlanSource, /APP_SLUG: appSlug, APP_PROFILE: appSlug/);
  const runnerSource = fs.readFileSync(path.resolve(__dirname, "../server/jobs/scenario-preview-runner.ts"), "utf8");
  assert.match(runnerSource, /onOutput: \(event\) => \{/, "the live-streaming wiring from the prior ticket must remain intact");
  assert.match(runnerSource, /scenarioRuntimeValues: scenario\.runtimeValues,/, "the new scenario authority must be wired alongside it, not replacing it");
});
