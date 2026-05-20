import { expect, test } from "@playwright/test";
import { validateExecutionPlan } from "../src/plans/execution-plan-validator";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

function createValidPlan(): ExecutionPlan {
  return {
    version: "1.0",
    source: "manual",
    status: "draft",
    scenario: { source: "manual", title: "Basic scenario" },
    requiredData: [{ key: "username", required: true, resolved: true }],
    steps: [{ index: 1, action: "navigate", target: "APP_BASE_URL" }],
    createdAt: new Date().toISOString()
  };
}

test("valid minimum plan", () => {
  const result = validateExecutionPlan(createValidPlan());
  expect(result.valid).toBe(true);
});

test("fill without target is invalid", () => {
  const plan = createValidPlan();
  plan.steps = [{ index: 1, action: "fill", value: "abc" }];
  const result = validateExecutionPlan(plan);
  expect(result.valid).toBe(false);
});

test("fill without value and valueKey is invalid", () => {
  const plan = createValidPlan();
  plan.steps = [{ index: 1, action: "fill", target: { strategy: "css", value: "#x" } }];
  const result = validateExecutionPlan(plan);
  expect(result.valid).toBe(false);
});

test("assertText without expected is invalid", () => {
  const plan = createValidPlan();
  plan.steps = [{ index: 1, action: "assertText", target: { strategy: "text", value: "hello" } }];
  const result = validateExecutionPlan(plan);
  expect(result.valid).toBe(false);
});

test("duplicated step indexes are invalid", () => {
  const plan = createValidPlan();
  plan.steps = [
    { index: 1, action: "navigate", target: "APP_BASE_URL" },
    { index: 1, action: "screenshot" }
  ];
  const result = validateExecutionPlan(plan);
  expect(result.valid).toBe(false);
});

test("unresolved requiredData with validated status is invalid", () => {
  const plan = createValidPlan();
  plan.status = "validated";
  plan.requiredData = [{ key: "otp", required: true, resolved: false }];
  const result = validateExecutionPlan(plan);
  expect(result.valid).toBe(false);
});

test("valueKey not declared in requiredData raises warning", () => {
  const plan = createValidPlan();
  plan.steps = [{ index: 1, action: "fill", target: { strategy: "css", value: "#u" }, valueKey: "missingKey" }];
  const result = validateExecutionPlan(plan);
  expect(result.valid).toBe(true);
  expect(result.issues.some((issue) => issue.level === "warning" && issue.code === "STEP_VALUEKEY_NOT_DECLARED")).toBe(
    true
  );
});

test("unsupported status allows empty steps", () => {
  const plan = createValidPlan();
  plan.status = "unsupported";
  plan.steps = [];
  const result = validateExecutionPlan(plan);
  expect(result.valid).toBe(true);
});
