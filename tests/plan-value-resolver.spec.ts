import { expect, test } from "@playwright/test";
import { resolveStepValue } from "../src/runner/plan-value-resolver";
import type { DataContext } from "../src/data/data-context";
import type { ExecutionPlanStep } from "../src/types/execution-plan.types";

const dataContext: DataContext = {
  entries: [
    { key: "cedula", value: "001", source: "test_data", sensitive: true },
    { key: "numeroPrestamo", value: "ABC", source: "test_data", sensitive: false }
  ],
  counts: { total: 2, sensitive: 1, nonSensitive: 1 }
};

function stepBase(): ExecutionPlanStep {
  return { index: 1, action: "fill", target: { strategy: "label", value: "Cédula" } };
}

test("resolves direct value", () => {
  const step = { ...stepBase(), value: "literal" };
  expect(resolveStepValue({ step, dataContext })).toBe("literal");
});

test("resolves exact valueKey", () => {
  const step = { ...stepBase(), valueKey: "cedula" };
  expect(resolveStepValue({ step, dataContext })).toBe("001");
});

test("resolves normalized valueKey", () => {
  const step = { ...stepBase(), valueKey: "numeroprestamo" };
  expect(resolveStepValue({ step, dataContext })).toBe("ABC");
});

test("throws on missing valueKey", () => {
  const step = { ...stepBase(), valueKey: "missingKey" };
  expect(() => resolveStepValue({ step, dataContext })).toThrow(/Missing value for step valueKey/);
});
