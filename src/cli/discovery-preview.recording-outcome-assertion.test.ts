import assert from "node:assert/strict";
import test from "node:test";
import { buildRecordingOutcomeAssertionStep, virtualCaseToTestScenario } from "./discovery-preview";
import { parseScenarioStepsForDiscovery } from "../discovery/case-discovery";

/**
 * Run c47711b8 (recording d4a2af4d, "roque 10"): all 23 recorded actions passed, but the expected
 * result "Se muestra \"¡Hola!\"" was never checked live -- contract replay carried actions only --
 * so the promotion gate failed the run as an unbacked oracle.
 */

test("a quoted visible-text expected result becomes one final assertion step", () => {
  const step = buildRecordingOutcomeAssertionStep('Se muestra "¡Hola!"', 24);
  assert.deepEqual(step, { index: 24, action: 'Se muestra "¡Hola!"', description: 'Se muestra "¡Hola!"', expected: "", dataHints: [], polarity: "positive", recordingOutcomeAssertion: true });
});

test("prose or multi-line expected results are never turned into assertions", () => {
  assert.equal(buildRecordingOutcomeAssertionStep(undefined, 5), undefined);
  assert.equal(buildRecordingOutcomeAssertionStep("   ", 5), undefined);
  assert.equal(buildRecordingOutcomeAssertionStep('Se muestra "A"\nSe muestra "B"', 5), undefined);
});

function recordingCase(expectedResult: string) {
  const action = (stepIndex: number, semanticField: string) => ({
    stepIndex,
    actionType: "click",
    semanticField,
    interactionId: `interaction-${stepIndex}`,
    humanStep: `Presionar "${semanticField}"`,
    technicalTargetRef: `role:button|${semanticField}`,
  });
  return {
    id: "PREVIEW-001",
    displayId: "PREVIEW-001",
    title: "roque 10",
    steps: ['Presionar "Explora nuestros productos"', 'Presionar "Finalizar sesión"', 'El sistema muestra "¡Hola!"'],
    expectedResult,
    preconditions: [],
    recordingExecutionContract: { actions: [action(1, "Explora nuestros productos"), action(2, "Finalizar sesión")] },
  } as any;
}

test("replay scenario: contract actions first, then the outcome assertion, which discovery parses as an assertion", () => {
  const scenario = virtualCaseToTestScenario(recordingCase('Se muestra "¡Hola!"'));
  assert.deepEqual(scenario.steps.map((step) => [step.index, step.action]), [
    [1, 'Presionar "Explora nuestros productos"'],
    [2, 'Presionar "Finalizar sesión"'],
    [3, 'Se muestra "¡Hola!"'],
  ]);

  const parsed = parseScenarioStepsForDiscovery(scenario);
  assert.deepEqual(parsed.actionTargets.map((target) => target.index), [1, 2], "the contract still owns every action");
  assert.deepEqual(parsed.assertionTargets.map((target) => [target.index, target.target]), [[3, "¡Hola!"]]);
  const lastOrdered = parsed.orderedSteps.at(-1);
  assert.equal(lastOrdered?.type, "assertion");
  assert.equal(lastOrdered?.stepIndex, 3);
});

test("replay scenario without an observable expected result is unchanged", () => {
  const scenario = virtualCaseToTestScenario(recordingCase("El flujo termina correctamente"));
  assert.equal(scenario.steps.length, 2);
  assert.deepEqual(parseScenarioStepsForDiscovery(scenario).assertionTargets, []);
});
