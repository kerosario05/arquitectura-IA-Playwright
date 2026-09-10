import assert from "node:assert/strict";
import test from "node:test";
import { resolveSyntheticValue } from "./synthetic-value-resolver";

const requirement = (fieldCapability: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  key: "field.value",
  valuePolicy: "safe_synthetic",
  sensitive: false,
  fieldCapability,
  ...extra,
}) as any;

test("generates stable text and varies with the seed", () => {
  const first = resolveSyntheticValue({ requirement: requirement({ kind: "text" }), seed: "seed-a" });
  const repeat = resolveSyntheticValue({ requirement: requirement({ kind: "text" }), seed: "seed-a" });
  const other = resolveSyntheticValue({ requirement: requirement({ kind: "text" }), seed: "seed-b" });

  assert.equal(first.status, "generated");
  assert.equal(first.strategy, "synthetic:text");
  assert.equal(first.value, repeat.value);
  assert.notEqual(first.value, other.value);
});

test("respects text length and number bounds", () => {
  const text = resolveSyntheticValue({ requirement: requirement({ kind: "text", constraints: { minLength: 8, maxLength: 8 } }), seed: "seed" });
  const number = resolveSyntheticValue({ requirement: requirement({ kind: "number", constraints: { min: 10, max: 12 } }), seed: "seed" });

  assert.equal(typeof text.value, "string");
  assert.equal((text.value as string).length, 8);
  assert.ok((number.value as number) >= 10 && (number.value as number) <= 12);
});

test("generates a valid email", () => {
  const result = resolveSyntheticValue({ requirement: requirement({ kind: "email" }), seed: "seed" });
  assert.equal(result.status, "generated");
  assert.match(String(result.value), /^[^@]+@[^@]+\.[^@]+$/);
});

test("select and radio choose only allowed values", () => {
  for (const kind of ["select", "radio"]) {
    const result = resolveSyntheticValue({ requirement: requirement({ kind, allowedValues: ["A", "B"] }), seed: "seed" });
    assert.equal(result.status, "generated");
    assert.ok(["A", "B"].includes(String(result.value)));
  }
});

test("blocks unsupported policies, sensitive fields, and unsupported kinds", () => {
  for (const extra of [
    { valuePolicy: "trusted_required" },
    { valuePolicy: "scenario_controlled" },
    { sensitive: true },
  ]) {
    assert.equal(resolveSyntheticValue({ requirement: requirement({ kind: "text" }, extra), seed: "seed" }).status, "unresolved");
  }
  for (const kind of ["password", "file", "unknown"]) {
    assert.equal(resolveSyntheticValue({ requirement: requirement({ kind }), seed: "seed" }).status, "unresolved");
  }
});

test("leaves select without options and impossible constraints unresolved", () => {
  assert.equal(resolveSyntheticValue({ requirement: requirement({ kind: "select", allowedValues: [] }), seed: "seed" }).status, "unresolved");
  assert.equal(resolveSyntheticValue({ requirement: requirement({ kind: "number", constraints: { min: 5, max: 2 } }), seed: "seed" }).status, "unresolved");
});

test("generates deterministic checkbox and dates", () => {
  for (const kind of ["checkbox", "date", "datetime"]) {
    const result = resolveSyntheticValue({ requirement: requirement({ kind }), seed: "seed" });
    assert.equal(result.status, "generated");
    assert.equal(result.value, resolveSyntheticValue({ requirement: requirement({ kind }), seed: "seed" }).value);
  }
  assert.equal(resolveSyntheticValue({ requirement: requirement({ kind: "file" }), seed: "seed" }).status, "unresolved");
});
