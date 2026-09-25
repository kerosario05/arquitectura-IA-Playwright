import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveVerifyPromotedSpecAppExecEnv, type ResolveVerifyPromotedSpecAppExecEnvDeps } from "./promote-plan";

/**
 * FIRST_LOSS fix (jobId dd76f6cc-76fd-4370-9a7d-c7eee2557bad): the compiled promoted spec reads
 * its runtime data as `process.env['PROMOTED_<KEY>']` (deterministic-spec-compiler.ts's own
 * emission shape / materializePromotedRuntimeEnv's naming convention). Neither of the two
 * mechanisms `resolveVerifyPromotedSpecAppExecEnv` already had could ever populate this:
 *   - `resolvePromotedRuntimeInputKeys` only recognizes the fixed 3-entry auth.* map
 *     (PROMOTED_RUNTIME_INPUT_ENV: username/password/company_identifier) and
 *     `requirePromotedData(dataContext, "...")` call sites -- the real spec uses neither.
 *   - `preparePromotedRuntimeInputs` only ever WRITES those same 3 fixed env names, even if a
 *     key were somehow detected as required.
 * So for a spec like `process.env['PROMOTED_USUARIO']`, nothing ever set it -- it silently
 * evaluated to `''`, the exact physical symptom (valueNonEmpty=false, login never progresses).
 *
 * Fixed by resolving this app's own key->value runtime data (username/password/testData, with
 * testDataAliases expanded) via `buildDataContext` + `buildRuntimeInputValues` -- the SAME
 * authority spec-generation-hybrid.ts's functional execution already uses
 * (launchContext.runtimeInputValues) -- and materializing it with the SAME
 * `materializePromotedRuntimeEnv` convention the compiler/runtime already share. A generic scan
 * for `process.env['PROMOTED_<KEY>']` in the spec source then fails closed if any such key is
 * still empty after materialization, instead of silently proceeding.
 *
 * `deps` are injected (this module's own established DI pattern) so this is exercised with
 * synthetic, non-business keys, without touching a real app.config/database.
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
    resolvePromotedScenarioRuntimeValues: () => ({}),
    readSpecSource: async () => "",
    ...overrides,
  };
}

function specSourceReading(keys: string[]): ResolveVerifyPromotedSpecAppExecEnvDeps["readSpecSource"] {
  const body = keys.map((k) => `String(process.env['PROMOTED_${k.toUpperCase()}'] ?? '')`).join("\n");
  return async () => body;
}

test("1/THREE_ARBITRARY_KEYS_TRANSPORTED: a scenario with 3 synthetic runtime keys all reach the child env with their correct values", async () => {
  const deps = stubDeps({
    readSpecSource: specSourceReading(["field_a", "field_b", "field_c"]),
    resolvePromotedScenarioRuntimeValues: (appSlug) => {
      assert.equal(appSlug, "synthetic-app");
      return { field_a: "value-a", field_b: "value-b", field_c: "value-c" };
    },
  });
  const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
    {},
    { appSlug: "synthetic-app" },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(execEnv.PROMOTED_FIELD_A, "value-a");
  assert.equal(execEnv.PROMOTED_FIELD_B, "value-b");
  assert.equal(execEnv.PROMOTED_FIELD_C, "value-c");
});

test("2/AUTHORITY_VALUE_TRANSPORTS_EVEN_WHEN_ABSENT_FROM_PARENT_ENV: a required key present only in the runtime-values authority (never in parent process.env) still reaches the child", async () => {
  const parentEnv: NodeJS.ProcessEnv = { SOME_UNRELATED_VAR: "x" }; // PROMOTED_FIELD_A absent here
  const deps = stubDeps({
    readSpecSource: specSourceReading(["field_a"]),
    resolvePromotedScenarioRuntimeValues: () => ({ field_a: "authoritative-value" }),
  });
  const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
    parentEnv,
    { appSlug: "synthetic-app" },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(execEnv.PROMOTED_FIELD_A, "authoritative-value");
});

test("3/AUTHORITY_WINS_OVER_STALE_PARENT_VALUE: a conflicting/stale value already in the parent env is overridden by the scenario runtime-values authority", async () => {
  const parentEnv: NodeJS.ProcessEnv = { PROMOTED_FIELD_A: "stale-leftover-value" };
  const deps = stubDeps({
    readSpecSource: specSourceReading(["field_a"]),
    resolvePromotedScenarioRuntimeValues: () => ({ field_a: "fresh-authoritative-value" }),
  });
  const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
    parentEnv,
    { appSlug: "synthetic-app" },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(execEnv.PROMOTED_FIELD_A, "fresh-authoritative-value");
  assert.notEqual(execEnv.PROMOTED_FIELD_A, "stale-leftover-value");
});

test("4/MISSING_REQUIRED_KEY_FAILS_CLOSED: a key the compiled spec requires but the authority genuinely has no value for throws with an explicit, key-named diagnostic -- never proceeds with an empty value", async () => {
  const deps = stubDeps({
    readSpecSource: specSourceReading(["field_a", "field_missing"]),
    resolvePromotedScenarioRuntimeValues: () => ({ field_a: "value-a" }), // field_missing genuinely absent
  });
  await assert.rejects(
    () => resolveVerifyPromotedSpecAppExecEnv(
      {},
      { appSlug: "synthetic-app" },
      "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
      deps,
    ),
    (err: Error) => {
      assert.match(err.message, /PROMOTED_FIELD_MISSING/);
      assert.doesNotMatch(err.message, /value-a/, "the diagnostic must name the missing key, never leak a present value");
      return true;
    },
  );
});

test("5/GENERICITY_SYNTHETIC_KEYS: this whole ticket's fix operates on synthetic keys (field_a/field_b/...) only -- no fixture-specific business key name appears in the fix's own source", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "promote-plan.ts"), "utf8");
  const start = source.indexOf("function defaultResolvePromotedScenarioRuntimeValues");
  const end = source.indexOf("\nexport async function resolveVerifyPromotedSpecAppExecEnv");
  const fixBlock = source.slice(start, end === -1 ? start + 4000 : end);
  assert.doesNotMatch(fixBlock, /usuario|contrasena|numero_de_identificacion|Depurar/i, "the fix must resolve keys generically, never hardcode this fixture's business key names");
});

test("6/APP_CONTEXT_UNCHANGED: APP_SLUG/APP_PROFILE/APP_BASE_URL behavior from the prior ticket is untouched by this fix", async () => {
  const deps = stubDeps({
    resolvePromotedExecutionEnv: async (baseEnv, appSlug) => ({ ...baseEnv, APP_BASE_URL: `https://${appSlug}.invalid` }),
  });
  const execEnv = await resolveVerifyPromotedSpecAppExecEnv(
    { APP_SLUG: "some-other-app", APP_BASE_URL: "https://other.invalid" },
    { appSlug: "synthetic-app" },
    "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
    deps,
  );
  assert.equal(execEnv.APP_SLUG, "synthetic-app");
  assert.equal(execEnv.APP_PROFILE, "synthetic-app");
  assert.equal(execEnv.APP_BASE_URL, "https://synthetic-app.invalid");
});

test("7/NO_SECRET_EXPOSURE: resolving runtime values never logs the actual values", async () => {
  const originalLog = console.log;
  const originalError = console.error;
  const logged: string[] = [];
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    const deps = stubDeps({
      readSpecSource: specSourceReading(["field_secret"]),
      resolvePromotedScenarioRuntimeValues: () => ({ field_secret: "ultra-sensitive-value-9000" }),
    });
    await resolveVerifyPromotedSpecAppExecEnv(
      {},
      { appSlug: "synthetic-app" },
      "automations/apps/synthetic-app/sections/s/cases/c/case.spec.ts",
      deps,
    );
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
  assert.ok(!logged.some((line) => line.includes("ultra-sensitive-value-9000")), "the resolved value must never appear in any console output");
});

test("8/SINGLE_AUTHORITY_NOT_DIVERGENT: the fix's materialization reuses the SAME materializePromotedRuntimeEnv the deterministic compiler / functional execution already use -- not a second, parallel implementation", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "promote-plan.ts"), "utf8");
  assert.match(source, /import \{ materializePromotedRuntimeEnv \} from "\.\/runtime\/promoted-spec-runtime";/);
  const start = source.indexOf("export async function resolveVerifyPromotedSpecAppExecEnv");
  const fn = source.slice(start, start + 3000);
  assert.match(fn, /materializePromotedRuntimeEnv\(effectiveRuntimeValues\)/, "must call the shared CORE materializer, not reimplement PROMOTED_<KEY> naming locally");
  assert.doesNotMatch(fn, /\.toUpperCase\(\)\s*\}\s*\]\s*=/, "must not hand-roll a second PROMOTED_<KEY> assignment scheme");
});
