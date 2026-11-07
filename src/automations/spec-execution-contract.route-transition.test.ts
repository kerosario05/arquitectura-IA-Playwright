import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { identityFromContractStep } from "./runtime/promoted-field-target-contract";

test("observed route completion survives the contract and runtime identity handoff", () => {
  const plan = {
    scenario: { externalId: "synthetic-route", title: "Create entity" },
    steps: [{ index: 10, action: "click", description: 'Presionar "Create"', target: { strategy: "role", value: "button|Create" } }],
  } as any;
  for (const expectedOutcomeKind of ["route_transition", undefined] as const) {
    const contract = buildSpecExecutionContract(plan, { steps: [{ index: 10, action: 'Presionar "Create"', expectedOutcomeKind, technicalTargetRefs: ["role:button|Create"] }] });
    const step = contract.steps[0];
    assert.equal(step.expectedRouteTransition, expectedOutcomeKind === "route_transition" ? true : undefined);
    assert.equal(identityFromContractStep(step as any)?.expectedRouteTransition, expectedOutcomeKind === "route_transition");
  }
});
