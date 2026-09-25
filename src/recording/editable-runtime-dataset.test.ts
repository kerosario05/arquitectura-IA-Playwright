import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRuntimeDatasetValues,
  hydrateCanonicalInteractionsFromSemanticModel,
  materializeRuntimeInputRequirements,
  toSharedMcpScenario,
  type RuntimeInputRequirement,
} from "./canonical-recording-contract";
import type { RecordedDataField, RecordedScenario } from "./trace-to-scenario";

function makeScenario(fields: RecordedDataField[]): RecordedScenario {
  const canonicalInteractions = fields.map((field, index) => ({
    id: `interaction-${index + 1}`,
    controlIdentity: field.key,
    semanticField: field.semanticField ?? field.label,
    ...(field.entityScope ? { entityScope: field.entityScope } : {}),
    action: field.key.endsWith("_seleccion") ? "select" as const : "fill" as const,
    valueKey: field.key,
    recordedValue: field.exampleValue,
    sourceEventRefs: [`event-${index + 1}`],
    technicalTargetRefs: [`css:#${field.key.replace(/[^a-z0-9]/gi, "-")}`],
    confidence: 1,
  }));
  return {
    scenarioId: "recorded-primary",
    title: "Observed runtime dataset",
    description: "Observed scenario",
    preconditions: [],
    kind: "happy_path",
    provenance: "observed",
    mobileSteps: [],
    webSteps: fields.map((field) => ({ action: field.key.endsWith("_seleccion") ? "click" : "fill", valueKey: field.key, entityScope: field.entityScope })),
    testRailSteps: fields.map((field) => ({ content: `Ingresar [${field.key}]`, stepTemplate: `Ingresar [${field.key}]`, valueKey: field.key, entityScope: field.entityScope, expected: "" })),
    requiredData: fields,
    sourceRecordingId: "recording-editable",
    hasUncertainSteps: false,
    primary: true,
    functionalReadiness: true,
    technicalReadiness: true,
    oracleAuthority: "observed_only",
    canonicalInteractions,
  };
}

function field(key: string, value: string | undefined, extra: Partial<RecordedDataField> = {}): RecordedDataField {
  return {
    key,
    label: key,
    semanticField: key,
    stepIndex: 0,
    ...(value === undefined ? {} : { exampleValue: value }),
    sensitive: false,
    valueRole: "action_input",
    source: "RECORDED_CONFIRMED",
    ...extra,
  };
}

function requirement(scenario: RecordedScenario, key: string): RuntimeInputRequirement {
  return (scenario.runtimeInputRequirements ?? materializeRuntimeInputRequirements(scenario)).find((candidate) => candidate.valueKey === key)!;
}

test("CASE 1: prefilled business input remains editable", () => {
  const result = requirement(makeScenario([field("entity_1.document", "A")]), "entity_1.document");
  assert.equal(result.value, "A");
  assert.equal(result.resolved, true);
  assert.equal(result.editable, true);
});

test("CASE 2: RECORDED_CONFIRMED does not make a business input read-only", () => {
  const result = requirement(makeScenario([field("entity_1.name", "Alice")]), "entity_1.name");
  assert.equal(result.source, "RECORDED_CONFIRMED");
  assert.equal(result.editable, true);
  assert.equal(result.readOnly, false);
});

test("CASE 3: QA modifies value and records CURRENT_QA_EDIT", () => {
  const scenario = makeScenario([field("entity_1.name", "Alice")]);
  const edited = applyRuntimeDatasetValues(scenario, { "entity_1.name": "Bob" });
  const result = requirement(edited, "entity_1.name");
  assert.equal(result.value, "Bob");
  assert.equal(result.source, "CURRENT_QA_EDIT");
  assert.equal(result.authority, "explicit_qa_edit");
  assert.equal(edited.requiredData[0].exampleValue, "Alice");
});

test("CASE 4: CURRENT_QA_EDIT reaches the execution contract by valueKey", () => {
  const scenario = makeScenario([field("entity_1.name", "Alice")]);
  const contract = toSharedMcpScenario(scenario, "portal", { "entity_1.name": "Bob" });
  assert.equal(contract.recordingExecutionContract?.datasetBindings["entity_1.name"], "Bob");
  assert.equal(contract.recordingExecutionContract?.actions.find((action) => action.valueKey === "entity_1.name")?.value, "Bob");
});

test("CASE 5: system_generated remains disabled", () => {
  const result = requirement(makeScenario([field("entity_1.id", "generated", { repeatClonePolicy: "SYSTEM_GENERATED" })]), "entity_1.id");
  assert.equal(result.systemGenerated, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.editable, false);
});

test("CASE 6: runtime_derived_oracle remains disabled", () => {
  const result = requirement(makeScenario([field("entity_1.oracle", "created", { valueRole: "runtime_derived_oracle", source: "OBSERVED" })]), "entity_1.oracle");
  assert.equal(result.valueRole, "runtime_derived_oracle");
  assert.equal(result.readOnly, true);
  assert.equal(result.editable, false);
});

test("CASE 7: sensitive business input is masked and editable", () => {
  const result = requirement(makeScenario([field("entity_1.password", "secret", { sensitive: true, valueRole: "secure_input", source: "secure" })]), "entity_1.password");
  assert.equal(result.sensitive, true);
  assert.equal(result.masked, true);
  assert.equal(result.editable, true);
  assert.equal(result.readOnly, false);
});

test("CASE 8: compound selection and amount keep separate editable valueKeys", () => {
  const scenario = makeScenario([field("entity_1.ingresos_seleccion", "DOP"), field("entity_1.ingresos_valor", "80000")]);
  const edited = applyRuntimeDatasetValues(scenario, { "entity_1.ingresos_seleccion": "USD" });
  assert.equal(edited.runtimeDataset?.resolvedValues["entity_1.ingresos_seleccion"], "USD");
  assert.equal(edited.runtimeDataset?.resolvedValues["entity_1.ingresos_valor"], "80000");
  assert.deepEqual(edited.runtimeInputRequirements?.filter((input) => input.editable).map((input) => input.valueKey), ["entity_1.ingresos_seleccion", "entity_1.ingresos_valor"]);
});

test("CASE 9: entity_2 edit preserves scope and unique constraint", () => {
  const scenario = makeScenario([field("entity_2.colaborador", "B", { entityScope: "entity_2", constraints: [{ type: "uniqueWithinCollection", uniqueWithinCollection: true }] })]);
  const edited = applyRuntimeDatasetValues(scenario, { "entity_2.colaborador": "C" });
  const result = requirement(edited, "entity_2.colaborador");
  assert.equal(result.entityScope, "entity_2");
  assert.equal(result.constraints?.[0]?.uniqueWithinCollection, true);
  assert.equal(result.editable, true);
  assert.equal(result.value, "C");
});

test("CASE 10: rehydration preserves editable state and CURRENT_QA_EDIT", () => {
  const original = makeScenario([field("entity_1.name", "Alice")]);
  const edited = applyRuntimeDatasetValues(original, { "entity_1.name": "Bob" });
  const hydrated = hydrateCanonicalInteractionsFromSemanticModel(edited, { editingSessions: [], canonicalInteractions: [] });
  const refetched = applyRuntimeDatasetValues(hydrated, {});
  const result = requirement(refetched, "entity_1.name");
  assert.equal(result.value, "Bob");
  assert.equal(result.source, "CURRENT_QA_EDIT");
  assert.equal(result.editable, true);
  assert.equal(refetched.requiredData[0].exampleValue, "Alice");
});
