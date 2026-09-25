"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const canonical_recording_contract_1 = require("./canonical-recording-contract");
(0, node_test_1.default)("recording execution indices are unique and monotonic without changing action identity", () => {
    const actions = (0, canonical_recording_contract_1.normalizeRecordingExecutionActionIndices)([
        { actionType: "click", targetRef: "button-a", stepIndex: 8 },
        { actionType: "check", targetRef: "checkbox-a", stepIndex: 8 },
        { actionType: "fill", targetRef: "field-a", stepIndex: 9 },
    ]);
    strict_1.default.deepEqual(actions.map((action) => action.stepIndex), [1, 2, 3]);
    strict_1.default.deepEqual(actions.map((action) => action.actionType), ["click", "check", "fill"]);
});
const recording_store_1 = require("./recording-store");
const trace_normalizer_1 = require("./trace-normalizer");
const trace_to_scenario_1 = require("./trace-to-scenario");
const semantic_recording_1 = require("./semantic-recording");
function primary() {
    return {
        scenarioId: "recorded-primary",
        title: "Registrar entidad",
        description: "Recorrido observado",
        preconditions: [],
        kind: "happy_path",
        provenance: "observed",
        mobileSteps: [],
        webSteps: [
            { action: "fill", entityScope: "entity_1", valueKey: "entity_1.document", description: "document" },
            { action: "fill", entityScope: "entity_1", valueKey: "entity_1.position", description: "position" },
            { action: "click", entityScope: "entity_1", valueKey: "entity_1.currency_seleccion", description: "currency" },
            { action: "fill", entityScope: "entity_1", valueKey: "entity_1.amount_valor", description: "amount" },
        ],
        testRailSteps: [
            { content: "Ingresar [entity_1.document] en Document", stepTemplate: "Ingresar [entity_1.document] en Document", valueKey: "entity_1.document", entityScope: "entity_1", expected: "" },
            { content: "Ingresar [entity_1.position] en Position", stepTemplate: "Ingresar [entity_1.position] en Position", valueKey: "entity_1.position", entityScope: "entity_1", expected: "" },
            { content: "Seleccionar [entity_1.currency_seleccion] en Currency", stepTemplate: "Seleccionar [entity_1.currency_seleccion] en Currency", valueKey: "entity_1.currency_seleccion", entityScope: "entity_1", expected: "" },
            { content: "Ingresar [entity_1.amount_valor] en Amount", stepTemplate: "Ingresar [entity_1.amount_valor] en Amount", valueKey: "entity_1.amount_valor", entityScope: "entity_1", expected: "" },
            { content: "Continuar", expected: "" },
        ],
        requiredData: [
            { key: "entity_1.document", label: "Document", semanticField: "Document", entityScope: "entity_1", stepIndex: 0, exampleValue: "A", sensitive: false, valueRole: "action_input", source: "RECORDED_CONFIRMED" },
            { key: "entity_1.position", label: "Position", semanticField: "Position", entityScope: "entity_1", stepIndex: 1, exampleValue: "B", sensitive: false, valueRole: "action_input", source: "RECORDED_CONFIRMED" },
            { key: "entity_1.currency_seleccion", label: "Currency", semanticField: "Currency", entityScope: "entity_1", stepIndex: 2, exampleValue: "DOP", sensitive: false, valueRole: "action_input", source: "RECORDED_CONFIRMED" },
            { key: "entity_1.amount_valor", label: "Amount", semanticField: "Amount", entityScope: "entity_1", stepIndex: 3, exampleValue: "1500", sensitive: false, valueRole: "action_input", source: "RECORDED_CONFIRMED" },
            { key: "entity_1.generated", label: "Generated result", semanticField: "Generated result", entityScope: "entity_1", stepIndex: 4, exampleValue: "created", sensitive: false, valueRole: "runtime_derived_oracle", source: "OBSERVED" },
        ],
        stepTargets: [],
        sourceRecordingId: "recording-1",
        hasUncertainSteps: false,
        technicalReadiness: true,
        functionalReadiness: true,
        oracleAuthority: "observed_only",
        canonicalInteractions: [
            { id: "i-document", controlIdentity: "document", semanticField: "Document", entityScope: "entity_1", action: "fill", valueKey: "entity_1.document", recordedValue: "A", sourceEventRefs: ["e1"], technicalTargetRefs: ["css:#document"], confidence: 1 },
            { id: "i-position", controlIdentity: "position", semanticField: "Position", entityScope: "entity_1", action: "fill", valueKey: "entity_1.position", recordedValue: "B", sourceEventRefs: ["e2"], technicalTargetRefs: ["css:#position"], confidence: 1 },
            { id: "i-currency", controlIdentity: "currency", semanticField: "Currency", entityScope: "entity_1", action: "select", valueKey: "entity_1.currency_seleccion", recordedValue: "DOP", sourceEventRefs: ["e3"], technicalTargetRefs: ["css:#currency"], confidence: 1 },
            { id: "i-amount", controlIdentity: "amount", semanticField: "Amount", entityScope: "entity_1", action: "fill", valueKey: "entity_1.amount_valor", recordedValue: "1500", rawTypedValue: "1500", committedValue: "1500", displayValue: "DOP 1,5000", sourceEventRefs: ["e4"], technicalTargetRefs: ["css:#amount"], confidence: 1 },
        ],
        entityActionBlocks: [{ entityScope: "entity_1", semanticActions: [], dataRequirements: [], runtimeDerivedOracles: [], technicalKnowledgeRefs: [] }],
    };
}
(0, node_test_1.default)("REPEAT_ENTITY inherits confirmed reusable inputs with explicit lineage", () => {
    const source = primary();
    const opportunity = (0, canonical_recording_contract_1.detectMutationOpportunities)(source, {
        technicalObservations: [],
        semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
    })[0];
    strict_1.default.equal(opportunity?.mutationType, "REPEAT_ENTITY");
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, opportunity);
    const cloned = (materialized.runtimeInputRequirements ?? []).filter((input) => input.entityScope === "entity_2" && input.valueRole === "action_input");
    strict_1.default.deepEqual(cloned.map((input) => input.valueKey), ["entity_2.document", "entity_2.position", "entity_2.currency_seleccion", "entity_2.amount_valor"]);
    strict_1.default.deepEqual(cloned.map((input) => input.value), ["A", "B", "DOP", "1500"]);
    strict_1.default.ok(cloned.every((input) => input.sourceAuthority === "CLONED_CONFIRMED_VALUE" && input.resolved));
    strict_1.default.equal(cloned.find((input) => input.valueKey === "entity_2.currency_seleccion")?.sourceValueKey, "entity_1.currency_seleccion");
    strict_1.default.equal(cloned.find((input) => input.valueKey === "entity_2.amount_valor")?.repeatCloneDisposition, "CLONE_SAME_VALUE");
    strict_1.default.equal(materialized.testRailSteps.filter((step) => step.entityScope === "entity_2").length, 4);
    strict_1.default.ok(materialized.testRailSteps.every((step) => !/completar (empleado|cliente|los campos)/i.test(step.content)));
    strict_1.default.ok((materialized.runtimeInputRequirements ?? []).find((input) => input.valueRole === "runtime_derived_oracle"));
    strict_1.default.deepEqual(materialized.readiness?.missingInputs, []);
    strict_1.default.equal(materialized.readiness?.executionReadiness, true);
    strict_1.default.equal((0, canonical_recording_contract_1.toSharedMcpScenario)(materialized, "app").mcpExecutable, true);
});
(0, node_test_1.default)("REPEAT_ENTITY restores a compound selection omitted by a stale entity block projection", () => {
    const source = primary();
    source.entityActionBlocks = [{
            entityScope: "entity_1",
            semanticActions: source.canonicalInteractions.filter((interaction) => interaction.action !== "select"),
            dataRequirements: [],
            runtimeDerivedOracles: [],
            technicalKnowledgeRefs: [],
        }];
    const opportunity = (0, canonical_recording_contract_1.detectMutationOpportunities)(source, {
        technicalObservations: [],
        semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
    })[0];
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, opportunity);
    const clonedActions = materialized.canonicalInteractions.filter((interaction) => interaction.entityScope === "entity_2");
    strict_1.default.equal(clonedActions.some((interaction) => interaction.action === "select" && interaction.valueKey === "entity_2.currency_seleccion"), true);
    strict_1.default.equal(materialized.testRailSteps.filter((step) => step.entityScope === "entity_2").length, 4);
});
(0, node_test_1.default)("repeat clone policy protects new, sensitive and system-generated fields", () => {
    strict_1.default.equal((0, canonical_recording_contract_1.classifyRepeatFieldForClone)({ valueRole: "action_input", sensitive: false }), "CLONE_SAME_VALUE");
    strict_1.default.equal((0, canonical_recording_contract_1.classifyRepeatFieldForClone)({ valueRole: "secure_input", sensitive: true }), "REQUIRE_NEW_VALUE");
    strict_1.default.equal((0, canonical_recording_contract_1.classifyRepeatFieldForClone)({ valueRole: "runtime_derived_oracle", sensitive: false }), "SYSTEM_GENERATED");
    strict_1.default.equal((0, canonical_recording_contract_1.classifyRepeatFieldForClone)({ valueRole: "action_input", sensitive: false, repeatClonePolicy: "REQUIRE_NEW_VALUE" }), "REQUIRE_NEW_VALUE");
});
(0, node_test_1.default)("REPEAT_ENTITY preserves independent compound selection and amount values", () => {
    const source = primary();
    const opportunity = (0, canonical_recording_contract_1.detectMutationOpportunities)(source, {
        technicalObservations: [],
        semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
    })[0];
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, opportunity);
    const values = new Map((materialized.runtimeInputRequirements ?? []).map((input) => [input.valueKey, input.value]));
    strict_1.default.equal(values.get("entity_1.currency_seleccion"), "DOP");
    strict_1.default.equal(values.get("entity_1.amount_valor"), "1500");
    strict_1.default.equal(values.get("entity_2.currency_seleccion"), "DOP");
    strict_1.default.equal(values.get("entity_2.amount_valor"), "1500");
    strict_1.default.notEqual(values.get("entity_2.amount_valor"), values.get("entity_2.currency_seleccion"));
    strict_1.default.notEqual(values.get("entity_2.amount_valor"), "DOP 1500");
});
(0, node_test_1.default)("REPEAT_ENTITY allocates the sole distinct authorized candidate for a unique field", () => {
    const source = primary();
    const field = source.requiredData.find((candidate) => candidate.key === "entity_1.document");
    field.constraints = [{ type: "uniqueWithinCollection", uniqueWithinCollection: true, source: "application" }];
    field.allowedValues = ["A", "C"];
    const opportunity = (0, canonical_recording_contract_1.detectMutationOpportunities)(source, {
        technicalObservations: [],
        semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
    })[0];
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, opportunity);
    const requirement = materialized.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document");
    const resolution = materialized.repeatConstraintResolutions?.find((item) => item.valueKey === "entity_2.document");
    strict_1.default.equal(requirement?.value, "C");
    strict_1.default.equal(materialized.canonicalInteractions?.find((interaction) => interaction.id === "i-document-clone-1")?.recordedValue, "C");
    strict_1.default.deepEqual(resolution && {
        activeValueCount: resolution.activeValueCount,
        candidateCount: resolution.candidateCount,
        distinctCandidateCount: resolution.distinctCandidateCount,
        resolutionSource: resolution.resolutionSource,
        resolved: resolution.resolved,
    }, { activeValueCount: 1, candidateCount: 2, distinctCandidateCount: 1, resolutionSource: "allowed_values", resolved: true });
    strict_1.default.equal(materialized.mutationDiagnostics?.rejectionReason, undefined);
});
(0, node_test_1.default)("REPEAT_ENTITY reports a constraint violation when no distinct authorized candidate exists", () => {
    const source = primary();
    const field = source.requiredData.find((candidate) => candidate.key === "entity_1.document");
    field.constraints = [{ type: "uniqueWithinCollection", uniqueWithinCollection: true, source: "application" }];
    field.allowedValues = ["A"];
    const opportunity = (0, canonical_recording_contract_1.detectMutationOpportunities)(source, {
        technicalObservations: [],
        semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
    })[0];
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, opportunity);
    const resolution = materialized.repeatConstraintResolutions?.find((item) => item.valueKey === "entity_2.document");
    strict_1.default.equal(resolution?.distinctCandidateCount, 0);
    strict_1.default.equal(resolution?.resolved, false);
    strict_1.default.equal(materialized.mutationDiagnostics?.rejectionReason, "RUNTIME_DATA_CONSTRAINT_VIOLATION");
    strict_1.default.equal(materialized.replayEligible, false);
    strict_1.default.equal(materialized.readiness?.dataReadiness, false);
    strict_1.default.equal(materialized.readiness?.dataReadinessReasons.includes("RUNTIME_DATA_REQUIRED"), true);
    strict_1.default.equal(materialized.runtimeExecutionBlockedByData, true);
});
(0, node_test_1.default)("QA_EDIT revalidates a distinct Repeat value and survives runtime dataset rehydration", () => {
    const source = primary();
    const field = source.requiredData.find((candidate) => candidate.key === "entity_1.document");
    field.constraints = [{ type: "uniqueWithinCollection", uniqueWithinCollection: true, source: "runtime" }];
    const opportunity = {
        title: "Repeat entity",
        mutationType: "REPEAT_ENTITY",
        basePrimaryScenarioId: source.scenarioId,
        operations: [{ type: "clone_entity", sourceEntityScope: "entity_1", targetEntityScope: "entity_2" }],
        evidenceRefs: [],
        rationale: "Repeat the observed entity block",
        oracleAuthority: "MISSING",
        confidence: 1,
        needsReview: true,
    };
    const blocked = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, opportunity);
    const edited = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(blocked, { "entity_2.document": "C" });
    const requirement = edited.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document");
    const resolution = edited.repeatConstraintResolutions?.find((item) => item.valueKey === "entity_2.document");
    strict_1.default.equal(requirement?.value, "C");
    strict_1.default.equal(requirement?.source, "CURRENT_QA_EDIT");
    strict_1.default.equal(requirement?.authority, "explicit_qa_edit");
    strict_1.default.equal(requirement?.sourceAuthority, "EXPLICIT_MUTATION");
    strict_1.default.equal(requirement?.editable, true);
    strict_1.default.equal(requirement?.resolved, true);
    strict_1.default.equal(resolution?.resolutionSource, "runtime_dataset");
    strict_1.default.equal(resolution?.resolved, true);
    strict_1.default.equal(edited.mutationDiagnostics?.rejectionReason, undefined);
    strict_1.default.equal(edited.runtimeExecutionBlockedByData, false);
    strict_1.default.equal(edited.replayEligible, true);
    const editedContract = (0, canonical_recording_contract_1.toSharedMcpScenario)(edited, "app");
    strict_1.default.equal(editedContract.mcpExecutable, true);
    strict_1.default.equal(blocked.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document")?.value, null);
    strict_1.default.equal(blocked.runtimeInputRequirements?.find((input) => input.valueKey === "entity_1.document")?.value, "A");
    const rehydrated = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(edited, {});
    strict_1.default.equal(rehydrated.runtimeDataset?.resolvedValues["entity_2.document"], "C");
    strict_1.default.equal(rehydrated.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document")?.authority, "explicit_qa_edit");
    strict_1.default.equal(rehydrated.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document")?.source, "CURRENT_QA_EDIT");
    strict_1.default.equal(rehydrated.repeatConstraintResolutions?.find((item) => item.valueKey === "entity_2.document")?.resolved, true);
    strict_1.default.equal((0, canonical_recording_contract_1.toSharedMcpScenario)(rehydrated, "app").recordingExecutionContract?.actions.find((action) => action.valueKey === "entity_2.document")?.value, "C");
});
(0, node_test_1.default)("QA_EDIT keeps Repeat blocked when the supplied value duplicates the active entity", () => {
    const source = primary();
    const field = source.requiredData.find((candidate) => candidate.key === "entity_1.document");
    field.constraints = [{ type: "uniqueWithinCollection", uniqueWithinCollection: true, source: "runtime" }];
    const blocked = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, {
        title: "Repeat entity",
        mutationType: "REPEAT_ENTITY",
        basePrimaryScenarioId: source.scenarioId,
        operations: [{ type: "clone_entity", sourceEntityScope: "entity_1", targetEntityScope: "entity_2" }],
        evidenceRefs: [],
        rationale: "Repeat the observed entity block",
        oracleAuthority: "MISSING",
        confidence: 1,
        needsReview: true,
    });
    const edited = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(blocked, { "entity_2.document": "A" });
    const requirement = edited.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document");
    strict_1.default.equal(requirement?.authority, "explicit_qa_edit");
    strict_1.default.equal(requirement?.value, "A");
    strict_1.default.equal(requirement?.resolved, false);
    strict_1.default.equal(edited.readiness?.dataReadiness, false);
    strict_1.default.equal(edited.readiness?.dataReadinessReasons.includes("RUNTIME_DATA_REQUIRED"), true);
    strict_1.default.equal(edited.mutationDiagnostics?.rejectionReason, "RUNTIME_DATA_CONSTRAINT_VIOLATION");
    strict_1.default.equal(edited.replayEligible, false);
    strict_1.default.equal(edited.runtimeExecutionBlockedByData, true);
    strict_1.default.equal((0, canonical_recording_contract_1.toSharedMcpScenario)(edited, "app").mcpExecutable, false);
});
function dateRepeatSource(runtimeDate, canonicalDate = runtimeDate) {
    const source = primary();
    source.requiredData.push({
        key: "entity_1.start_date",
        label: "Start date",
        semanticField: "Start date",
        entityScope: "entity_1",
        stepIndex: source.requiredData.length,
        exampleValue: canonicalDate,
        sensitive: false,
        valueRole: "action_input",
        source: "RECORDED_CONFIRMED",
        formatHint: "date",
        constraints: [{ type: "not_future", source: "application" }],
    });
    source.canonicalInteractions?.push({
        id: "i-start-date",
        controlIdentity: "start-date",
        semanticField: "Start date",
        entityScope: "entity_1",
        action: "fill",
        valueKey: "entity_1.start_date",
        recordedValue: canonicalDate,
        sourceEventRefs: ["e-date"],
        technicalTargetRefs: ["css:#start-date"],
        confidence: 1,
    });
    source.runtimeDataset = {
        scenarioId: source.scenarioId,
        requirements: [],
        resolvedValues: { "entity_1.start_date": runtimeDate },
        missingValues: [],
    };
    return source;
}
function repeatMutation(source) {
    return {
        title: "Repeat entity",
        mutationType: "REPEAT_ENTITY",
        basePrimaryScenarioId: source.scenarioId,
        operations: [{ type: "clone_entity", sourceEntityScope: "entity_1", targetEntityScope: "entity_2" }],
        evidenceRefs: [],
        rationale: "Repeat the observed entity block",
        oracleAuthority: "MISSING",
        confidence: 1,
        needsReview: true,
    };
}
(0, node_test_1.default)("REPEAT_ENTITY uses the confirmed base dataset for cloned preconditions", () => {
    const source = dateRepeatSource("2000-01-01", "2222-01-01");
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, repeatMutation(source));
    const values = new Map((materialized.runtimeInputRequirements ?? []).map((input) => [input.valueKey, input]));
    strict_1.default.equal(values.get("entity_1.start_date")?.value, "2000-01-01");
    strict_1.default.equal(values.get("entity_2.start_date")?.value, "2000-01-01");
    strict_1.default.equal(values.get("entity_2.start_date")?.sourceAuthority, "CLONED_CONFIRMED_VALUE");
    strict_1.default.equal(materialized.mutationPreconditionValidity?.status, "valid");
    strict_1.default.equal(materialized.replayEligible, true);
    strict_1.default.equal((0, canonical_recording_contract_1.toSharedMcpScenario)(materialized, "app").mcpExecutable, true);
});
(0, node_test_1.default)("REPEAT_ENTITY rejects an explicitly invalid structured precondition before replay", () => {
    const source = dateRepeatSource("2222-01-01");
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, repeatMutation(source));
    strict_1.default.equal(materialized.mutationPreconditionValidity?.status, "invalid");
    strict_1.default.deepEqual(materialized.mutationPreconditionValidity?.invalidValueKeys, ["entity_1.start_date", "entity_2.start_date"]);
    strict_1.default.equal(materialized.mutationDiagnostics?.rejectionReason, "MUTATION_PRECONDITION_INVALID");
    strict_1.default.equal(materialized.replayEligible, false);
    strict_1.default.equal((0, canonical_recording_contract_1.toSharedMcpScenario)(materialized, "app").mcpExecutable, false);
});
(0, node_test_1.default)("selection, formatted amount and mask activation become canonical actions", () => {
    const interactions = (0, canonical_recording_contract_1.buildCanonicalInteractions)([
        { seq: 0, t: 1, kind: "tap", screenKey: "s", target: { label: "Option", associatedField: "Type", interactionType: "select", afterValue: "A", locators: [{ strategy: "role", value: "combobox" }] } },
        { seq: 1, t: 2, kind: "tap", screenKey: "s", target: { label: "000-000-0000", placeholder: "000-000-0000", locators: [{ strategy: "label", value: "phone" }] } },
        { seq: 2, t: 3, kind: "fill", screenKey: "s", target: { label: "Phone", inputValue: "1234567890", locators: [{ strategy: "label", value: "phone" }] }, value: "1234567890" },
        { seq: 3, t: 4, kind: "fill", screenKey: "s", target: { label: "Amount", compoundRole: "amount_or_text", rawTypedValue: "1500", committedValue: "1500", displayValue: "DOP 1,5000", locators: [{ strategy: "css", value: "#amount" }] }, value: "DOP 1,5000" },
    ]);
    strict_1.default.equal(interactions.filter((interaction) => interaction.action === "select").length, 1);
    strict_1.default.equal(interactions.filter((interaction) => interaction.action === "fill").length, 2);
    strict_1.default.equal(interactions.some((interaction) => interaction.recordedValue === "1500" && interaction.displayValue === "DOP 1,5000"), true);
    strict_1.default.equal(interactions.some((interaction) => interaction.recordedValue === "000-000-0000"), false);
});
(0, node_test_1.default)("rehydrates a missing portalized selection without replacing persisted actions", () => {
    const scenario = primary();
    const hydrated = (0, canonical_recording_contract_1.hydrateCanonicalInteractionsFromSemanticModel)(scenario, {
        editingSessions: [],
        canonicalInteractions: [{
                id: "i-type-selection",
                controlIdentity: "type-control",
                semanticField: "Type",
                entityScope: "entity_1",
                action: "select",
                valueKey: "entity_1.type_seleccion",
                recordedValue: "ID",
                sourceEventRefs: ["event-3"],
                technicalTargetRefs: ["structural:type-control"],
                confidence: 0.9,
            }],
    });
    strict_1.default.deepEqual(hydrated.canonicalInteractions?.map((interaction) => interaction.id), [
        "i-document", "i-position", "i-currency", "i-amount", "i-type-selection",
    ]);
    strict_1.default.equal(hydrated.requiredData.some((field) => field.key === "entity_1.type_seleccion" && field.exampleValue === "ID"), true);
});
(0, node_test_1.default)("reviewed logical dataset value unlocks a derived scenario without using its display aggregate", () => {
    const candidate = { ...primary(), oracleAuthority: "review_required", reviewStatus: "APPROVED", reviewedExpectedResult: "El resultado es aceptable" };
    const applied = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(candidate, { "entity_1.amount_valor": "1500" });
    const amount = applied.runtimeInputRequirements?.find((requirement) => requirement.valueKey === "entity_1.amount_valor");
    strict_1.default.equal(amount?.value, "1500");
    strict_1.default.equal(applied.readiness?.oracleReadiness, true);
    strict_1.default.equal(applied.readiness?.publicationReadiness, true);
});
(0, node_test_1.default)("canonical semantic authority repairs persisted dataset values while preserving QA edits", () => {
    const source = primary();
    const scenario = {
        ...source,
        requiredData: source.requiredData.map((field) => field.key === "entity_1.amount_valor"
            ? { ...field, exampleValue: "DOP 25000" }
            : field),
        canonicalInteractions: source.canonicalInteractions?.map((interaction) => interaction.id === "i-amount"
            ? { ...interaction, recordedValue: "25000", committedValue: "DOP 2,5000" }
            : interaction),
    };
    const repaired = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(scenario, {});
    strict_1.default.equal(repaired.runtimeDataset?.resolvedValues["entity_1.amount_valor"], "25000");
    strict_1.default.equal(repaired.requiredData.find((field) => field.key === "entity_1.amount_valor")?.exampleValue, "25000");
    const explicit = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(scenario, { "entity_1.amount_valor": "QA-override" });
    strict_1.default.equal(explicit.runtimeDataset?.resolvedValues["entity_1.amount_valor"], "QA-override");
    strict_1.default.equal(explicit.runtimeInputRequirements?.find((input) => input.valueKey === "entity_1.amount_valor")?.authority, "explicit_qa_edit");
    const rehydrated = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(explicit, {});
    strict_1.default.equal(rehydrated.runtimeDataset?.resolvedValues["entity_1.amount_valor"], "QA-override");
    strict_1.default.equal(rehydrated.runtimeInputRequirements?.find((input) => input.valueKey === "entity_1.amount_valor")?.authority, "explicit_qa_edit");
    const blocked = (0, canonical_recording_contract_1.evaluateRecordingReadiness)({
        functionalReadiness: true,
        technicalReadiness: true,
        oracleReadiness: true,
        runtimeInputRequirements: [{
                valueKey: "entity_1.amount_valor",
                semanticField: "Amount",
                valueRole: "action_input",
                required: true,
                value: "stale",
                source: "RECORDED_CONFIRMED",
                resolved: true,
                authority: "canonical_committed",
                authorityValue: "canonical",
                datasetAuthorityMismatch: true,
            }],
    });
    strict_1.default.equal(blocked.dataReadiness, false);
    strict_1.default.deepEqual(blocked.datasetAuthorityMismatches.map((input) => input.valueKey), ["entity_1.amount_valor"]);
    strict_1.default.deepEqual(blocked.dataReadinessReasons, ["dataset_authority_mismatch"]);
});
(0, node_test_1.default)("TestRail publication is independent from technical execution readiness", () => {
    const scenario = { ...primary(), technicalReadiness: false, hasUncertainSteps: true };
    const applied = (0, canonical_recording_contract_1.applyRuntimeDatasetValues)(scenario, {});
    strict_1.default.equal(applied.readiness?.executionReadiness, false);
    strict_1.default.equal(applied.readiness?.publicationContentReadiness, true);
    strict_1.default.equal(applied.readiness?.publicationReadiness, true);
});
(0, node_test_1.default)("recording execution contract keeps target authority stable when dataset values change", () => {
    const first = (0, canonical_recording_contract_1.toSharedMcpScenario)(primary(), "app", { "entity_1.document": "123456" });
    const changed = (0, canonical_recording_contract_1.toSharedMcpScenario)(primary(), "app", { "entity_1.document": "987654" });
    const firstAction = first.recordingExecutionContract?.actions[0];
    const changedAction = changed.recordingExecutionContract?.actions[0];
    strict_1.default.equal(firstAction?.targetRef, "document");
    strict_1.default.equal(firstAction?.valueKey, "entity_1.document");
    strict_1.default.equal(firstAction?.runtimeValueSource, "dataset");
    strict_1.default.equal(changedAction?.targetRef, firstAction?.targetRef);
    strict_1.default.equal(changedAction?.technicalTargetRef, firstAction?.technicalTargetRef);
    strict_1.default.equal(first.runtimeInputRequirements.find((input) => input.valueKey === "entity_1.document")?.value, "123456");
    strict_1.default.equal(changed.runtimeInputRequirements.find((input) => input.valueKey === "entity_1.document")?.value, "987654");
});
(0, node_test_1.default)("execution auditor reports every executable action and exact target blockers", () => {
    const source = primary();
    const audit = (0, canonical_recording_contract_1.evaluateRecordedScenarioExecutionReadiness)(source);
    strict_1.default.equal(audit.actions.length, source.canonicalInteractions?.length);
    strict_1.default.equal(audit.actions.every((action) => action.technicalTargetCount > 0), true);
    strict_1.default.equal(audit.actions.filter((action) => action.actionType === "click").every((action) => action.runtimeValueResolved), true);
    const blocked = (0, canonical_recording_contract_1.evaluateRecordedScenarioExecutionReadiness)({
        ...source,
        canonicalInteractions: source.canonicalInteractions?.map((interaction) => interaction.id === "i-amount"
            ? { ...interaction, technicalTargetRefs: [], technicalTargetCandidates: [] }
            : interaction),
    });
    strict_1.default.equal(blocked.executionReady, false);
    strict_1.default.ok(blocked.actions.find((action) => action.actionId === "i-amount")?.blockReasons.includes("missing_technical_target"));
});
(0, node_test_1.default)("ZERO_ENTITY removes the entity block and preserves reachable finalization", () => {
    const source = primary();
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, {
        opportunityId: "zero",
        title: "Continuar sin entidad",
        mutationType: "ZERO_ENTITY",
        basePrimaryScenarioId: source.scenarioId,
        operations: [{ type: "remove_entity", entityScope: "entity_1" }],
        evidenceRefs: [],
        rationale: "Omitir el bloque observado",
        oracleAuthority: "MISSING",
        confidence: 0.5,
        needsReview: true,
    });
    strict_1.default.equal(materialized.testRailSteps.some((step) => step.entityScope === "entity_1"), false);
    strict_1.default.equal(materialized.testRailSteps.some((step) => step.content === "Continuar"), true);
    strict_1.default.ok((materialized.mutationDiagnostics?.stepsRemoved ?? 0) > 0);
    strict_1.default.notEqual(materialized.mutationDiagnostics?.rejectionReason, "MUTATION_NO_EFFECT");
});
(0, node_test_1.default)("ZERO_ENTITY prunes an unproven functional transition and exposes a negative oracle", () => {
    const source = primary();
    const terminal = {
        id: "i-final",
        controlIdentity: "finish",
        action: "click",
        sourceEventRefs: [],
        technicalTargetRefs: ["role:button|finish"],
        causedTransition: true,
        confidence: 1,
    };
    source.canonicalInteractions = [...source.canonicalInteractions, terminal];
    source.entityActionBlocks = [{
            entityScope: "entity_1",
            semanticActions: source.canonicalInteractions.filter((interaction) => interaction.entityScope === "entity_1"),
            dataRequirements: [],
            runtimeDerivedOracles: [],
            technicalKnowledgeRefs: [],
        }];
    source.testRailSteps.push({ content: "Continuar", interactionId: terminal.id, expected: "" });
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, {
        title: "Sin entidad",
        mutationType: "ZERO_ENTITY",
        basePrimaryScenarioId: source.scenarioId,
        operations: [{ type: "remove_entity", entityScope: "entity_1" }],
        evidenceRefs: [],
        rationale: "Omitir la entidad observada",
        oracleAuthority: "MISSING",
        confidence: 1,
        needsReview: true,
    });
    strict_1.default.equal(materialized.testRailSteps.some((step) => step.interactionId === terminal.id), false);
    strict_1.default.equal(materialized.canonicalInteractions?.some((interaction) => interaction.id === terminal.id), false);
    strict_1.default.deepEqual(materialized.negativeOracle, {
        kind: "negative",
        source: "mutation_precondition_graph",
        expectedState: { entityCount: 0, canSubmit: false },
        terminalActionApplicable: false,
    });
});
(0, node_test_1.default)("ALTERNATIVE_SELECTION does not retain functional actions after the terminal transition", () => {
    const source = primary();
    const terminal = {
        id: "i-final",
        controlIdentity: "finish",
        action: "click",
        sourceEventRefs: [],
        technicalTargetRefs: ["role:button|finish"],
        causedTransition: true,
        confidence: 1,
    };
    const trailing = {
        id: "i-trailing",
        controlIdentity: "stale-select",
        action: "select",
        valueKey: "entity_1.currency_seleccion",
        recordedValue: "USD",
        sourceEventRefs: [],
        technicalTargetRefs: ["role:combobox|stale"],
        confidence: 1,
    };
    source.canonicalInteractions = [...source.canonicalInteractions, terminal, trailing];
    source.testRailSteps.push({ content: "Continuar", interactionId: terminal.id, expected: "" });
    source.testRailSteps.push({ content: "Seleccionar [entity_1.currency_seleccion]", interactionId: trailing.id, valueKey: trailing.valueKey, expected: "" });
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, {
        title: "Alternativa",
        mutationType: "ALTERNATIVE_SELECTION",
        basePrimaryScenarioId: source.scenarioId,
        operations: [{ type: "replace_selection", interactionId: "i-currency", value: "USD" }],
        evidenceRefs: [],
        rationale: "Usar una opción observada",
        oracleAuthority: "MISSING",
        confidence: 1,
        needsReview: true,
    });
    strict_1.default.equal(materialized.canonicalInteractions?.some((interaction) => interaction.id === trailing.id), false);
    strict_1.default.equal(materialized.testRailSteps.some((step) => step.interactionId === trailing.id), false);
    strict_1.default.equal(materialized.canonicalInteractions?.find((interaction) => interaction.id === "i-final")?.recordedValue, undefined);
});
(0, node_test_1.default)("MUTATION_NO_EFFECT rejects a candidate with the primary semantic signature", () => {
    const source = primary();
    const noOp = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, {
        opportunityId: "noop",
        title: "Título diferente sin cambio",
        mutationType: "FIELD_OMISSION",
        basePrimaryScenarioId: source.scenarioId,
        operations: [{ type: "remove_action", interactionId: "not-present" }],
        evidenceRefs: [],
        rationale: "No debe aceptarse",
        oracleAuthority: "MISSING",
        confidence: 0.1,
        needsReview: true,
    });
    strict_1.default.equal(noOp.mutationDiagnostics?.rejectionReason, "MUTATION_NO_EFFECT");
    strict_1.default.equal((0, canonical_recording_contract_1.toSharedMcpScenario)(noOp, "app").mcpExecutable, false);
});
(0, node_test_1.default)("selected option alone is not an alternative opportunity; an observed inventory is", () => {
    const source = primary();
    const observation = (options) => ({
        observationId: "selection-observation",
        status: "OBSERVED",
        componentType: "select/combobox",
        label: "Currency",
        semanticField: "Currency",
        technicalTargetRef: "currency",
        locatorCandidates: [{ strategy: "role", value: "combobox" }],
        observedOptions: options,
        dynamicLifecycle: { selectedOption: "DOP", options },
    });
    const selectedOnly = (0, canonical_recording_contract_1.detectMutationOpportunities)(source, { technicalObservations: [observation(["DOP"])], semanticComponents: [] });
    strict_1.default.equal(selectedOnly.some((opportunity) => opportunity.mutationType === "ALTERNATIVE_SELECTION"), false);
    const withInventory = (0, canonical_recording_contract_1.detectMutationOpportunities)(source, { technicalObservations: [observation(["DOP", "USD"])], semanticComponents: [] });
    strict_1.default.equal(withInventory.some((opportunity) => opportunity.mutationType === "ALTERNATIVE_SELECTION"), true);
});
(0, node_test_1.default)("repeat affordance is inserted in its owned screen before a terminal transition", () => {
    const source = primary();
    source.testRailSteps = [
        { content: "Ingresar [entity_1.document]", valueKey: "entity_1.document", entityScope: "entity_1", interactionId: "i-document", expected: "" },
        { content: "Continuar", interactionId: "i-final", expected: "" },
    ];
    source.canonicalInteractions = [
        { ...source.canonicalInteractions[0], id: "i-document", screenBeforeRef: "screen-a", screenAfterRef: "screen-a", routeBefore: "/form", routeAfter: "/form" },
        { id: "i-final", controlIdentity: "finish", action: "click", sourceEventRefs: [], technicalTargetRefs: ["role:button|finish"], screenBeforeRef: "screen-a", screenAfterRef: "screen-b", routeBefore: "/form", routeAfter: "/result", causedTransition: true, confidence: 1 },
    ];
    const materialized = (0, canonical_recording_contract_1.materializeScenarioMutation)(source, {
        opportunityId: "repeat-boundary",
        title: "Registrar varias entidades",
        mutationType: "REPEAT_ENTITY",
        basePrimaryScenarioId: source.scenarioId,
        operations: [
            { type: "insert_action", afterInteractionId: "i-document", action: { id: "repeat", controlIdentity: "add", action: "click", sourceEventRefs: ["obs-add"], technicalTargetRefs: ["role:button|add"], screenBeforeRef: "screen-a", screenAfterRef: "screen-a", routeBefore: "/form", routeAfter: "/form", confidence: 1 } },
            { type: "clone_entity", sourceEntityScope: "entity_1", targetEntityScope: "entity_2" },
        ],
        evidenceRefs: ["obs-add"],
        rationale: "La repetición pertenece al formulario",
        oracleAuthority: "MISSING",
        confidence: 1,
        needsReview: true,
    });
    strict_1.default.equal(materialized.testRailSteps.map((step) => step.interactionId).join(","), "i-document,repeat,i-document-clone-1,i-final");
    strict_1.default.equal(materialized.stateSequenceValid, true);
    strict_1.default.equal(materialized.testRailSteps.at(-1)?.interactionId, "i-final");
});
(0, node_test_1.default)("state validation rejects a cross-screen action without an owned transition", () => {
    const result = (0, canonical_recording_contract_1.validateInteractionStateSequence)([
        { id: "a", controlIdentity: "a", action: "click", sourceEventRefs: [], technicalTargetRefs: [], screenBeforeRef: "screen-a", screenAfterRef: "screen-a", routeBefore: "/a", routeAfter: "/a", confidence: 1 },
        { id: "b", controlIdentity: "b", action: "click", sourceEventRefs: [], technicalTargetRefs: [], screenBeforeRef: "screen-b", screenAfterRef: "screen-b", routeBefore: "/b", routeAfter: "/b", confidence: 1 },
    ]);
    strict_1.default.equal(result.stateSequenceValid, false);
    strict_1.default.equal(result.stateSequenceIssues.length, 1);
});
(0, node_test_1.default)("runtime route authority follows the immediately preceding transition", () => {
    strict_1.default.equal((0, canonical_recording_contract_1.deriveExpectedRouteBefore)({ routeBefore: "/stale-captured-route" }, { routeAfter: "/runtime-route" }), "/runtime-route");
    strict_1.default.equal((0, canonical_recording_contract_1.deriveExpectedRouteBefore)({ routeBefore: "/captured-route" }), "/captured-route");
});
(0, node_test_1.default)("recording stop preserves two real actions after a state transition", () => {
    const events = [
        { seq: 0, t: 100, kind: "tap", screenKey: "screen-a", url: "/a", target: { label: "finalize", role: "button", locators: [{ strategy: "role", value: "button|finalize" }] } },
        { seq: 1, t: 200, kind: "navigate", screenKey: "screen-a", url: "/b", target: { label: "transition", locators: [] } },
        { seq: 2, t: 300, kind: "tap", screenKey: "screen-b", url: "/b", target: { label: "select", role: "checkbox", locators: [{ strategy: "role", value: "checkbox|select" }] } },
        { seq: 3, t: 400, kind: "tap", screenKey: "screen-b", url: "/b", target: { label: "mark", role: "button", locators: [{ strategy: "role", value: "button|mark" }] } },
    ];
    const actions = (0, canonical_recording_contract_1.buildCanonicalInteractions)(events).filter((interaction) => !interaction.technicalOnly);
    strict_1.default.deepEqual(actions.map((interaction) => interaction.description), [
        'Ingresar en "finalize"',
        'Ingresar en "select"',
        'Ingresar en "mark"',
    ]);
    strict_1.default.equal(actions.filter((interaction) => interaction.screenBeforeRef === "screen-b").length, 2);
});
(0, node_test_1.default)("checkbox state delta is preserved as semantic check or uncheck", () => {
    const interactions = (0, canonical_recording_contract_1.buildCanonicalInteractions)([
        { seq: 0, t: 1, kind: "tap", screenKey: "s", target: { label: "row", role: "checkbox", stateDelta: { checked: true }, afterState: { selected: true }, locators: [{ strategy: "role", value: "checkbox" }] } },
        { seq: 1, t: 2, kind: "tap", screenKey: "s", target: { label: "row", role: "checkbox", stateDelta: { checked: false }, afterState: { selected: false }, locators: [{ strategy: "role", value: "checkbox" }] } },
    ]);
    strict_1.default.deepEqual(interactions.map((interaction) => interaction.action), ["check", "uncheck"]);
});
(0, node_test_1.default)("alternative selection is confined to its selector inventory", () => {
    const source = primary();
    source.canonicalInteractions[2] = {
        ...source.canonicalInteractions[2],
        selectorControlId: "selector-a",
        optionSurfaceId: "surface-a",
    };
    const opportunities = (0, canonical_recording_contract_1.detectMutationOpportunities)(source, {
        technicalObservations: [],
        semanticComponents: [],
        selectorOptionInventories: [
            { selectorRef: "selector-a", semanticField: "Currency", entityScope: "entity_1", surfaceRef: "surface-a", options: ["DOP", "USD"], selectedOption: "DOP", observationRefs: ["obs-a"] },
            { selectorRef: "selector-b", semanticField: "Other", entityScope: "entity_1", surfaceRef: "surface-b", options: ["B1", "B2"], selectedOption: "B1", observationRefs: ["obs-b"] },
        ],
    });
    const alternative = opportunities.find((opportunity) => opportunity.mutationType === "ALTERNATIVE_SELECTION");
    strict_1.default.equal(alternative?.operations[0].type, "replace_selection");
    strict_1.default.equal((alternative?.operations[0]).value, "USD");
    strict_1.default.notEqual((alternative?.operations[0]).value, "B2");
});
(0, node_test_1.default)("legacy unscoped runtime duplicates are suppressed when a scoped key exists", () => {
    const scenario = primary();
    scenario.requiredData.push({ ...scenario.requiredData[0], key: "entity_1.document", label: "Document" });
    scenario.requiredData.push({ ...scenario.requiredData[0], key: "document", label: "Document" });
    const requirements = (0, canonical_recording_contract_1.materializeRuntimeInputRequirements)(scenario);
    strict_1.default.equal(requirements.some((requirement) => requirement.valueKey === "document"), false);
    strict_1.default.equal(requirements.some((requirement) => requirement.valueKey === "entity_1.document"), true);
});
(0, node_test_1.default)("real recording promotes compound children and materializes distinct Repeat/Zero scenarios", { skip: !(0, recording_store_1.loadTrace)("portalempresarial", "90512318-1ece-41ed-b7dc-8e419a8421fd") ? "diagnostic recording is not present in this checkout" : false }, () => {
    const recordingId = "90512318-1ece-41ed-b7dc-8e419a8421fd";
    const trace = (0, recording_store_1.loadTrace)("portalempresarial", recordingId);
    strict_1.default.ok(trace);
    const events = (0, trace_normalizer_1.normalizeEvents)(trace.events);
    const base = (0, trace_to_scenario_1.buildHappyPathScenario)(trace, events, { recordingId, goal: "registrar empleado" });
    const model = (0, semantic_recording_1.buildSemanticRecordingModel)(trace, events);
    const scenario = (0, canonical_recording_contract_1.enrichRecordedScenarioContract)(base, base.canonicalInteractions ?? [], model.technicalObservations.map((observation) => observation.observationId), model);
    strict_1.default.deepEqual(scenario.entityActionBlocks?.map((block) => block.entityScope), ["entity_1"]);
    const primarySelection = scenario.canonicalInteractions?.find((interaction) => interaction.action === "select");
    const primaryAmount = scenario.canonicalInteractions?.find((interaction) => interaction.action === "fill" && interaction.valueKey?.endsWith("ingresos_valor"));
    strict_1.default.equal(primarySelection?.valueKey?.endsWith("ingresos_seleccion"), true);
    strict_1.default.equal(primarySelection?.recordedValue, "DOP");
    strict_1.default.ok(primaryAmount?.valueKey);
    strict_1.default.notEqual(primarySelection?.valueKey, primaryAmount?.valueKey);
    strict_1.default.equal(scenario.requiredData.filter((field) => field.key.includes("ingresos")).length, 2);
    strict_1.default.deepEqual(scenario.testRailSteps.map((step) => step.stepNumber), scenario.testRailSteps.map((_, index) => index + 1));
    strict_1.default.equal(scenario.scenarioStepCount, scenario.testRailSteps.length);
    strict_1.default.equal((scenario.functionalActionCount ?? 0) + (scenario.nonUserSetupSteps ?? 0), scenario.scenarioStepCount);
    strict_1.default.ok(scenario.testRailSteps.every((step) => !/^\d+\.\s/.test(step.content)));
    const repeat = scenario.mutationOpportunities?.find((opportunity) => opportunity.mutationType === "REPEAT_ENTITY");
    strict_1.default.ok(repeat);
    const repeated = (0, canonical_recording_contract_1.materializeScenarioMutation)(scenario, repeat);
    strict_1.default.equal(repeated.entityActionBlocks?.some((block) => block.entityScope === "entity_2"), true);
    strict_1.default.equal(repeated.testRailSteps.filter((step) => step.entityScope === "entity_2").length, scenario.testRailSteps.filter((step) => step.entityScope === "entity_1").length);
    strict_1.default.ok(repeated.requiredData.filter((field) => field.key.startsWith("entity_2.")).every((field) => field.exampleValue !== undefined));
    strict_1.default.ok(repeated.runtimeInputRequirements?.filter((requirement) => requirement.valueKey.startsWith("entity_2.")).every((requirement) => requirement.value !== null && requirement.sourceAuthority === "CLONED_CONFIRMED_VALUE" && requirement.resolved));
    strict_1.default.ok((repeated.mutationDiagnostics?.stepsAdded ?? 0) > 0);
    const zero = scenario.mutationOpportunities?.find((opportunity) => opportunity.mutationType === "ZERO_ENTITY");
    strict_1.default.ok(zero);
    const omitted = (0, canonical_recording_contract_1.materializeScenarioMutation)(scenario, zero);
    strict_1.default.equal(omitted.testRailSteps.some((step) => step.entityScope === "entity_1"), false);
    strict_1.default.ok((omitted.mutationDiagnostics?.stepsRemoved ?? 0) > 0);
    strict_1.default.notEqual(omitted.mutationDiagnostics?.materializedSemanticSignature, (0, canonical_recording_contract_1.materializedSemanticSignature)(scenario));
});
