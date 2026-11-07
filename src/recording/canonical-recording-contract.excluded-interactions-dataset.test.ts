import assert from "node:assert/strict";
import test from "node:test";
import { materializeRuntimeInputRequirements } from "./canonical-recording-contract";

const select = (id: string, recordedValue: string) => ({
  id,
  action: "select",
  valueKey: "entity_1.seleccione_una_opcion_seleccion",
  semanticField: "Seleccione una opción",
  entityScope: "entity_1",
  recordedValue,
  sourceEventRefs: [`event-${id}`],
  technicalTargetRefs: [],
});

const scenario = (excludedInteractionIds: string[]) => ({
  requiredData: [{
    key: "entity_1.seleccione_una_opcion_seleccion",
    label: "Seleccione una opción",
    semanticField: "Seleccione una opción",
    entityScope: "entity_1",
    stepIndex: 1,
    technicalTargetRefs: [],
    sourceEventRefs: [],
  }],
  canonicalInteractions: [select("interaction-170", "Construcción"), select("interaction-152", "PRÉSTAMOS PERSONALES NUEVOS")],
  excludedInteractionIds,
} as never);

test("a deleted (excluded) step never supplies the shared dataset value of its field", () => {
  const [kept] = materializeRuntimeInputRequirements(scenario([]));
  assert.equal(kept.value, "Construcción");
  const [requirement] = materializeRuntimeInputRequirements(scenario(["interaction-170"]));
  assert.equal(requirement.value, "PRÉSTAMOS PERSONALES NUEVOS");
});
