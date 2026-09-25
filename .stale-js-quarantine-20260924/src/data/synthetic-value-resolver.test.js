"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const synthetic_value_resolver_1 = require("./synthetic-value-resolver");
const requirement = (fieldCapability, extra = {}) => ({
    key: "field.value",
    valuePolicy: "safe_synthetic",
    sensitive: false,
    fieldCapability,
    ...extra,
});
(0, node_test_1.default)("generates stable text and varies with the seed", () => {
    const first = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "text" }), seed: "seed-a" });
    const repeat = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "text" }), seed: "seed-a" });
    const other = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "text" }), seed: "seed-b" });
    strict_1.default.equal(first.status, "generated");
    strict_1.default.equal(first.strategy, "synthetic:text");
    strict_1.default.equal(first.value, repeat.value);
    strict_1.default.notEqual(first.value, other.value);
});
(0, node_test_1.default)("respects text length and number bounds", () => {
    const text = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "text", constraints: { minLength: 8, maxLength: 8 } }), seed: "seed" });
    const number = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "number", constraints: { min: 10, max: 12 } }), seed: "seed" });
    strict_1.default.equal(typeof text.value, "string");
    strict_1.default.equal(text.value.length, 8);
    strict_1.default.ok(number.value >= 10 && number.value <= 12);
});
(0, node_test_1.default)("generates a valid email", () => {
    const result = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "email" }), seed: "seed" });
    strict_1.default.equal(result.status, "generated");
    strict_1.default.match(String(result.value), /^[^@]+@[^@]+\.[^@]+$/);
});
(0, node_test_1.default)("select and radio choose only allowed values", () => {
    for (const kind of ["select", "radio"]) {
        const result = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind, allowedValues: ["A", "B"] }), seed: "seed" });
        strict_1.default.equal(result.status, "generated");
        strict_1.default.ok(["A", "B"].includes(String(result.value)));
    }
});
(0, node_test_1.default)("blocks unsupported policies, sensitive fields, and unsupported kinds", () => {
    for (const extra of [
        { valuePolicy: "trusted_required" },
        { valuePolicy: "scenario_controlled" },
        { sensitive: true },
    ]) {
        strict_1.default.equal((0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "text" }, extra), seed: "seed" }).status, "unresolved");
    }
    for (const kind of ["password", "file", "unknown"]) {
        strict_1.default.equal((0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind }), seed: "seed" }).status, "unresolved");
    }
});
(0, node_test_1.default)("leaves select without options and impossible constraints unresolved", () => {
    strict_1.default.equal((0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "select", allowedValues: [] }), seed: "seed" }).status, "unresolved");
    strict_1.default.equal((0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "number", constraints: { min: 5, max: 2 } }), seed: "seed" }).status, "unresolved");
});
(0, node_test_1.default)("generates deterministic checkbox and dates", () => {
    for (const kind of ["checkbox", "date", "datetime"]) {
        const result = (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind }), seed: "seed" });
        strict_1.default.equal(result.status, "generated");
        strict_1.default.equal(result.value, (0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind }), seed: "seed" }).value);
    }
    strict_1.default.equal((0, synthetic_value_resolver_1.resolveSyntheticValue)({ requirement: requirement({ kind: "file" }), seed: "seed" }).status, "unresolved");
});
