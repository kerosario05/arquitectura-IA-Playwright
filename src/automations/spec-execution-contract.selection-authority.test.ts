import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { compileDeterministicSpec } from "./spec-compiler/deterministic-spec-compiler";
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

test("carries a parsed selection owner into the compiled runtime when recording omitted associatedField", () => {
  const description = 'Seleccionar "Synthetic option" en "Promotor"';
  const contract = buildSpecExecutionContract({
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { externalId: "synthetic-selection", title: "Selection owner transport" },
    requiredData: [],
    steps: [{
      index: 9,
      action: "click",
      description,
      target: { strategy: "visible_label_custom_selection_state_verified", value: "Synthetic option" },
    }],
    createdAt: "2026-10-29T00:00:00.000Z",
  } as any, {
    steps: [{ index: 9, action: description }],
  } as any);

  assert.equal(contract.steps[0]?.operation, "select");
  assert.equal(contract.steps[0]?.selectionField, "Promotor");
  const compiled = compileDeterministicSpec(contract, {
    targetSpecPath: path.resolve(process.cwd(), "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts"),
  });
  assert.equal(compiled.unsupportedCapabilities.length, 0);
  assert.match(compiled.source, /selectionField: 'Promotor'/);
});

test("does not infer a selection owner from a standalone option label", () => {
  const description = 'Seleccionar "Synthetic option"';
  const contract = buildSpecExecutionContract({
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { externalId: "synthetic-selection", title: "Standalone option" },
    requiredData: [],
    steps: [{
      index: 3,
      action: "click",
      description,
      target: { strategy: "visible_label_custom_selection_state_verified", value: "Synthetic option" },
    }],
    createdAt: "2026-10-29T00:00:00.000Z",
  } as any, {
    steps: [{ index: 3, action: description }],
  } as any);

  assert.equal(contract.steps[0]?.operation, "select");
  assert.equal(contract.steps[0]?.selectionField, undefined);
});

test("defers checkable-caption clicks to the shared field resolver instead of stale recorded inputs", () => {
  const caption = "Synthetic email preference";
  const description = `Presionar botón asociado a "${caption}"`;
  const staleRef = 'css:input[data-pc-section="input"]';
  const contract = buildSpecExecutionContract({
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { externalId: "synthetic-checkable", title: "Checkable caption owner" },
    requiredData: [],
    steps: [{
      index: 11,
      action: "click",
      description,
      target: { strategy: "snapshot:unique_checkable_control_in_caption_scope", value: caption },
      technicalTargetRefs: [staleRef],
      recordingActionType: "click",
    }],
    createdAt: "2026-10-29T00:00:00.000Z",
  } as any, {
    steps: [{
      index: 11,
      action: description,
      description,
      technicalTargetRef: staleRef,
      technicalTargetRefs: [staleRef],
      recordingActionType: "click",
    }],
  } as any);

  const step = contract.steps[0];
  assert.equal(step?.resolutionState, "runtime_resolution_required");
  assert.equal(step?.associatedField, caption);
  assert.equal(step?.checkableCaptionOwner, true);
  assert.equal(step?.technicalTargetRef, staleRef, "keep the stale reference as provenance on the contract");
  assert.deepEqual(step?.technicalTargetRefs, [staleRef]);

  const compiled = compileDeterministicSpec(contract, {
    targetSpecPath: path.resolve(process.cwd(), "automations/apps/synthetic-app/sections/synthetic-section/cases/synthetic-case/case.spec.ts"),
  });
  assert.equal(compiled.unsupportedCapabilities.length, 0);
  assert.match(compiled.source, /target: 'label:Synthetic email preference'/);
  assert.match(compiled.source, /associatedField: 'Synthetic email preference'/);
  assert.match(compiled.source, /checkableCaptionOwner: true/);
  assert.doesNotMatch(compiled.source, /data-pc-section/);
});

test("keeps ordinary clicks on their existing recorded technical target", () => {
  const description = 'Presionar "Synthetic continue"';
  const technicalTargetRef = "role:button|Synthetic continue";
  const contract = buildSpecExecutionContract({
    version: "1.0",
    source: "discovery_generated",
    status: "validated",
    scenario: { externalId: "synthetic-ordinary-click", title: "Ordinary click" },
    requiredData: [],
    steps: [{
      index: 3,
      action: "click",
      description,
      target: { strategy: "role", value: "button|Synthetic continue" },
      technicalTargetRefs: [technicalTargetRef],
      recordingActionType: "click",
    }],
    createdAt: "2026-10-29T00:00:00.000Z",
  } as any, {
    steps: [{ index: 3, action: description, description, technicalTargetRef, recordingActionType: "click" }],
  } as any);

  assert.notEqual(contract.steps[0]?.resolutionState, "runtime_resolution_required");
  assert.equal(contract.steps[0]?.associatedField, undefined);
  assert.equal(contract.steps[0]?.technicalTargetRef, technicalTargetRef);
});
