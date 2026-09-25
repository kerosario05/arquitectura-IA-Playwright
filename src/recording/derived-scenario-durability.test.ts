import assert from "node:assert/strict";
import test from "node:test";
import { toVirtualCase } from "../types/scenario-preview.types";
import { loadScenarios, loadSemanticRecording } from "./recording-store";
import {
  evaluateRecordingReadiness,
  materializeScenarioMutation,
  toSharedMcpScenario,
  type ScenarioMutationProposal,
} from "./canonical-recording-contract";
import { hydratePersistedScenarios } from "./persisted-scenario-hydration";

const appSlug = "portalempresarial";
const recordingId = "f6f29217-b81c-4f5d-8067-0e399f726d5b";

test("persisted derived catalog survives a fresh store read with stable IDs", () => {
  const firstRead = loadScenarios(appSlug, recordingId);
  const restartedRead = loadScenarios(appSlug, recordingId);
  const firstIds = firstRead.map((scenario) => scenario.scenarioId);
  const restartedIds = restartedRead.map((scenario) => scenario.scenarioId);

  assert.equal(firstRead.length, 4);
  assert.equal(restartedRead.length, 4);
  assert.deepEqual(restartedIds, firstIds);
  assert.equal(new Set(restartedIds).size, restartedIds.length);
});

test("persisted scenario hydration keeps all suggestions and repairs their runtime projection", () => {
  const persisted = loadScenarios(appSlug, recordingId);
  const hydrated = hydratePersistedScenarios(persisted, loadSemanticRecording(appSlug, recordingId));
  const ids = hydrated.map((scenario) => scenario.scenarioId);
  const alternative = hydrated.find((scenario) => scenario.mutation?.mutationType === "ALTERNATIVE_SELECTION");
  const selection = alternative?.canonicalInteractions?.find((interaction) => interaction.action === "select" && interaction.recordedValue === "USD");
  const requirement = alternative?.runtimeInputRequirements?.find((input) => input.valueKey === selection?.valueKey);
  const step = alternative?.testRailSteps.find((candidate) => candidate.interactionId === selection?.id);

  assert.equal(hydrated.length, 4);
  assert.deepEqual(ids, persisted.map((scenario) => scenario.scenarioId));
  assert.equal(selection?.recordedValue, "USD");
  assert.equal(requirement?.value, "DOP");
  assert.equal(step?.renderedStep, 'Seleccionar "DOP" en "Ingresos"');
});

test("persisted scenario hydration is idempotent and does not duplicate canonical actions", () => {
  const persisted = loadScenarios(appSlug, recordingId);
  const semanticModel = loadSemanticRecording(appSlug, recordingId);
  const hydrated = hydratePersistedScenarios(persisted, semanticModel);
  const rehydrated = hydratePersistedScenarios(hydrated, semanticModel);

  assert.deepEqual(rehydrated.map((scenario) => scenario.scenarioId), persisted.map((scenario) => scenario.scenarioId));
  for (const scenario of rehydrated) {
    const interactionIds = (scenario.canonicalInteractions ?? []).map((interaction) => interaction.id);
    assert.equal(new Set(interactionIds).size, interactionIds.length);
  }
});

test("a navigational scenario with no runtime inputs remains execution-ready", () => {
  const readiness = evaluateRecordingReadiness({
    functionalReadiness: true,
    technicalReadiness: true,
    oracleReadiness: true,
    runtimeInputRequirements: [],
  });

  assert.equal(readiness.dataReadiness, true);
  assert.equal(readiness.executionReadiness, true);
});

test("alternative mutation changes canonical dataset and no-effect intent is rejected", () => {
  const primary = loadScenarios(appSlug, recordingId).find((scenario) => scenario.primary);
  assert.ok(primary);
  const selection = primary.canonicalInteractions?.find((interaction) => interaction.action === "select" && interaction.observedOptions?.includes("USD"));
  assert.ok(selection?.valueKey);

  const effectiveMutation: ScenarioMutationProposal = {
    title: "Registrar usando USD",
    mutationType: "ALTERNATIVE_SELECTION",
    basePrimaryScenarioId: primary.scenarioId,
    operations: [{ type: "replace_selection", interactionId: selection.id, value: "USD" }],
    evidenceRefs: [],
    rationale: "Opción alternativa observada en la misma superficie.",
    oracleAuthority: "MISSING",
    confidence: 1,
    needsReview: true,
  };
  const effective = materializeScenarioMutation(primary, effectiveMutation);
  const effectiveRequirement = effective.runtimeInputRequirements?.find((input) => input.valueKey === selection.valueKey);
  const effectiveStep = effective.testRailSteps.find((step) => step.interactionId === selection.id);
  assert.equal(effective.canonicalInteractions?.find((interaction) => interaction.id === selection.id)?.recordedValue, "USD");
  assert.equal(effectiveRequirement?.value, "USD");
  assert.equal(effectiveStep?.renderedStep, 'Seleccionar "USD" en "Ingresos"');
  assert.equal(effective.mutationDiagnostics?.rejectionReason, undefined);
  assert.equal(effective.replayEligible, true);
  const preview = toVirtualCase(toSharedMcpScenario(effective, appSlug), 0);
  assert.ok(preview.steps.includes('Seleccionar "USD" en "Ingresos"'));
  assert.equal(preview.recordingExecutionContract?.actions.find((action) => action.valueKey === selection.valueKey)?.value, "USD");

  const noEffect = materializeScenarioMutation(primary, {
    ...effectiveMutation,
    title: "Registrar usando una opción distinta",
    operations: [{ type: "replace_selection", interactionId: selection.id, value: selection.recordedValue ?? "" }],
  });
  assert.equal(noEffect.mutationDiagnostics?.rejectionReason, "MUTATION_NO_EFFECT");
  assert.equal(noEffect.title, primary.title);
  assert.equal(noEffect.replayEligible, false);
  assert.equal(toSharedMcpScenario(noEffect, appSlug).mcpExecutable, false);
});
