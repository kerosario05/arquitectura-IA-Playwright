import assert from "node:assert/strict";
import test from "node:test";
import { parseScenarioStepsForDiscovery } from "./case-discovery";
import type { TestScenario } from "../types/testrail.types";

/**
 * FIRST_LOSS (jobId 4e55bced-f9d1-4814-b244-8ed481496152): a correct earlier fix made a transient
 * dropdown option's `associatedField` become the OWNER field (`reconcileOptionOwnerLineage`,
 * canonical-recording-contract.ts). That exposed a LATENT, pre-existing bug here:
 * `parseScenarioStepsForDiscovery` built each action's runtime `target` by prioritizing
 * `semanticField` first -- which only "worked" for a transient option because `semanticField` used
 * to (wrongly) equal the option's own display value. Once `semanticField` correctly became the
 * OWNER's name, `target` silently became the owner's name too, even though a real, more precise
 * technical identity (`technicalTargetRef`, e.g. `role:option|Cuentas de Efectivo`) already existed
 * for the option. Fixed by extracting the option's own accessible name from a role-strategy
 * `technicalTargetRef` (existing structured identity, never re-derived from text/position) and
 * preferring it over `semanticField` for `target`, while `associatedField` still correctly carries
 * the owner untouched.
 */

function scenarioWithRecordingActions(actions: Array<Record<string, unknown>>): TestScenario {
  return {
    source: "testrail",
    externalId: "external",
    caseId: 1,
    title: "scenario",
    steps: [{ index: 1, action: "placeholder", dataHints: [] }],
    recordingExecutionContract: {
      actions,
      runtimeInputRequirements: [],
    },
  } as unknown as TestScenario;
}

function ownerAction(field: string, stepIndex: number) {
  return { actionType: "click", humanStep: `Presionar "${field}"`, semanticField: field, associatedField: field, targetRef: `s1|${field}`, stepIndex };
}

function optionAction(field: string, optionName: string, stepIndex: number) {
  return {
    actionType: "click",
    humanStep: `Presionar "${optionName}"`,
    semanticField: field,
    associatedField: field,
    targetRef: `s1|${optionName}|role|option|${optionName}`,
    technicalTargetRef: `role:option|${optionName}`,
    technicalTargetRefs: [`role:option|${optionName}`, `css:#opt`],
    stepIndex,
  };
}

test("1/ownerAndOptionSeparated. owner.target=owner, owner.associatedField=owner; option.target=option, option.associatedField=owner", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    ownerAction("Categoría de producto", 1),
    optionAction("Categoría de producto", "Cuentas de Efectivo", 2),
  ]));
  const owner = parsed.actionTargets.find((a) => a.recordedControlIdentity === undefined && a.target === "Categoría de producto");
  const option = parsed.actionTargets[1];
  assert.equal(parsed.actionTargets[0].target, "Categoría de producto");
  assert.equal(parsed.actionTargets[0].associatedField, "Categoría de producto");
  assert.equal(option.target, "Cuentas de Efectivo", "target must be the OPTION's own identity, never the owner's");
  assert.equal(option.associatedField, "Categoría de producto", "associatedField must still be the owner");
  assert.notEqual(option.target, option.associatedField);
});

test("2/twoSelectionsNoCrossContamination. A→X, B→Y: neither option's target becomes the other selection's owner", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    ownerAction("Categoría de producto", 1),
    optionAction("Categoría de producto", "Cuentas de Efectivo", 2),
    ownerAction("Producto", 3),
    optionAction("Producto", "201 - Cuentas de Ahorros", 4),
  ]));
  const targets = parsed.actionTargets.map((a) => a.target);
  assert.deepEqual(targets, ["Categoría de producto", "Cuentas de Efectivo", "Producto", "201 - Cuentas de Ahorros"]);
});

test("3/recordedRefStillPointsAtOption. technicalTargetRefs/technicalTargetRef on the ActionTargetItem are untouched", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    ownerAction("Categoría de producto", 1),
    optionAction("Categoría de producto", "Cuentas de Efectivo", 2),
  ]));
  const option = parsed.actionTargets[1];
  assert.deepEqual(option.technicalTargetRefs, ["role:option|Cuentas de Efectivo", "css:#opt"]);
});

test("4/nonRoleTechnicalRefFallsBackToSemanticField. an action whose technicalTargetRef is not role-shaped (e.g. css) still uses semanticField, unaffected", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    { actionType: "click", semanticField: "Depurar", associatedField: "Depurar", technicalTargetRef: "css:#depurar-btn", technicalTargetRefs: ["css:#depurar-btn"], stepIndex: 1 },
  ]));
  assert.equal(parsed.actionTargets[0].target, "Depurar");
});

test("5/roleTargetMatchesOwnFieldRegression. a plain (non-selection) role-technical-target action whose name already equals its own semanticField is unaffected (e.g. \"Depurar\" button)", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    { actionType: "click", semanticField: "Depurar", associatedField: undefined, technicalTargetRef: "role:button|Depurar", technicalTargetRefs: ["role:button|Depurar"], stepIndex: 1 },
  ]));
  assert.equal(parsed.actionTargets[0].target, "Depurar");
});

test("6/fillActionUnaffected. a plain fill (no technicalTargetRef) keeps using semanticField for target exactly as before", () => {
  const parsed = parseScenarioStepsForDiscovery(scenarioWithRecordingActions([
    { actionType: "fill", semanticField: "Usuario", associatedField: "Usuario", targetRef: "Usuario", valueKey: "usuario", stepIndex: 1 },
  ]));
  assert.equal(parsed.actionTargets[0].target, "Usuario");
});
