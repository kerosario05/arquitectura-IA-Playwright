"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const canonical_recording_contract_1 = require("./canonical-recording-contract");
function makeScenario(fields) {
    const canonicalInteractions = fields.map((field, index) => ({
        id: `interaction-${index + 1}`,
        controlIdentity: field.key,
        semanticField: field.semanticField ?? field.label,
        ...(field.entityScope ? { entityScope: field.entityScope } : {}),
        action: field.key.endsWith("_seleccion") ? "select" : "fill",
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
function field(key, value, extra = {}) {
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
function requirement(scenario, key) {
    return (scenario.runtimeInputRequirements ?? (0, canonical_recording_contract_1.materializeRuntimeInputRequirements)(scenario)).find((candidate) => candidate.valueKey === key);
}
(0, node_test_1.default)("CASE 1: prefilled business input remains editable", () => {
    const result = requirement(makeScenario([field("entity_1.document", "A")]), "entity_1.document");
    strict_1.default.equal(result.value, "A");
    strict_1.default.equal(result.resolved, true);
    strict_1.default.equal(result.editable, true);
});
(0, node_test_1.default)("CASE 2: RECORDED_CONFIRMED does not make a business input read-only", () => {
    const result = requirement(makeScenario([field("entity_1.name", "Alice")]), "entity_1.name");
    strict_1.default.equal(result.source, "RECORDED_CONFIRMED");
    strict_1.default.equal(result.editable, true);
    strict_1.default.equal(result.readOnly, false);
});
(0, node_test_1.default)("CASE 3: QA modifies value and records CURRENT_QA_EDIT", () => {
    const scenario = makeScenario([field("entity_1.name", "Alice")]);
    const edited = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(scenario, { "entity_1.name": "Bob" });
    const result = requirement(edited, "entity_1.name");
    strict_1.default.equal(result.value, "Bob");
    strict_1.default.equal(result.source, "CURRENT_QA_EDIT");
    strict_1.default.equal(result.authority, "explicit_qa_edit");
    strict_1.default.equal(edited.requiredData[0].exampleValue, "Alice");
});
(0, node_test_1.default)("CASE 4: CURRENT_QA_EDIT reaches the execution contract by valueKey", () => {
    const scenario = makeScenario([field("entity_1.name", "Alice")]);
    const contract = (0, canonical_recording_contract_1.toSharedMcpScenario)(scenario, "portal", { "entity_1.name": "Bob" });
    strict_1.default.equal(contract.recordingExecutionContract?.datasetBindings["entity_1.name"], "Bob");
    strict_1.default.equal(contract.recordingExecutionContract?.actions.find((action) => action.valueKey === "entity_1.name")?.value, "Bob");
});
(0, node_test_1.default)("CASE 5: system_generated remains disabled", () => {
    const result = requirement(makeScenario([field("entity_1.id", "generated", { repeatClonePolicy: "SYSTEM_GENERATED" })]), "entity_1.id");
    strict_1.default.equal(result.systemGenerated, true);
    strict_1.default.equal(result.readOnly, true);
    strict_1.default.equal(result.editable, false);
});
(0, node_test_1.default)("CASE 6: runtime_derived_oracle remains disabled", () => {
    const result = requirement(makeScenario([field("entity_1.oracle", "created", { valueRole: "runtime_derived_oracle", source: "OBSERVED" })]), "entity_1.oracle");
    strict_1.default.equal(result.valueRole, "runtime_derived_oracle");
    strict_1.default.equal(result.readOnly, true);
    strict_1.default.equal(result.editable, false);
});
(0, node_test_1.default)("CASE 7: sensitive business input is masked and editable", () => {
    const result = requirement(makeScenario([field("entity_1.password", "secret", { sensitive: true, valueRole: "secure_input", source: "secure" })]), "entity_1.password");
    strict_1.default.equal(result.sensitive, true);
    strict_1.default.equal(result.masked, true);
    strict_1.default.equal(result.editable, true);
    strict_1.default.equal(result.readOnly, false);
});
(0, node_test_1.default)("CASE 8: compound selection and amount keep separate editable valueKeys", () => {
    const scenario = makeScenario([field("entity_1.ingresos_seleccion", "DOP"), field("entity_1.ingresos_valor", "80000")]);
    const edited = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(scenario, { "entity_1.ingresos_seleccion": "USD" });
    strict_1.default.equal(edited.runtimeDataset?.resolvedValues["entity_1.ingresos_seleccion"], "USD");
    strict_1.default.equal(edited.runtimeDataset?.resolvedValues["entity_1.ingresos_valor"], "80000");
    strict_1.default.deepEqual(edited.runtimeInputRequirements?.filter((input) => input.editable).map((input) => input.valueKey), ["entity_1.ingresos_seleccion", "entity_1.ingresos_valor"]);
});
(0, node_test_1.default)("CASE 9: entity_2 edit preserves scope and unique constraint", () => {
    const scenario = makeScenario([field("entity_2.colaborador", "B", { entityScope: "entity_2", constraints: [{ type: "uniqueWithinCollection", uniqueWithinCollection: true }] })]);
    const edited = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(scenario, { "entity_2.colaborador": "C" });
    const result = requirement(edited, "entity_2.colaborador");
    strict_1.default.equal(result.entityScope, "entity_2");
    strict_1.default.equal(result.constraints?.[0]?.uniqueWithinCollection, true);
    strict_1.default.equal(result.editable, true);
    strict_1.default.equal(result.value, "C");
});
(0, node_test_1.default)("CASE 10: rehydration preserves editable state and CURRENT_QA_EDIT", () => {
    const original = makeScenario([field("entity_1.name", "Alice")]);
    const edited = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(original, { "entity_1.name": "Bob" });
    const hydrated = (0, canonical_recording_contract_1.hydrateCanonicalInteractionsFromSemanticModel)(edited, { editingSessions: [], canonicalInteractions: [] });
    const refetched = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(hydrated, {});
    const result = requirement(refetched, "entity_1.name");
    strict_1.default.equal(result.value, "Bob");
    strict_1.default.equal(result.source, "CURRENT_QA_EDIT");
    strict_1.default.equal(result.editable, true);
    strict_1.default.equal(refetched.requiredData[0].exampleValue, "Alice");
});
