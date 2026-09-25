import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { materializePromotedRuntimeEnv, runtimeEnvNameForValueKey } from "./runtime/promoted-spec-runtime";
import { buildPlaywrightCommandEnv } from "./spec-generation-hybrid";
import { compileDeterministicSpec } from "./spec-compiler/deterministic-spec-compiler";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import type { ExecutionPlan } from "../types/execution-plan.types";

/**
 * Proves the wiring closed by this ticket: already-resolved runtime authority
 * (valueKey -> value) reaches the functionalExecution child's env via the SAME
 * PROMOTED_<KEY> / PROMOTED_RUNTIME_DATA_OVERRIDES_JSON convention the deterministic
 * compiler's generated `process.env['PROMOTED_<KEY>']` reads and resolvePromotedRuntimeValue's
 * fallback already share -- one authority, no second protocol, no re-resolution.
 *
 * Static/integration wiring only. Does NOT and cannot claim the physical fill is fixed -- that
 * requires a real QA Lab replay.
 */

const SYNTHETIC_VALUES = { alpha_key: "TEST_SECRET_ALPHA", beta_key: "TEST_SECRET_BETA" };

test("1/env materialization: required PROMOTED_<KEY> entries generated, normalization matches runtimeEnvNameForValueKey, no business keys hardcoded", () => {
  const patch = materializePromotedRuntimeEnv(SYNTHETIC_VALUES);
  assert.equal(patch[runtimeEnvNameForValueKey("alpha_key")], "TEST_SECRET_ALPHA");
  assert.equal(patch[runtimeEnvNameForValueKey("beta_key")], "TEST_SECRET_BETA");
  assert.equal(patch.PROMOTED_ALPHA_KEY, "TEST_SECRET_ALPHA");
  assert.equal(patch.PROMOTED_BETA_KEY, "TEST_SECRET_BETA");
  assert.ok(typeof patch.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON === "string", "JSON overrides fallback must also be materialized, matching resolvePromotedRuntimeValue's existing dual precedence");
  const overrides = JSON.parse(patch.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON!);
  assert.deepEqual(overrides, SYNTHETIC_VALUES);
});

test("1b/env materialization: empty/whitespace values are never materialized (no invented authority)", () => {
  const patch = materializePromotedRuntimeEnv({ empty_key: "", whitespace_key: "   " });
  assert.equal(patch.PROMOTED_EMPTY_KEY, undefined);
  assert.equal(patch.PROMOTED_WHITESPACE_KEY, undefined);
  assert.equal(patch.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON, undefined);
});

test("2/functionalExecution env propagation: buildPlaywrightCommandEnv carries runtimeInputValues as PROMOTED_<KEY>, preserves APP_SLUG/APP_BASE_URL/HEADLESS", () => {
  const env = buildPlaywrightCommandEnv({
    source: "test",
    headless: true,
    appBaseUrl: "https://example.test",
    appSlug: "synthetic-app",
    runtimeInputValues: SYNTHETIC_VALUES,
  });
  assert.ok(env, "env patch must be produced");
  assert.equal(env!.HEADLESS, "true");
  assert.equal(env!.APP_BASE_URL, "https://example.test");
  assert.equal(env!.APP_SLUG, "synthetic-app");
  assert.equal(env!.PROMOTED_ALPHA_KEY, "TEST_SECRET_ALPHA");
  assert.equal(env!.PROMOTED_BETA_KEY, "TEST_SECRET_BETA");
  assert.ok(typeof env!.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON === "string");
});

test("2b/functionalExecution env propagation: omitting runtimeInputValues changes nothing (backward compatible, no invented authority)", () => {
  const env = buildPlaywrightCommandEnv({ source: "test", headless: true, appSlug: "synthetic-app" });
  assert.ok(env);
  assert.equal(env!.APP_SLUG, "synthetic-app");
  assert.equal(env!.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON, undefined);
  assert.equal(Object.keys(env!).some((key) => key.startsWith("PROMOTED_") && key !== "PROMOTED_RUNTIME_DATA_OVERRIDES_JSON"), false);
});

test("3/compiler-env compatibility: the env name dataRefEnvExpression's convention expects for a synthetic valueKey is byte-identical to what the child-env helper materializes", () => {
  const plan: ExecutionPlan = {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    createdAt: new Date().toISOString(),
    scenario: { source: "manual", externalId: "C-ENV-COMPAT-1", title: "Env compatibility" },
    requiredData: [],
    steps: [
      { index: 1, action: "fill", description: "Fill synthetic field", target: { strategy: "text", value: "SyntheticField" }, valueKey: "synthetic_field_key" },
    ],
  };
  const sourceScenario = {
    title: "Env compatibility",
    steps: [{ index: 1, action: "Fill synthetic field", technicalTargetRef: "role:textbox|SyntheticField" }],
  };
  const contract = buildSpecExecutionContract(plan, sourceScenario as any, { appSlug: "synthetic-app", sectionSlug: "default-section" });
  const targetSpecPath = path.resolve(process.cwd(), "automations/apps/synthetic-app/sections/default-section/cases/env-compat/case.spec.ts");
  const compiled = compileDeterministicSpec(contract, { targetSpecPath });

  const expectedEnvName = runtimeEnvNameForValueKey("synthetic_field_key");
  assert.match(compiled.source, new RegExp(`process\\.env\\['${expectedEnvName}'\\]`), "compiler's emitted env read must use exactly the same env name the child-env helper materializes");

  const patch = materializePromotedRuntimeEnv({ synthetic_field_key: "SYNTHETIC_VALUE" });
  assert.equal(patch[expectedEnvName], "SYNTHETIC_VALUE");
});

test("4/secret safety: synthetic secret values never appear in captured console output during materialization or env-build", () => {
  const originalLog = console.log;
  const captured: string[] = [];
  console.log = (...args: unknown[]) => { captured.push(args.map(String).join(" ")); };
  try {
    materializePromotedRuntimeEnv(SYNTHETIC_VALUES);
    buildPlaywrightCommandEnv({ source: "test", headless: true, appSlug: "synthetic-app", runtimeInputValues: SYNTHETIC_VALUES });
  } finally {
    console.log = originalLog;
  }
  const combined = captured.join("\n");
  assert.doesNotMatch(combined, /TEST_SECRET_ALPHA/);
  assert.doesNotMatch(combined, /TEST_SECRET_BETA/);
});
