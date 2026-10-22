import assert from "node:assert/strict";
import test from "node:test";
import { buildSpecExecutionContract } from "./spec-execution-contract";

test("carries an observed custom-list option into select authority by unique field lineage", () => {
  const selectionDescription = 'Seleccionar "Cuenta Corriente" en el campo "Cuenta de origen"';
  const planSelection = {
    index: 12,
    action: "click",
    description: 'Seleccionar la cuenta de origen en "Cuenta de origen".',
    target: { strategy: "visible_label_custom_selection_state_verified", value: "Cuenta Corriente" },
  };
  const contract = buildSpecExecutionContract({
    scenario: { externalId: "C908", title: "Transfer selection" },
    steps: [planSelection],
  } as any, {
    steps: [{ index: 14, action: selectionDescription, selectionField: "Cuenta de origen" }],
  } as any);

  assert.equal(contract.steps[0]?.operation, "select");
  assert.equal(contract.steps[0]?.resolvedExecutionTarget, "Cuenta Corriente");

  const ambiguous = buildSpecExecutionContract({
    scenario: { externalId: "C909", title: "Ambiguous transfer selection" },
    steps: [
      planSelection,
      { ...planSelection, index: 13, target: { strategy: "visible_label_custom_selection_state_verified", value: "Cuenta de Ahorros" } },
    ],
  } as any, {
    steps: [{ index: 14, action: selectionDescription, selectionField: "Cuenta de origen" }],
  } as any);
  assert.equal(ambiguous.steps[0]?.resolvedExecutionTarget, undefined);
});
