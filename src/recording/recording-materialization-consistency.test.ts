import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { toVirtualCase } from "../types/scenario-preview.types";
import { loadScenarios, loadTrace } from "./recording-store";
import { buildSemanticRecordingModel } from "./semantic-recording";
import {
  applyRuntimeDatasetValues,
  hydrateCanonicalInteractionsFromSemanticModel,
  toSharedMcpScenario,
} from "./canonical-recording-contract";

const recordingId = "f40e3007-7b94-4b92-9c6c-33b2bc573f0b";
const scenarioId = "REC-F40E3007-01";
const appSlug = "portalempresarial";

function materializedPrimary() {
  const trace = loadTrace(appSlug, recordingId);
  if (!trace) throw new Error(`Missing persisted trace ${recordingId}`);
  const scenario = loadScenarios(appSlug, recordingId).find((candidate) => candidate.scenarioId === scenarioId);
  assert.ok(scenario, `Missing persisted scenario ${scenarioId}`);
  const semanticModel = buildSemanticRecordingModel(trace);
  return applyRuntimeDatasetValues(
    hydrateCanonicalInteractionsFromSemanticModel(scenario, semanticModel),
    {},
  );
}

test("recording materialization keeps compound selection and amount authority separate", () => {
  const persisted = loadScenarios(appSlug, recordingId).find((scenario) => scenario.scenarioId === scenarioId);
  assert.ok(persisted);
  assert.equal(persisted.requiredData.find((field) => field.key === "entity_1.ingresos_valor")?.exampleValue, "15000");

  const materialized = materializedPrimary();
  const amountKey = "entity_1.ingresos_valor";
  assert.equal(materialized.requiredData.find((field) => field.key === amountKey)?.exampleValue, "15000");
  assert.equal(materialized.runtimeDataset?.resolvedValues[amountKey], "15000");
  assert.equal(materialized.testRailSteps.find((step) => step.valueKey === amountKey)?.renderedStep, "Ingresar \"15000\" en \"Ingresos\"");
  assert.equal(materialized.testRailSteps.find((step) => step.valueKey === "entity_1.ingresos_seleccion")?.renderedStep, "Seleccionar \"DOP\" en \"Ingresos\"");

  const contract = toSharedMcpScenario(materialized, appSlug);
  const amountAction = contract.recordingExecutionContract?.actions.find((action) => action.valueKey === amountKey);
  const selectionAction = contract.recordingExecutionContract?.actions.find((action) => action.valueKey === "entity_1.ingresos_seleccion");
  assert.equal(amountAction?.value, "15000");
  assert.equal(selectionAction?.value, "DOP");
  assert.equal(contract.runtimeInputRequirements.find((requirement) => requirement.valueKey === amountKey)?.value, "15000");
  assert.equal(contract.steps.find((step) => step.includes("Ingresos" ) && step.startsWith("Ingresar")), "Ingresar \"15000\" en \"Ingresos\"");
});

test("preview and generated-case artifacts are materialized from the corrected contract", () => {
  const contract = toSharedMcpScenario(materializedPrimary(), appSlug);
  const virtualCase = toVirtualCase(contract, 0);
  const amountStep = "Ingresar \"15000\" en \"Ingresos\"";
  assert.ok(virtualCase.steps.includes(amountStep));
  assert.equal(virtualCase.recordingExecutionContract?.actions.find((action) => action.valueKey === "entity_1.ingresos_valor")?.value, "15000");

  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "recording-materialization-"));
  try {
    fs.mkdirSync(path.join(artifactDir, "generated-cases"));
    fs.writeFileSync(path.join(artifactDir, "preview-scenarios.json"), JSON.stringify([virtualCase], null, 2));
    fs.writeFileSync(path.join(artifactDir, "generated-cases", `${virtualCase.id}.json`), JSON.stringify(virtualCase, null, 2));

    const preview = JSON.parse(fs.readFileSync(path.join(artifactDir, "preview-scenarios.json"), "utf8"))[0];
    const generatedCase = JSON.parse(fs.readFileSync(path.join(artifactDir, "generated-cases", `${virtualCase.id}.json`), "utf8"));
    assert.ok(preview.steps.includes(amountStep));
    assert.ok(generatedCase.steps.includes(amountStep));
    assert.equal(preview.recordingExecutionContract.actions.find((action: { valueKey?: string }) => action.valueKey === "entity_1.ingresos_valor").value, "15000");
    assert.equal(generatedCase.recordingExecutionContract.actions.find((action: { valueKey?: string }) => action.valueKey === "entity_1.ingresos_valor").value, "15000");
  } finally {
    fs.rmSync(artifactDir, { recursive: true, force: true });
  }
});

test("structured extras are technical prerequisites, not unauthorized functional actions", () => {
  const persisted = loadScenarios(appSlug, recordingId).find((scenario) => scenario.scenarioId === scenarioId);
  assert.ok(persisted);
  const humanInteractionIds = new Set(persisted.testRailSteps.map((step) => step.interactionId).filter(Boolean));
  const contract = toSharedMcpScenario(materializedPrimary(), appSlug);
  const actions = contract.recordingExecutionContract?.actions ?? [];
  const extraActions = actions.filter((action) => !humanInteractionIds.has(action.interactionId));

  assert.equal(persisted.testRailSteps.length, 18);
  assert.equal(actions.length, 22);
  assert.deepEqual(extraActions.map((action) => action.interactionId), [
    "interaction-68",
    "interaction-75",
    "interaction-78",
    "interaction-93",
    "interaction-146",
  ]);
  assert.equal(extraActions.length, 5);
  assert.equal(extraActions.filter((action) => action.actionType === "check" || action.actionType === "click" || action.actionType === "select").length, 5);
  assert.equal(extraActions.filter((action) => action.actionType === "fill").length, 0);
  assert.equal(extraActions.filter((action) => action.actionType === "select").length, 1);
});
