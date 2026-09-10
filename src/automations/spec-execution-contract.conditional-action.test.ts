import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";

test("keeps a conditional action executable and optional in the contract", () => {
  const conditionalAction = {
    operation: "click" as const,
    actionTarget: "Salir",
    condition: { type: "visibility" as const, target: "Salir" },
    required: false as const,
    conditionalRequired: true as const,
    skipAllowedWhenConditionFalse: true as const,
  };
  const contract = buildSpecExecutionContract(
    {
      scenario: { externalId: "C-test", title: "conditional" },
      steps: [{ index: 1, action: "click", target: { strategy: "text", value: "Salir" }, optional: true, conditionalAction }],
    } as any,
    { title: "conditional", steps: [{ index: 1, action: "Si aparece, hacer clic", conditionalAction }] }
  );

  assert.equal(contract.steps.length, 1);
  assert.equal(contract.steps[0]?.operation, "click");
  assert.equal(contract.steps[0]?.conditional, true);
  assert.equal(contract.steps[0]?.required, false);
  assert.notEqual(contract.steps[0]?.operation, "noop");
});
