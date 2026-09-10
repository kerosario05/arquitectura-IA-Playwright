import assert from "node:assert/strict";
import test from "node:test";
import { resolveScenarioSyntheticValue } from "./scenario-synthetic-value-resolver";
import { resolveSyntheticValue } from "./synthetic-value-resolver";
import { resolveScenarioGeneratedValue } from "./scenario-generated-value-resolver";

const requirement = (kind: string, extra: Record<string, unknown> = {}) => ({
  key: "fixture.value",
  inputRole: "scenario",
  valuePolicy: "scenario_controlled",
  scenarioDataPolicy: "synthetic_allowed",
  sensitive: false,
  fieldCapability: { kind, ...((extra.fieldCapability as object | undefined) ?? {}) },
  ...extra,
}) as any;

test("generates only authorized scenario capabilities and preserves the supporting gate", () => {
  assert.equal(resolveScenarioSyntheticValue({ requirement: requirement("email"), seed: "seed" }).status, "generated");
  assert.equal(resolveScenarioSyntheticValue({ requirement: requirement("tel"), seed: "seed" }).status, "generated");
  const number = resolveScenarioSyntheticValue({ requirement: requirement("number", { fieldCapability: { kind: "number", constraints: { min: 10, max: 12 } } }), seed: "seed" });
  assert.equal(number.status, "generated");
  assert.ok((number.value as number) >= 10 && (number.value as number) <= 12);
  assert.equal(resolveScenarioSyntheticValue({ requirement: requirement("date"), seed: "seed" }).status, "generated");
  assert.equal(resolveScenarioSyntheticValue({ requirement: requirement("datetime"), seed: "seed" }).status, "generated");

  for (const kind of ["text", "password", "select", "radio", "file", "unknown"]) {
    assert.equal(resolveScenarioSyntheticValue({ requirement: requirement(kind), seed: "seed" }).status, "unresolved");
  }
  for (const policy of ["trusted_required", "explicit_value", "manual_required", "unresolved"]) {
    assert.equal(resolveScenarioSyntheticValue({ requirement: requirement("email", { scenarioDataPolicy: policy }), seed: "seed" }).status, "unresolved");
  }
  assert.equal(resolveScenarioSyntheticValue({ requirement: requirement("email", { inputRole: "supporting" }), seed: "seed" }).status, "unresolved");
  assert.equal(resolveScenarioSyntheticValue({ requirement: requirement("email", { sensitive: true }), seed: "seed" }).status, "unresolved");
  assert.equal(resolveScenarioSyntheticValue({ requirement: requirement("email", { inputRole: undefined }), seed: "seed" }).status, "unresolved");

  const first = resolveScenarioSyntheticValue({ requirement: requirement("email"), seed: "same" });
  const repeat = resolveScenarioSyntheticValue({ requirement: requirement("email"), seed: "same" });
  assert.equal(first.value, repeat.value);
  assert.equal(resolveSyntheticValue({ requirement: { ...requirement("email"), valuePolicy: "safe_synthetic" }, seed: "seed" }).status, "generated");
});

test("resolves generic profiles from project value sets and technical constraints", () => {
  const config = { version: "fixture", valueSets: { alpha: { values: ["A", "B"] } } } as any;
  const base = { key: "fixture.text", inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "configured_value_allowed", fieldCapability: { kind: "text" } } as any;
  const configured = resolveScenarioGeneratedValue({ requirement: base, generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "alpha", semanticHint: "alpha" }, projectGenerationConfig: config, seed: "seed" });
  assert.equal(configured.status, "resolved");
  assert.equal(configured.value, resolveScenarioGeneratedValue({ requirement: base, generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "alpha", semanticHint: "beta" }, projectGenerationConfig: config, seed: "seed" }).value);
  assert.equal(resolveScenarioGeneratedValue({ requirement: base, generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "missing" }, projectGenerationConfig: config, seed: "seed" }).status, "unresolved");
  const number = resolveScenarioGeneratedValue({ requirement: { ...base, fieldCapability: { kind: "number" } }, generationProfile: { valueKind: "number", sourceMode: "synthetic", constraints: { min: 10, max: 20, step: 2, integerOnly: true, decimalScale: 0 } }, projectGenerationConfig: config, seed: "seed" });
  assert.equal(number.status, "resolved");
  assert.equal((number.value as number) % 2, 0);
  assert.ok((number.value as number) >= 10 && (number.value as number) <= 20);
  const formatted = resolveScenarioGeneratedValue({ requirement: base, generationProfile: { valueKind: "string", sourceMode: "synthetic", format: { allowedPrefixes: ["X", "Y"], totalLength: 10 } }, projectGenerationConfig: config, seed: "seed" });
  assert.equal(formatted.status, "resolved");
  assert.equal((formatted.value as string).length, 10);
  assert.ok(["X", "Y"].some((prefix) => (formatted.value as string).startsWith(prefix)));
});

test("blocks protected, supporting and manual generation without business categories", () => {
  const config = { version: "fixture", valueSets: { alpha: { values: ["A"] } } } as any;
  const profile = { valueKind: "string", sourceMode: "configured_values", valueSetRef: "alpha" } as any;
  for (const requirement of [
    { inputRole: "supporting" }, { sensitive: true }, { fieldCapability: { kind: "password" } },
    { valuePolicy: "trusted_required" }, { scenarioDataPolicy: "trusted_required" },
  ]) assert.notEqual(resolveScenarioGeneratedValue({ requirement: { key: "fixture", inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "configured_value_allowed", fieldCapability: { kind: "text" }, ...requirement } as any, generationProfile: profile, projectGenerationConfig: config, seed: "seed" }).status, "resolved");
  assert.equal(resolveScenarioGeneratedValue({ requirement: { key: "fixture", inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "configured_value_allowed", fieldCapability: { kind: "text" } } as any, generationProfile: { valueKind: "string", sourceMode: "manual" }, projectGenerationConfig: config, seed: "seed" }).status, "blocked");
});

test("uses only the profile characterSet for formatted string filler", () => {
  const config = { version: "fixture", valueSets: {} } as any;
  const requirement = { key: "fixture.formatted", inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "synthetic_allowed", fieldCapability: { kind: "text" } } as any;
  const resolve = (characterSet: string | undefined, semanticHint: string) => resolveScenarioGeneratedValue({ requirement, generationProfile: { valueKind: "string", sourceMode: "synthetic", format: { allowedPrefixes: ["AB"], totalLength: 8, ...(characterSet ? { characterSet } : {}) }, semanticHint }, projectGenerationConfig: config, seed: "same" } as any);
  const digits = resolve("digits", "phone");
  const letters = resolve("letters", "code");
  const alphanumeric = resolve("alphanumeric", "code");
  assert.equal(digits.status, "resolved");
  assert.match(String(digits.value), /^AB[0-9]{6}$/);
  assert.match(String(letters.value), /^AB[A-Za-z]{6}$/);
  assert.match(String(alphanumeric.value), /^AB[A-Za-z0-9]{6}$/);
  assert.equal(String(digits.value).length, 8);
  assert.equal(digits.value, resolve("digits", "different hint").value);
  assert.equal(resolve("invalid", "code").status, "unresolved");
  assert.match(String(resolve(undefined, "code").value), /^AB[A-Za-z0-9]{6}$/);
});
