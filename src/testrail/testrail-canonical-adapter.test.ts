import assert from "node:assert/strict";
import test from "node:test";
import { canonicalizeTestRailCase } from "./testrail-canonical-adapter";

const rawCase = {
  id: 901,
  section_id: 12,
  title: "  Recover an account  ",
  custom_preconds: "The account is active",
  custom_steps: "1. Open recovery.\n2. Submit the form.",
  custom_expected: "Recovery succeeds",
};

test("canonicalizes a normal manual TestRail case deterministically", () => {
  const first = canonicalizeTestRailCase(rawCase);
  const second = canonicalizeTestRailCase(rawCase);

  assert.deepEqual(first, second);
  assert.equal(first.canonicalSchemaVersion, "canonical-scenario-1");
  assert.equal(first.scenarioId, "testrail-case-901");
  assert.deepEqual(first.sourceRef, { kind: "testrail", caseId: 901, sectionId: 12 });
  assert.equal(first.title, "Recover an account");
  assert.deepEqual(first.preconditions, ["The account is active"]);
  assert.deepEqual(first.steps.map((step) => ({ order: step.order, action: step.action, expected: step.expected })), [
    { order: 1, action: "Open recovery.", expected: undefined },
    { order: 2, action: "Submit the form.", expected: undefined },
  ]);
  assert.deepEqual(first.expectedResults, ["Recovery succeeds"]);
  assert.equal(first.requirements.length, 1);
  assert.equal(first.requirements[0]?.kind, "expected_result");
  assert.equal(first.requirements[0]?.description, "Recovery succeeds");
  assert.equal(first.requirements[0]?.requirementId, "requirement:testrail:case:901:expected:1");
  assert.equal(first.branches, undefined);
  assert.equal(first.provenance.canonicalizationMode, "deterministic_normalized");
  assert.deepEqual(first.provenance.sourceRef, first.sourceRef);
});

test("maps explicit separated TestRail step expectations to stable requirement references", () => {
  const canonical = canonicalizeTestRailCase({
    id: 902,
    title: "Review result",
    custom_steps_separated: [
      { content: "Open the result", expected: "Result is visible" },
      { content: "Close the result", expected: "Result is closed" },
    ],
  });

  assert.deepEqual(canonical.steps.map((step) => ({ order: step.order, action: step.action, expected: step.expected, requirementRefs: step.requirementRefs })), [
    { order: 1, action: "Open the result", expected: "Result is visible", requirementRefs: ["requirement:testrail:case:902:step:1:expected"] },
    { order: 2, action: "Close the result", expected: "Result is closed", requirementRefs: ["requirement:testrail:case:902:step:2:expected"] },
  ]);
  assert.deepEqual(canonical.expectedResults, ["Result is visible", "Result is closed"]);
  assert.equal(canonical.requirements.length, 2);
  assert.deepEqual(canonical.steps.map((step) => step.requirementRefs), [
    ["requirement:testrail:case:902:step:1:expected"],
    ["requirement:testrail:case:902:step:2:expected"],
  ]);
  assert.equal("executionReadiness" in canonical, false);
  assert.equal("inputRequirements" in canonical, false);
  assert.equal("namedProfileRef" in canonical.requirements, false);
  assert.equal("locator" in canonical.steps[0], false);
});

test("assigns stable identity and semantic polarity to assertion steps", () => {
  const canonical = canonicalizeTestRailCase({
    id: 903,
    title: "Validate a rejected form",
    custom_steps_separated: [
      { content: "Fill the form" },
      { content: "Validar que se muestre la validación" },
      { content: "Validar que no permita continuar" },
    ],
    custom_expected: "The invalid form remains blocked",
  });

  assert.deepEqual(canonical.steps.map((step) => step.requirementRefs), [
    undefined,
    ["requirement:testrail:case:903:step:2:assertion"],
    ["requirement:testrail:case:903:step:3:assertion"],
  ]);
  assert.equal(canonical.requirements.find((item) => item.requirementId.endsWith("step:2:assertion"))?.polarity, "positive");
  assert.equal(canonical.requirements.find((item) => item.requirementId.endsWith("step:2:assertion"))?.polarityResolvedAt, "canonical_adapter");
  assert.equal(canonical.requirements.find((item) => item.requirementId.endsWith("step:3:assertion"))?.polarity, "negative");
  assert.equal(canonical.steps[2]?.canonicalAssertion?.polarity, "negative");
  assert.deepEqual(canonical.expectedResultRequirementRefs, []);
});

test("preserves parent boundaries and requirement lineage for composite assertion steps", () => {
  const canonical = canonicalizeTestRailCase({
    id: 904,
    title: "Validate a constrained transition",
    custom_steps_separated: [
      ...Array.from({ length: 12 }, (_, index) => ({ content: `Perform action ${index + 1}` })),
      { content: 'Al salir del campo "subject", validar que el campo quede inválido y que se muestre un mensaje asociado al dato.' },
      { content: 'Validar que, mientras el campo "subject" permanezca inválido, la acción "advance" permanezca deshabilitada y no permita continuar.' },
    ],
  });

  assert.equal(canonical.steps.length, 14);
  assert.equal(canonical.steps[12]?.canonicalAssertion?.childExpectations?.length, 2);
  assert.equal(canonical.steps[12]?.canonicalAssertion?.trigger, "leave_field");
  assert.equal(canonical.steps[13]?.canonicalAssertion?.intent, "transition_blocked");
  assert.equal(canonical.steps[13]?.canonicalAssertion?.advanceAction, "advance");
  assert.equal(canonical.requirements.length, 2);
  assert.equal(canonical.steps[12]?.requirementRefs?.length, 1);
  assert.equal(canonical.steps[13]?.requirementRefs?.length, 1);
  assert.equal(canonical.steps.filter((step) => step.canonicalAssertion).length, 2);
});
