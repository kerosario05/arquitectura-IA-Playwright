import assert from "node:assert/strict";
import test from "node:test";
import { runtimeFillValuesMatch } from "./runtime-fill-value";

test("numeric controls accept fixed precision and validated grouping", () => {
  for (const [expected, actual] of [["10", "10.00"], ["1234.5", "1,234.50"], ["0", "-0.00"], ["-12.5", "-12.50"]]) {
    assert.equal(runtimeFillValuesMatch(expected, actual, { numeric: true, decimalSeparator: "." }), true);
  }
  assert.equal(runtimeFillValuesMatch("1234.5", "1.234,50", { numeric: true, decimalSeparator: "," }), true);
  assert.equal(runtimeFillValuesMatch("1234.5", "1 234,50", { numeric: true, decimalSeparator: "," }), true);
});

test("numeric controls accept a currency prefix and a separated unit suffix around one number", () => {
  const numeric = { numeric: true, decimalSeparator: "." as const };
  for (const actual of ["$110,000.00 mensual", "$110,000.00", "RD$ 110,000.00", "110,000.00 USD"]) {
    assert.equal(runtimeFillValuesMatch("110,000.00", actual, numeric), true, actual);
  }
  for (const actual of ["$110,000.00 mensual 2", "$110,000.01 mensual", "110,000.00mensual", "$1 110,000.00"]) {
    assert.equal(runtimeFillValuesMatch("110,000.00", actual, numeric), false, actual);
  }
});

test("numeric readback preserves sign, scale, precision and valid syntax", () => {
  for (const [expected, actual] of [["10", "1000"], ["10", "10.01"], ["-10", "10.00"], ["10.01", "1001"],
    ["10", "1,0.00"], ["10", "10.00suffix"], ["9007199254740992", "9007199254740993.00"]]) {
    assert.equal(runtimeFillValuesMatch(expected, actual, { numeric: true, decimalSeparator: "." }), false);
  }
  assert.equal(runtimeFillValuesMatch("9007199254740993", "9007199254740993.00", { numeric: true }), true);
});

test("numeric equivalence requires control authority; identifiers retain zeros", () => {
  assert.equal(runtimeFillValuesMatch("10", "10.00"), false);
  assert.equal(runtimeFillValuesMatch("001234", "1234"), false);
  assert.equal(runtimeFillValuesMatch("001234", "001234"), true);
  assert.equal(runtimeFillValuesMatch("123456", "123-456"), true);
  assert.equal(runtimeFillValuesMatch("2026-10-21", "21/10/2026"), true);
});
