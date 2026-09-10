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
