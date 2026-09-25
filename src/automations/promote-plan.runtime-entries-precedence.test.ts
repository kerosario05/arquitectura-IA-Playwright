import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { buildRuntimeInputValues } from "./promote-plan";
import { buildPlaywrightCommandEnv } from "./spec-generation-hybrid";
import { materializePromotedRuntimeEnv } from "./runtime/promoted-spec-runtime";
import type { DataContextEntry } from "../data/data-context";

/**
 * Proves the FIRST_LOSS fix: scenario-scoped runtimeEntries (which may carry
 * CURRENT_QA_EDIT-sourced overrides from the caller's own resolver, e.g. Discovery) now reach
 * promote-plan.ts's input surface and take precedence over static/configured dataContext
 * entries when building runtimeInputValues -- closing the gap traced two tickets ago (jobId
 * 88d0e667-dc2e-4429-ad71-d99a38fdc44e): this authority reached Discovery's own resolveDataKey
 * but was never passed into promoteExecutionPlan at all.
 *
 * Static/integration wiring only -- does not and cannot claim the physical fill is fixed.
 */

function entry(overrides: Partial<DataContextEntry> & Pick<DataContextEntry, "key" | "value">): DataContextEntry {
  return {
    source: "test_data",
    sensitive: false,
    ...overrides,
  };
}

test("1/workflow propagation: case-discovery-workflow's promoteExecutionPlan call site passes options.runtimeEntries through unchanged, unconditionally", async () => {
  const source = await fs.readFile(
    path.resolve(__dirname, "../discovery/case-discovery-workflow.ts"),
    "utf8",
  );
  const start = source.indexOf("await promoteExecutionPlan(");
  assert.ok(start !== -1, "case-discovery-workflow.ts must still call promoteExecutionPlan(...)");
  let depth = 0;
  let i = start + "await promoteExecutionPlan(".length - 1;
  const openIndex = i;
  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") { depth--; if (depth === 0) break; }
  }
  const callBlock = source.slice(openIndex, i + 1);
  assert.match(
    callBlock,
    /runtimeEntries:\s*options\.runtimeEntries\s*,?/,
    "must pass options.runtimeEntries through literally, no transformation/flattening at this call site",
  );
});

test("2/promote precedence: a runtime entry overriding one key wins; a key with no runtime entry keeps the static value", () => {
  const dataContextEntries: DataContextEntry[] = [
    entry({ key: "alpha_key", value: "STATIC_ALPHA" }),
    entry({ key: "beta_key", value: "STATIC_BETA" }),
  ];
  const runtimeEntries: DataContextEntry[] = [
    entry({ key: "alpha_key", value: "RUNTIME_ALPHA", source: "manual_runtime" }),
  ];

  const result = buildRuntimeInputValues(dataContextEntries, runtimeEntries);

  assert.equal(result.alpha_key, "RUNTIME_ALPHA", "runtime authority must win over static config");
  assert.equal(result.beta_key, "STATIC_BETA", "key with no runtime entry keeps the static value");
});

test("3/env propagation regression: the resulting runtimeInputValues still reaches PROMOTED_<KEY> via the existing pipeline", () => {
  const dataContextEntries: DataContextEntry[] = [entry({ key: "beta_key", value: "STATIC_BETA" })];
  const runtimeEntries: DataContextEntry[] = [entry({ key: "alpha_key", value: "RUNTIME_ALPHA", source: "manual_runtime" })];
  const runtimeInputValues = buildRuntimeInputValues(dataContextEntries, runtimeEntries);

  const env = buildPlaywrightCommandEnv({ source: "test", headless: true, appSlug: "synthetic-app", runtimeInputValues });
  assert.ok(env);
  assert.equal(env!.PROMOTED_ALPHA_KEY, "RUNTIME_ALPHA");
  assert.equal(env!.PROMOTED_BETA_KEY, "STATIC_BETA");

  const directPatch = materializePromotedRuntimeEnv(runtimeInputValues);
  assert.equal(directPatch.PROMOTED_ALPHA_KEY, "RUNTIME_ALPHA");
});

test("4/empty runtimeEntries regression: undefined or empty runtimeEntries preserves prior static-only behavior", () => {
  const dataContextEntries: DataContextEntry[] = [
    entry({ key: "alpha_key", value: "STATIC_ALPHA" }),
    entry({ key: "beta_key", value: "STATIC_BETA" }),
  ];

  const resultUndefined = buildRuntimeInputValues(dataContextEntries, undefined);
  assert.deepEqual(resultUndefined, { alpha_key: "STATIC_ALPHA", beta_key: "STATIC_BETA" });

  const resultEmpty = buildRuntimeInputValues(dataContextEntries, []);
  assert.deepEqual(resultEmpty, { alpha_key: "STATIC_ALPHA", beta_key: "STATIC_BETA" });
});

test("5/secret safety: synthetic sensitive runtime-entry values never appear in captured console output", () => {
  const dataContextEntries: DataContextEntry[] = [entry({ key: "beta_key", value: "STATIC_BETA_SECRET" })];
  const runtimeEntries: DataContextEntry[] = [entry({ key: "alpha_key", value: "RUNTIME_ALPHA_SECRET", source: "manual_runtime", sensitive: true })];

  const originalLog = console.log;
  const captured: string[] = [];
  console.log = (...args: unknown[]) => { captured.push(args.map(String).join(" ")); };
  let runtimeInputValues: Record<string, string>;
  try {
    runtimeInputValues = buildRuntimeInputValues(dataContextEntries, runtimeEntries);
    buildPlaywrightCommandEnv({ source: "test", headless: true, appSlug: "synthetic-app", runtimeInputValues });
  } finally {
    console.log = originalLog;
  }
  const combined = captured.join("\n");
  assert.doesNotMatch(combined, /RUNTIME_ALPHA_SECRET/);
  assert.doesNotMatch(combined, /STATIC_BETA_SECRET/);
});
