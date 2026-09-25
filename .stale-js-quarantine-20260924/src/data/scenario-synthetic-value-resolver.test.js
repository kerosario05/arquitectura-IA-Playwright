"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const scenario_synthetic_value_resolver_1 = require("./scenario-synthetic-value-resolver");
const synthetic_value_resolver_1 = require("./synthetic-value-resolver");
const scenario_generated_value_resolver_1 = require("./scenario-generated-value-resolver");
const requirement = (kind, extra = {}) => ({
    key: "fixture.value",
    inputRole: "scenario",
    valuePolicy: "scenario_controlled",
    scenarioDataPolicy: "synthetic_allowed",
    sensitive: false,
    fieldCapability: { kind, ...(extra.fieldCapability ?? {}) },
    ...extra,
});
(0, node_test_1.default)("generates only authorized scenario capabilities and preserves the supporting gate", () => {
    strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("email"), seed: "seed" }).status, "generated");
    strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("tel"), seed: "seed" }).status, "generated");
    const number = (0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("number", { fieldCapability: { kind: "number", constraints: { min: 10, max: 12 } } }), seed: "seed" });
    strict_1.default.equal(number.status, "generated");
    strict_1.default.ok(number.value >= 10 && number.value <= 12);
    strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("date"), seed: "seed" }).status, "generated");
    strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("datetime"), seed: "seed" }).status, "generated");
    for (const kind of ["text", "password", "select", "radio", "file", "unknown"]) {
        strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement(kind), seed: "seed" }).status, "unresolved");
    }
    for (const policy of ["trusted_required", "explicit_value", "manual_required", "unresolved"]) {
        strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("email", { scenarioDataPolicy: policy }), seed: "seed" }).status, "unresolved");
    }
    strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("email", { inputRole: "supporting" }), seed: "seed" }).status, "unresolved");
    strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("email", { sensitive: true }), seed: "seed" }).status, "unresolved");
    strict_1.default.equal((0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("email", { inputRole: undefined }), seed: "seed" }).status, "unresolved");
    const first = (0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("email"), seed: "same" });
    const repeat = (0, scenario_synthetic_value_resolver_1.resolveScenarioSyntheticValue)({ requirement: requirement("email"), seed: "same" });
    strict_1.default.equal(first.value, repeat.value);
    strict_1.default.equal((0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: { ...requirement("email"), valuePolicy: "safe_synthetic" }, seed: "seed" }).status, "generated");
});
(0, node_test_1.default)("resolves generic profiles from project value sets and technical constraints", () => {
    const config = { version: "fixture", valueSets: { alpha: { values: ["A", "B"] } } };
    const base = { key: "fixture.text", inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "configured_value_allowed", fieldCapability: { kind: "text" } };
    const configured = (0, scenario_generated_value_resolver_1.resolveScenarioGeneratedValue)({ requirement: base, generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "alpha", semanticHint: "alpha" }, projectGenerationConfig: config, seed: "seed" });
    strict_1.default.equal(configured.status, "resolved");
    strict_1.default.equal(configured.value, (0, scenario_generated_value_resolver_1.resolveScenarioGeneratedValue)({ requirement: base, generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "alpha", semanticHint: "beta" }, projectGenerationConfig: config, seed: "seed" }).value);
    strict_1.default.equal((0, scenario_generated_value_resolver_1.resolveScenarioGeneratedValue)({ requirement: base, generationProfile: { valueKind: "string", sourceMode: "configured_values", valueSetRef: "missing" }, projectGenerationConfig: config, seed: "seed" }).status, "unresolved");
    const number = (0, scenario_generated_value_resolver_1.resolveScenarioGeneratedValue)({ requirement: { ...base, fieldCapability: { kind: "number" } }, generationProfile: { valueKind: "number", sourceMode: "synthetic", constraints: { min: 10, max: 20, step: 2, integerOnly: true, decimalScale: 0 } }, projectGenerationConfig: config, seed: "seed" });
    strict_1.default.equal(number.status, "resolved");
    strict_1.default.equal(number.value % 2, 0);
    strict_1.default.ok(number.value >= 10 && number.value <= 20);
    const formatted = (0, scenario_generated_value_resolver_1.resolveScenarioGeneratedValue)({ requirement: base, generationProfile: { valueKind: "string", sourceMode: "synthetic", format: { allowedPrefixes: ["X", "Y"], totalLength: 10 } }, projectGenerationConfig: config, seed: "seed" });
    strict_1.default.equal(formatted.status, "resolved");
    strict_1.default.equal(formatted.value.length, 10);
    strict_1.default.ok(["X", "Y"].some((prefix) => formatted.value.startsWith(prefix)));
});
(0, node_test_1.default)("blocks protected, supporting and manual generation without business categories", () => {
    const config = { version: "fixture", valueSets: { alpha: { values: ["A"] } } };
    const profile = { valueKind: "string", sourceMode: "configured_values", valueSetRef: "alpha" };
    for (const requirement of [
        { inputRole: "supporting" }, { sensitive: true }, { fieldCapability: { kind: "password" } },
        { valuePolicy: "trusted_required" }, { scenarioDataPolicy: "trusted_required" },
    ])
        strict_1.default.notEqual((0, scenario_generated_value_resolver_1.resolveScenarioGeneratedValue)({ requirement: { key: "fixture", inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "configured_value_allowed", fieldCapability: { kind: "text" }, ...requirement }, generationProfile: profile, projectGenerationConfig: config, seed: "seed" }).status, "resolved");
    strict_1.default.equal((0, scenario_generated_value_resolver_1.resolveScenarioGeneratedValue)({ requirement: { key: "fixture", inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "configured_value_allowed", fieldCapability: { kind: "text" } }, generationProfile: { valueKind: "string", sourceMode: "manual" }, projectGenerationConfig: config, seed: "seed" }).status, "blocked");
});
(0, node_test_1.default)("uses only the profile characterSet for formatted string filler", () => {
    const config = { version: "fixture", valueSets: {} };
    const requirement = { key: "fixture.formatted", inputRole: "scenario", valuePolicy: "scenario_controlled", scenarioDataPolicy: "synthetic_allowed", fieldCapability: { kind: "text" } };
    const resolve = (characterSet, semanticHint) => (0, scenario_generated_value_resolver_1.resolveScenarioGeneratedValue)({ requirement, generationProfile: { valueKind: "string", sourceMode: "synthetic", format: { allowedPrefixes: ["AB"], totalLength: 8, ...(characterSet ? { characterSet } : {}) }, semanticHint }, projectGenerationConfig: config, seed: "same" });
    const digits = resolve("digits", "phone");
    const letters = resolve("letters", "code");
    const alphanumeric = resolve("alphanumeric", "code");
    strict_1.default.equal(digits.status, "resolved");
    strict_1.default.match(String(digits.value), /^AB[0-9]{6}$/);
    strict_1.default.match(String(letters.value), /^AB[A-Za-z]{6}$/);
    strict_1.default.match(String(alphanumeric.value), /^AB[A-Za-z0-9]{6}$/);
    strict_1.default.equal(String(digits.value).length, 8);
    strict_1.default.equal(digits.value, resolve("digits", "different hint").value);
    strict_1.default.equal(resolve("invalid", "code").status, "unresolved");
    strict_1.default.match(String(resolve(undefined, "code").value), /^AB[A-Za-z0-9]{6}$/);
});
