import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { canonicalizeTestRailCase } from "../testrail/testrail-canonical-adapter";

test("round-trips canonical assertion parents into semantic contract steps", () => {
  const canonical = canonicalizeTestRailCase({
    id: 905,
    title: "Constrained transition",
    custom_steps_separated: [
      ...Array.from({ length: 12 }, (_, index) => ({ content: `Perform action ${index + 1}` })),
      { content: 'Al salir del campo "subject", validar que el campo quede inválido y que se muestre un mensaje asociado al dato.' },
      { content: 'Validar que, mientras el campo "subject" permanezca inválido, la acción "advance" permanezca deshabilitada y no permita continuar.' },
    ],
  });
  const source = {
    steps: canonical.steps.map((step) => ({
      index: step.order,
      action: step.action,
      expected: step.expected,
      requirementRefs: step.requirementRefs,
      canonicalAssertion: step.canonicalAssertion,
    })),
    requirements: canonical.requirements,
    stepRequirementRefs: canonical.steps.flatMap((step) =>
      (step.requirementRefs ?? []).map((requirementId) => ({ stepIndex: step.order, requirementId }))
    ),
  };
  const plan = {
    scenario: { externalId: "C905", title: canonical.title },
    steps: canonical.steps.map((step) => ({ index: step.order, action: "noop" })),
  } as any;

  const contract = buildSpecExecutionContract(plan, source);
  const step13 = contract.steps.find((step) => step.scenarioStepIndex === 13)!;
  const step14 = contract.steps.find((step) => step.scenarioStepIndex === 14)!;

  assert.equal(contract.diagnostics.requiredScenarioSteps, 14);
  assert.equal(contract.steps.length, 14);
  assert.equal(step13.operation, "assertState");
  assert.equal(step13.assertionIntent, "validation_present");
  assert.equal(step13.trigger, "leave_field");
  assert.equal(step13.childExpectations?.length, 2);
  assert.equal(step13.requirementRefs?.length, 1);
  assert.equal(step14.operation, "assertState");
  assert.equal(step14.assertionIntent, "transition_blocked");
  assert.equal(step13.polarity, "positive");
  assert.equal(step14.polarity, "negative");
  assert.equal(step14.condition, 'el campo "subject" permanezca inválido');
  assert.equal(step14.requirementRefs?.length, 1);
});
