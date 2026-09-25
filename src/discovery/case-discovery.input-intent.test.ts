import assert from "node:assert/strict";
import test from "node:test";
import { isFillActionTarget, parseScenarioStepsForDiscovery, projectScenarioInputMetadata } from "./case-discovery";
import type { TestScenario } from "../types/testrail.types";

function scenario(step: Partial<TestScenario["steps"][number]> = {}): TestScenario {
  return {
    source: "testrail",
    externalId: "external",
    caseId: 1,
    title: "scenario",
    steps: [{ index: 1, action: "fill the control", dataHints: [], ...step }],
  };
}

test("propagates action input metadata and requirement refs into ordered steps", () => {
  const parsed = parseScenarioStepsForDiscovery(scenario({
    requirementRefs: ["req-a", "req-b"],
    inputIntent: { mode: "set_value" },
  }));
  assert.deepEqual(parsed.orderedSteps[0]?.requirementRefs, ["req-a", "req-b"]);
  assert.deepEqual(parsed.orderedSteps[0]?.inputIntent, { mode: "set_value" });

  const scenarioRefs = { ...scenario({ inputIntent: { mode: "preserve_state" } }), stepRequirementRefs: [
    { stepIndex: 1, requirementId: "req-c" },
    { stepIndex: 1, requirementId: "req-d" },
  ] } as TestScenario & { stepRequirementRefs: Array<{ stepIndex: number; requirementId: string }> };
  const parsedScenarioRefs = parseScenarioStepsForDiscovery(scenarioRefs);
  assert.deepEqual(parsedScenarioRefs.orderedSteps[0]?.requirementRefs, ["req-c", "req-d"]);
  assert.deepEqual(parsedScenarioRefs.orderedSteps[0]?.inputIntent, { mode: "preserve_state" });
});

test("preserves every structured input intent and does not infer from target text", () => {
  for (const mode of ["leave_unset", "invalid_value", "preserve_state", "set_value"] as const) {
    const parsed = parseScenarioStepsForDiscovery(scenario({ inputIntent: { mode } }));
    assert.deepEqual(parsed.orderedSteps[0]?.inputIntent, { mode });
  }
  const parsed = parseScenarioStepsForDiscovery(scenario({ action: "leave the email empty" }));
  assert.equal(parsed.orderedSteps[0]?.inputIntent, undefined);
});

test("projects plan metadata without turning it into values or derived text", () => {
  assert.deepEqual(projectScenarioInputMetadata({
    requirementRefs: ["req-a", "req-b"],
    inputIntent: { mode: "leave_unset", requirementRefs: ["req-a"] },
  }), {
    requirementRefs: ["req-a", "req-b"],
    inputIntent: { mode: "leave_unset", requirementRefs: ["req-a"] },
  });
  assert.deepEqual(projectScenarioInputMetadata({ inputIntent: { mode: "preserve_state", requirementRefs: ["req-nested"] } }), {
    inputIntent: { mode: "preserve_state", requirementRefs: ["req-nested"] },
    requirementRefs: ["req-nested"],
  });
  const planStep = {
    index: 1,
    action: "fill" as const,
    target: { strategy: "label" as const, value: "control" },
    ...projectScenarioInputMetadata({ inputIntent: { mode: "invalid_value" }, requirementRefs: ["req-c"] }),
  };
  assert.deepEqual(planStep.inputIntent, { mode: "invalid_value" });
  assert.deepEqual(planStep.requirementRefs, ["req-c"]);
  assert.equal("value" in planStep && typeof planStep.value === "string", false);
});

test("preserves namespaced placeholder fill metadata through discovery projection", () => {
  const parsed = parseScenarioStepsForDiscovery({
    ...scenario(),
    steps: [
      { index: 1, action: 'Ingresar el valor [auth.company_identifier] en el campo "RNC de la empresa".', dataHints: [] },
      { index: 2, action: 'Ingresar el valor [auth.username] en el campo "Nombre de usuario".', dataHints: [] },
      { index: 3, action: 'Ingresar el valor [auth.password] en el campo "Contraseña".', dataHints: [] },
    ],
  });

  assert.deepEqual(parsed.actionTargets.map((item) => ({
    actionType: item.actionType,
    target: item.target,
    valueKey: item.valueKey,
    valueSource: item.valueSource,
  })), [
    { actionType: "action_fill", target: "RNC de la empresa", valueKey: "auth.company_identifier", valueSource: "unknown" },
    { actionType: "action_fill", target: "Nombre de usuario", valueKey: "auth.username", valueSource: "unknown" },
    { actionType: "action_fill", target: "Contraseña", valueKey: "auth.password", valueSource: "unknown" },
  ]);
});

test("selects fill dispatch for unknown placeholder source without forcing runtime override", () => {
  assert.equal(isFillActionTarget({ actionType: "action_fill", valueKey: "namespace.key", valueSource: "unknown" }), true);
  assert.equal(isFillActionTarget({ actionType: "action_click", valueKey: "namespace.key", valueSource: "unknown" }), false);
});

test("recording replay consumes structured action authority instead of rendered human text", () => {
  const parsed = parseScenarioStepsForDiscovery({
    ...scenario({ action: 'Ingresar "123456" en "Campo"' }),
    recordingExecutionContract: {
      actions: [{
        actionType: "fill",
        humanStep: 'Ingresar "123456" en "Campo"',
        semanticField: "Campo",
        targetRef: "field-a",
        technicalTargetRef: "css:#field-a",
        technicalTargetRefs: ["css:#field-a"],
        technicalTargetCandidates: [{
          strategy: "css",
          value: "#field-a",
          source: "recorded_dom",
          confidence: 0.99,
        }],
        valueKey: "input.a",
        valueRole: "action_input",
        runtimeValueSource: "dataset",
        stepIndex: 0,
      }],
      runtimeInputRequirements: [{
        valueKey: "input.a",
        value: "123456",
        source: "RECORDED_CONFIRMED",
        sensitive: false,
        valueRole: "action_input",
      }],
      datasetBindings: { "input.a": "123456" },
    },
  });

  assert.equal(parsed.actionTargets.length, 1);
  assert.equal(parsed.actionTargets[0]?.target, "Campo");
  assert.equal(parsed.actionTargets[0]?.valueKey, "input.a");
  assert.equal(parsed.actionTargets[0]?.valueSource, "test_data");
  assert.equal(parsed.orderedSteps[0]?.target, "Campo");
  assert.equal(parsed.orderedSteps[0]?.valueKey, "input.a");
  assert.equal(parsed.orderedSteps[0]?.technicalTargetCandidates?.[0]?.value, "#field-a");
});

/**
 * FIRST_LOSS: `parseScenarioStepsForDiscovery`'s recording-action tagging ternary had no branch
 * for `"press"` -- it fell through to the same default used for a real click ("action_click"),
 * so a recorded keyboard press (Enter/Escape/...) silently became a click intent for Recording
 * Replay, with its `key` dropped entirely. Fixed with its own `"action_press"` tag and a
 * dedicated `key` field, carried through both `actionTargets` and `orderedSteps`, never
 * conflated with a fill/select `value`/`valueKey`.
 */
test("recording replay never converts a press action into a click -- its own action_press tag, key preserved", () => {
  const parsed = parseScenarioStepsForDiscovery({
    ...scenario(),
    recordingExecutionContract: {
      actions: [{
        actionType: "press",
        key: "Enter",
        humanStep: undefined,
        targetRef: "password-field",
        technicalTargetRef: "css:#password",
        technicalTargetRefs: ["css:#password"],
        stepIndex: 1,
      }],
      runtimeInputRequirements: [],
    },
  });

  assert.equal(parsed.actionTargets.length, 1);
  assert.equal(parsed.actionTargets[0]?.actionType, "action_press");
  assert.equal(parsed.actionTargets[0]?.recordingActionType, "press");
  assert.equal(parsed.actionTargets[0]?.key, "Enter");
  assert.notEqual(parsed.actionTargets[0]?.actionType, "action_click");

  assert.equal(parsed.orderedSteps[0]?.type, "action_press");
  assert.equal(parsed.orderedSteps[0]?.recordingActionType, "press");
  assert.equal(parsed.orderedSteps[0]?.key, "Enter");
});

test("recording replay: fill/click/select order and tagging are unaffected by press support", () => {
  const parsed = parseScenarioStepsForDiscovery({
    ...scenario(),
    recordingExecutionContract: {
      actions: [
        { actionType: "fill", humanStep: "Ingresar", targetRef: "Usuario", valueKey: "username", stepIndex: 1 },
        { actionType: "fill", humanStep: "Ingresar", targetRef: "Contraseña", valueKey: "password", stepIndex: 2 },
        { actionType: "press", key: "Enter", targetRef: "Contraseña", stepIndex: 3 },
      ],
      runtimeInputRequirements: [],
    },
  });
  assert.deepEqual(parsed.actionTargets.map((item) => item.actionType), ["action_fill", "action_fill", "action_press"]);
  assert.deepEqual(parsed.actionTargets.map((item) => item.recordingActionType), ["fill", "fill", "press"]);
});

test("recording replay: an ordinary click is never mistagged as press, and vice versa (no app/value hardcode)", () => {
  const parsed = parseScenarioStepsForDiscovery({
    ...scenario(),
    recordingExecutionContract: {
      actions: [
        { actionType: "click", humanStep: "Presionar", targetRef: "Cualquier Botón", stepIndex: 1 },
        { actionType: "press", key: "Escape", targetRef: "Cualquier Campo", stepIndex: 2 },
      ],
      runtimeInputRequirements: [],
    },
  });
  assert.deepEqual(parsed.actionTargets.map((item) => item.actionType), ["action_click", "action_press"]);
  assert.equal(parsed.actionTargets[0]?.key, undefined);
  assert.equal(parsed.actionTargets[1]?.key, "Escape");
});

test("recording replay repairs legacy duplicate indices without dropping compound actions", () => {
  const parsed = parseScenarioStepsForDiscovery({
    ...scenario(),
    recordingExecutionContract: {
      actions: [
        { actionType: "select", humanStep: "Seleccionar", targetRef: "Ingresos", valueKey: "currency", stepIndex: 8 },
        { actionType: "fill", humanStep: "Ingresar", targetRef: "Ingresos", valueKey: "amount", stepIndex: 8 },
        { actionType: "check", humanStep: "Marcar", targetRef: "row", valueKey: "row.selected", stepIndex: 9 },
      ],
      runtimeInputRequirements: [],
    },
  });
  assert.deepEqual(parsed.actionTargets.map((item) => item.index), [1, 2, 3]);
  assert.deepEqual(parsed.actionTargets.map((item) => item.recordingActionType), ["select", "fill", "check"]);
  assert.equal(parsed.actionTargets.length, 3);
});

test("recording replay preserves the semantic field as the selection authority", () => {
  const parsed = parseScenarioStepsForDiscovery({
    ...scenario(),
    recordingExecutionContract: {
      actions: [{
        actionType: "select",
        humanStep: 'Seleccionar "cédula" en "Tipo de ID"',
        semanticField: "Tipo de ID",
        targetRef: "cell:Tipo de ID",
        valueKey: "entity_1.tipo_de_id_seleccion",
        runtimeValueSource: "dataset",
        stepIndex: 1,
      }],
      runtimeInputRequirements: [],
    },
  });

  assert.equal(parsed.actionTargets[0]?.selectionField, "Tipo de ID");
  assert.equal(parsed.orderedSteps[0]?.selectionField, "Tipo de ID");
});
