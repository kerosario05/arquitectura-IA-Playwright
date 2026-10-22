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

test("classifies recorded Spanish system observations as visible text assertions", () => {
  const contract = buildSpecExecutionContract({
    scenario: { externalId: "PREVIEW-001", title: "Recorded flow" },
    steps: [],
  } as any, {
    expectedResult: "",
    observableOracles: [{
      id: "observed-01",
      requirement: 'El sistema muestra "¡Hola!"',
      target: "¡Hola!",
      type: "literal_visible_text",
      backed: true,
      source: "discovery",
      stepIndex: 1,
      evidence: ["assertion_resolved_during_discovery"],
    }],
    steps: [{ index: 1, action: 'El sistema muestra "¡Hola!"', description: 'El sistema muestra "¡Hola!"' }],
  } as any);
  assert.equal(contract.steps[0]?.operation, "assertVisible");
  assert.equal(contract.steps[0]?.oracle?.type, "literal_visible_text");
  assert.equal(contract.steps[0]?.oracle?.target, "¡Hola!");
  assert.equal(contract.steps[0]?.required, true);
});

test("keeps a snapshot-backed oracle when its canonical requirement reference matches", () => {
  const canonical = canonicalizeTestRailCase({
    id: 906,
    title: "Visible result",
    custom_steps_separated: [{ content: 'Validar que se muestre "Transfer receipt".' }],
  });
  const canonicalStep = canonical.steps[0]!;
  const requirementId = canonicalStep.requirementRefs?.[0];
  assert.ok(requirementId);
  const contract = buildSpecExecutionContract({
    scenario: { externalId: "C906", title: canonical.title },
    steps: [{ index: 1, action: "assert" }],
  } as any, {
    steps: [{
      index: 1,
      action: canonicalStep.action,
      expected: canonicalStep.expected,
      requirementRefs: canonicalStep.requirementRefs,
      canonicalAssertion: canonicalStep.canonicalAssertion,
    }],
    requirements: canonical.requirements,
    stepRequirementRefs: [{ stepIndex: 1, requirementId }],
    observableOracles: [{
      id: "observed-receipt",
      requirement: canonicalStep.action,
      requirementRefs: [requirementId],
      type: "page_object_state",
      backed: true,
      source: "discovery",
      stepIndex: 1,
      target: "Transfer receipt",
      details: { visibleTargets: ["Transfer receipt"] },
      evidence: ["causal_snapshot_visible_text"],
    }],
  } as any);

  const assertion = contract.steps[0]!;
  assert.equal(assertion.operation, "assertState");
  assert.equal(assertion.oracle?.backed, true);
  assert.deepEqual(assertion.oracle?.requirementRefs, [requirementId]);
  assert.equal(assertion.executionStatus, "executed");
});

test("does not bind a backed oracle from a different canonical requirement", () => {
  const canonical = canonicalizeTestRailCase({
    id: 907,
    title: "Visible result",
    custom_steps_separated: [{ content: 'Validar que se muestre "Transfer receipt".' }],
  });
  const canonicalStep = canonical.steps[0]!;
  const requirementId = canonicalStep.requirementRefs?.[0];
  assert.ok(requirementId);
  const contract = buildSpecExecutionContract({
    scenario: { externalId: "C907", title: canonical.title },
    steps: [{ index: 1, action: "assert" }],
  } as any, {
    steps: [{
      index: 1,
      action: canonicalStep.action,
      expected: canonicalStep.expected,
      requirementRefs: canonicalStep.requirementRefs,
      canonicalAssertion: canonicalStep.canonicalAssertion,
    }],
    requirements: canonical.requirements,
    stepRequirementRefs: [{ stepIndex: 1, requirementId }],
    observableOracles: [{
      id: "observed-unrelated",
      requirement: canonicalStep.action,
      requirementRefs: ["unrelated-requirement"],
      type: "page_object_state",
      backed: true,
      source: "discovery",
      stepIndex: 1,
      target: "Transfer receipt",
      evidence: ["causal_snapshot_visible_text"],
    }],
  } as any);

  const assertion = contract.steps[0]!;
  assert.equal(assertion.oracle, undefined);
  assert.equal(assertion.executionStatus, "unresolved");
});
