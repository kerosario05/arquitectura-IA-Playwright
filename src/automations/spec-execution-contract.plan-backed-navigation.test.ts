import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";
import { findUncertifiedRequiredTargetSteps } from "./spec-generation-hybrid";

function buildPlan(steps: unknown[]) {
  return {
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { externalId: "C-test", title: "navigation" },
    requiredData: [],
    steps,
    createdAt: new Date().toISOString(),
  } as any;
}

test("keeps a plan-backed configured-app setup action as navigation without a display locator", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([
      { index: 1, action: "navigate", target: "APP_BASE_URL", description: "Open configured application" },
      { index: 2, action: "click", target: { strategy: "role", role: "button", name: "Continue" }, description: 'Presionar "Continue"' },
    ]),
    { steps: [
      { index: 1, action: "Abrir la aplicación configurada del proyecto" },
      { index: 2, action: 'Presionar "Continue"' },
    ] },
  );

  const navigation = contract.steps[0];
  assert.equal(navigation?.operation, "navigate");
  assert.deepEqual(navigation?.target, { strategy: "url", value: "APP_BASE_URL" }, "the configured base URL must remain typed navigation authority");
  assert.equal(navigation?.certifiedTechnicalTarget, undefined, "navigation does not require an interactive target identity");
  assert.equal(findUncertifiedRequiredTargetSteps(contract).length, 0);
});

test("still blocks an uncertified interactive action when no plan-backed navigation exists", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([]),
    { steps: [{ index: 1, action: 'Presionar "Continue"' }] },
  );

  assert.equal(contract.steps[0]?.operation, "click");
  assert.equal(findUncertifiedRequiredTargetSteps(contract).length, 1);
});

test("preserves a validated keyboard/typeahead option as the select execution target", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([
      {
        index: 1,
        action: "click",
        target: { strategy: "selection_keyboard_typeahead", value: "DOP" },
        description: 'Seleccionar "DOP" en "Moneda"',
      },
    ]),
    { steps: [{ index: 1, action: 'Seleccionar "DOP" en "Moneda"' }] },
  );

  assert.equal(contract.steps[0]?.operation, "select");
  assert.equal(contract.steps[0]?.resolvedExecutionTarget, "DOP");
});

test("defers an ambiguous grid editor target to the existing runtime resolver after validated execution", () => {
  const contract = buildSpecExecutionContract(
    buildPlan([
      {
        index: 1,
        action: "click",
        target: { strategy: "grid_cell_editor", value: "Tipo de ID" },
        description: 'Presionar botón asociado a "Tipo de ID"',
      },
    ]),
    { steps: [{ index: 1, action: 'Presionar botón asociado a "Tipo de ID"' }] },
  );

  assert.equal(contract.steps[0]?.resolutionState, "runtime_resolution_required");
});
