import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { findUncertifiedRequiredTargetSteps } from "./spec-generation-hybrid";

function plan(steps: unknown[]) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { source: "testrail", caseId: 55032, externalId: "C55032", title: "Transfer" },
    requiredData: [],
    steps,
    createdAt: "2026-10-21T00:00:00.000Z",
  } as any;
}

test("pairs repeated SMS and Continue actions to their validated plan occurrences across omitted assertions", () => {
  const planSteps = [
    { index: 7, action: "click", description: 'Presionar "SMS"', target: { strategy: "snapshot:exact_text", value: "SMS" } },
    { index: 15, action: "click", description: 'Presionar "Continuar"', target: { strategy: "page:button:text", value: "Continuar" } },
    { index: 16, action: "click", description: 'Presionar "Continuar"', target: { strategy: "page:button:text", value: "Continuar" } },
    { index: 17, action: "click", description: 'Presionar "SMS"', target: { strategy: "snapshot:exact_text", value: "SMS" } },
  ];
  const scenarioSteps = [
    { index: 8, action: 'Presionar "SMS"', description: 'Presionar "SMS"' },
    { index: 17, action: 'Presionar "Continuar"', description: 'Presionar "Continuar"' },
    { index: 25, action: 'Presionar "Continuar"', description: 'Presionar "Continuar"' },
    { index: 27, action: 'Presionar "SMS"', description: 'Presionar "SMS"' },
  ];

  const contract = buildSpecExecutionContract(plan(planSteps), { steps: scenarioSteps });

  assert.equal(contract.steps.length, 4);
  assert.deepEqual(contract.steps.map((step) => step.scenarioStepIndex), [8, 17, 25, 27]);
  assert.ok(contract.steps.every((step) => step.implementation?.kind === "runtime"));
  assert.ok(contract.steps.every((step) => step.certifiedTechnicalTarget));
  assert.equal(findUncertifiedRequiredTargetSteps(contract).length, 0);
});

test("does not pair repeated target labels when source and plan occurrence counts differ", () => {
  const contract = buildSpecExecutionContract(
    plan([
      { index: 1, action: "click", description: 'Presionar "SMS"', target: { strategy: "snapshot:exact_text", value: "SMS" } },
      { index: 2, action: "click", description: 'Presionar "SMS"', target: { strategy: "snapshot:exact_text", value: "SMS" } },
    ]),
    { steps: [{ index: 8, action: 'Presionar "SMS"', description: 'Presionar "SMS"' }] },
  );

  assert.equal(contract.steps[0]?.implementation, undefined);
  assert.equal(contract.steps[0]?.certifiedTechnicalTarget, undefined);
  assert.equal(findUncertifiedRequiredTargetSteps(contract).length, 1);
});
