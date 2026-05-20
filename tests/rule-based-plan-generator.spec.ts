import { expect, test } from "@playwright/test";
import { generateRuleBasedExecutionPlan } from "../src/plans/rule-based-plan-generator";
import { validateExecutionPlan } from "../src/plans/execution-plan-validator";
import type { TestScenario } from "../src/types/testrail.types";

function createScenario(): TestScenario {
  return {
    source: "testrail",
    externalId: "C321",
    caseId: 321,
    title: "Transfer flow",
    steps: [
      { index: 1, action: "Ingresar cedula", expected: "Aceptado", dataHints: ["cedula"] },
      { index: 2, action: "Ingresar codigo", expected: "Continuar", dataHints: ["codigo"] }
    ]
  };
}

test("generates initial navigate step", () => {
  const plan = generateRuleBasedExecutionPlan(createScenario());
  expect(plan.steps[0].action).toBe("navigate");
  expect(plan.steps[0].target).toBe("APP_BASE_URL");
});

test("generates login step when includeLogin=true", () => {
  const plan = generateRuleBasedExecutionPlan(createScenario(), { includeLogin: true });
  expect(plan.steps.some((step) => step.action === "login")).toBe(true);
});

test("converts scenario steps to noop", () => {
  const plan = generateRuleBasedExecutionPlan(createScenario());
  const noopSteps = plan.steps.filter((step) => step.action === "noop");
  expect(noopSteps).toHaveLength(2);
  expect(noopSteps[0].description).toBe("Ingresar cedula");
});

test("converts dataHints to requiredData", () => {
  const plan = generateRuleBasedExecutionPlan(createScenario());
  expect(plan.requiredData.map((item) => item.key)).toEqual(expect.arrayContaining(["cedula", "codigo"]));
  expect(plan.requiredData.every((item) => item.required && !item.resolved)).toBe(true);
});

test("generated draft plan is valid", () => {
  const plan = generateRuleBasedExecutionPlan(createScenario());
  const result = validateExecutionPlan(plan);
  expect(result.valid).toBe(true);
  expect(result.status).toBe("draft");
});
