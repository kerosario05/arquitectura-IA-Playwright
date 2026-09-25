import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  applyRuntimeDatasetValues,
  buildCanonicalInteractions,
  detectMutationOpportunities,
  enrichRecordedScenarioContract,
  evaluateRecordedScenarioExecutionReadiness,
  materializeScenarioMutation,
  materializeRuntimeInputRequirements,
  classifyRepeatFieldForClone,
  evaluateRecordingReadiness,
  materializedSemanticSignature,
  toSharedMcpScenario,
  normalizeRecordingExecutionActionIndices,
  hydrateCanonicalInteractionsFromSemanticModel,
  validateInteractionStateSequence,
  deriveExpectedRouteBefore,
  type ScenarioMutationProposal,
} from "./canonical-recording-contract";

test("recording execution indices are unique and monotonic without changing action identity", () => {
  const actions = normalizeRecordingExecutionActionIndices([
    { actionType: "click", targetRef: "button-a", stepIndex: 8 },
    { actionType: "check", targetRef: "checkbox-a", stepIndex: 8 },
    { actionType: "fill", targetRef: "field-a", stepIndex: 9 },
  ]);
  assert.deepEqual(actions.map((action) => action.stepIndex), [1, 2, 3]);
  assert.deepEqual(actions.map((action) => action.actionType), ["click", "check", "fill"]);
});
import { loadTrace } from "./recording-store";
import { normalizeEvents } from "./trace-normalizer";
import { buildHappyPathScenario } from "./trace-to-scenario";
import { buildSemanticRecordingModel } from "./semantic-recording";
import type { RecordedScenario } from "./trace-to-scenario";

function primary(): RecordedScenario {
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

test("REPEAT_ENTITY inherits confirmed reusable inputs with explicit lineage", () => {
  const source = primary();
  const opportunity = detectMutationOpportunities(source, {
    technicalObservations: [],
    semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
  } as never)[0];
  assert.equal(opportunity?.mutationType, "REPEAT_ENTITY");
  const materialized = materializeScenarioMutation(source, opportunity as ScenarioMutationProposal);
  const cloned = (materialized.runtimeInputRequirements ?? []).filter((input) => input.entityScope === "entity_2" && input.valueRole === "action_input");
  assert.deepEqual(cloned.map((input) => input.valueKey), ["entity_2.document", "entity_2.position", "entity_2.currency_seleccion", "entity_2.amount_valor"]);
  assert.deepEqual(cloned.map((input) => input.value), ["A", "B", "DOP", "1500"]);
  assert.ok(cloned.every((input) => input.sourceAuthority === "CLONED_CONFIRMED_VALUE" && input.resolved));
  assert.equal(cloned.find((input) => input.valueKey === "entity_2.currency_seleccion")?.sourceValueKey, "entity_1.currency_seleccion");
  assert.equal(cloned.find((input) => input.valueKey === "entity_2.amount_valor")?.repeatCloneDisposition, "CLONE_SAME_VALUE");
  assert.equal(materialized.testRailSteps.filter((step) => step.entityScope === "entity_2").length, 4);
  assert.ok(materialized.testRailSteps.every((step) => !/completar (empleado|cliente|los campos)/i.test(step.content)));
  assert.ok((materialized.runtimeInputRequirements ?? []).find((input) => input.valueRole === "runtime_derived_oracle"));
  assert.deepEqual(materialized.readiness?.missingInputs, []);
  assert.equal(materialized.readiness?.executionReadiness, true);
  assert.equal(toSharedMcpScenario(materialized, "app").mcpExecutable, true);
});

test("REPEAT_ENTITY restores a compound selection omitted by a stale entity block projection", () => {
  const source = primary();
  source.entityActionBlocks = [{
    entityScope: "entity_1",
    semanticActions: source.canonicalInteractions!.filter((interaction) => interaction.action !== "select"),
    dataRequirements: [],
    runtimeDerivedOracles: [],
    technicalKnowledgeRefs: [],
  }];
  const opportunity = detectMutationOpportunities(source, {
    technicalObservations: [],
    semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
  } as never)[0]!;
  const materialized = materializeScenarioMutation(source, opportunity);
  const clonedActions = materialized.canonicalInteractions!.filter((interaction) => interaction.entityScope === "entity_2");
  assert.equal(clonedActions.some((interaction) => interaction.action === "select" && interaction.valueKey === "entity_2.currency_seleccion"), true);
  assert.equal(materialized.testRailSteps.filter((step) => step.entityScope === "entity_2").length, 4);
});

test("repeat clone policy protects new, sensitive and system-generated fields", () => {
  assert.equal(classifyRepeatFieldForClone({ valueRole: "action_input", sensitive: false }), "CLONE_SAME_VALUE");
  assert.equal(classifyRepeatFieldForClone({ valueRole: "secure_input", sensitive: true }), "REQUIRE_NEW_VALUE");
  assert.equal(classifyRepeatFieldForClone({ valueRole: "runtime_derived_oracle", sensitive: false }), "SYSTEM_GENERATED");
  assert.equal(classifyRepeatFieldForClone({ valueRole: "action_input", sensitive: false, repeatClonePolicy: "REQUIRE_NEW_VALUE" }), "REQUIRE_NEW_VALUE");
});

test("REPEAT_ENTITY preserves independent compound selection and amount values", () => {
  const source = primary();
  const opportunity = detectMutationOpportunities(source, {
    technicalObservations: [],
    semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
  } as never)[0]!;
  const materialized = materializeScenarioMutation(source, opportunity);
  const values = new Map((materialized.runtimeInputRequirements ?? []).map((input) => [input.valueKey, input.value]));
  assert.equal(values.get("entity_1.currency_seleccion"), "DOP");
  assert.equal(values.get("entity_1.amount_valor"), "1500");
  assert.equal(values.get("entity_2.currency_seleccion"), "DOP");
  assert.equal(values.get("entity_2.amount_valor"), "1500");
  assert.notEqual(values.get("entity_2.amount_valor"), values.get("entity_2.currency_seleccion"));
  assert.notEqual(values.get("entity_2.amount_valor"), "DOP 1500");
});

test("REPEAT_ENTITY allocates the sole distinct authorized candidate for a unique field", () => {
  const source = primary();
  const field = source.requiredData.find((candidate) => candidate.key === "entity_1.document")!;
  field.constraints = [{ type: "uniqueWithinCollection", uniqueWithinCollection: true, source: "application" }];
  field.allowedValues = ["A", "C"];
  const opportunity = detectMutationOpportunities(source, {
    technicalObservations: [],
    semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
  } as never)[0]!;
  const materialized = materializeScenarioMutation(source, opportunity);
  const requirement = materialized.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document");
  const resolution = materialized.repeatConstraintResolutions?.find((item) => item.valueKey === "entity_2.document");
  assert.equal(requirement?.value, "C");
  assert.equal(materialized.canonicalInteractions?.find((interaction) => interaction.id === "i-document-clone-1")?.recordedValue, "C");
  assert.deepEqual(resolution && {
    activeValueCount: resolution.activeValueCount,
    candidateCount: resolution.candidateCount,
    distinctCandidateCount: resolution.distinctCandidateCount,
    resolutionSource: resolution.resolutionSource,
    resolved: resolution.resolved,
  }, { activeValueCount: 1, candidateCount: 2, distinctCandidateCount: 1, resolutionSource: "allowed_values", resolved: true });
  assert.equal(materialized.mutationDiagnostics?.rejectionReason, undefined);
});

test("REPEAT_ENTITY reports a constraint violation when no distinct authorized candidate exists", () => {
  const source = primary();
  const field = source.requiredData.find((candidate) => candidate.key === "entity_1.document")!;
  field.constraints = [{ type: "uniqueWithinCollection", uniqueWithinCollection: true, source: "application" }];
  field.allowedValues = ["A"];
  const opportunity = detectMutationOpportunities(source, {
    technicalObservations: [],
    semanticComponents: [{ componentId: "add", componentType: "button", label: "Add another entity", observationRefs: [] }],
  } as never)[0]!;
  const materialized = materializeScenarioMutation(source, opportunity);
  const resolution = materialized.repeatConstraintResolutions?.find((item) => item.valueKey === "entity_2.document");
  assert.equal(resolution?.distinctCandidateCount, 0);
  assert.equal(resolution?.resolved, false);
  assert.equal(materialized.mutationDiagnostics?.rejectionReason, "RUNTIME_DATA_CONSTRAINT_VIOLATION");
  assert.equal(materialized.replayEligible, false);
  assert.equal(materialized.readiness?.dataReadiness, false);
  assert.equal(materialized.readiness?.dataReadinessReasons.includes("RUNTIME_DATA_REQUIRED"), true);
  assert.equal(materialized.runtimeExecutionBlockedByData, true);
});

test("QA_EDIT revalidates a distinct Repeat value and survives runtime dataset rehydration", () => {
  const source = primary();
  const field = source.requiredData.find((candidate) => candidate.key === "entity_1.document")!;
  field.constraints = [{ type: "uniqueWithinCollection", uniqueWithinCollection: true, source: "runtime" }];
  const opportunity: ScenarioMutationProposal = {
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
  const blocked = materializeScenarioMutation(source, opportunity);
  const edited = applyRuntimeDatasetValues(blocked, { "entity_2.document": "C" });
  const requirement = edited.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document");
  const resolution = edited.repeatConstraintResolutions?.find((item) => item.valueKey === "entity_2.document");

  assert.equal(requirement?.value, "C");
  assert.equal(requirement?.source, "CURRENT_QA_EDIT");
  assert.equal(requirement?.authority, "explicit_qa_edit");
  assert.equal(requirement?.sourceAuthority, "EXPLICIT_MUTATION");
  assert.equal(requirement?.editable, true);
  assert.equal(requirement?.resolved, true);
  assert.equal(resolution?.resolutionSource, "runtime_dataset");
  assert.equal(resolution?.resolved, true);
  assert.equal(edited.mutationDiagnostics?.rejectionReason, undefined);
  assert.equal(edited.runtimeExecutionBlockedByData, false);
  assert.equal(edited.replayEligible, true);
  const editedContract = toSharedMcpScenario(edited, "app");
  assert.equal(editedContract.mcpExecutable, true);
  assert.equal(blocked.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document")?.value, null);
  assert.equal(blocked.runtimeInputRequirements?.find((input) => input.valueKey === "entity_1.document")?.value, "A");

  const rehydrated = applyRuntimeDatasetValues(edited, {});
  assert.equal(rehydrated.runtimeDataset?.resolvedValues["entity_2.document"], "C");
  assert.equal(rehydrated.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document")?.authority, "explicit_qa_edit");
  assert.equal(rehydrated.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document")?.source, "CURRENT_QA_EDIT");
  assert.equal(rehydrated.repeatConstraintResolutions?.find((item) => item.valueKey === "entity_2.document")?.resolved, true);
  assert.equal(toSharedMcpScenario(rehydrated, "app").recordingExecutionContract?.actions.find((action) => action.valueKey === "entity_2.document")?.value, "C");
});

test("QA_EDIT keeps Repeat blocked when the supplied value duplicates the active entity", () => {
  const source = primary();
  const field = source.requiredData.find((candidate) => candidate.key === "entity_1.document")!;
  field.constraints = [{ type: "uniqueWithinCollection", uniqueWithinCollection: true, source: "runtime" }];
  const blocked = materializeScenarioMutation(source, {
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
  const edited = applyRuntimeDatasetValues(blocked, { "entity_2.document": "A" });
  const requirement = edited.runtimeInputRequirements?.find((input) => input.valueKey === "entity_2.document");
  assert.equal(requirement?.authority, "explicit_qa_edit");
  assert.equal(requirement?.value, "A");
  assert.equal(requirement?.resolved, false);
  assert.equal(edited.readiness?.dataReadiness, false);
  assert.equal(edited.readiness?.dataReadinessReasons.includes("RUNTIME_DATA_REQUIRED"), true);
  assert.equal(edited.mutationDiagnostics?.rejectionReason, "RUNTIME_DATA_CONSTRAINT_VIOLATION");
  assert.equal(edited.replayEligible, false);
  assert.equal(edited.runtimeExecutionBlockedByData, true);
  assert.equal(toSharedMcpScenario(edited, "app").mcpExecutable, false);
});

function dateRepeatSource(runtimeDate: string, canonicalDate = runtimeDate) {
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

function repeatMutation(source: ReturnType<typeof dateRepeatSource>): ScenarioMutationProposal {
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

test("REPEAT_ENTITY uses the confirmed base dataset for cloned preconditions", () => {
  const source = dateRepeatSource("2000-01-01", "2222-01-01");
  const materialized = materializeScenarioMutation(source, repeatMutation(source));
  const values = new Map((materialized.runtimeInputRequirements ?? []).map((input) => [input.valueKey, input]));
  assert.equal(values.get("entity_1.start_date")?.value, "2000-01-01");
  assert.equal(values.get("entity_2.start_date")?.value, "2000-01-01");
  assert.equal(values.get("entity_2.start_date")?.sourceAuthority, "CLONED_CONFIRMED_VALUE");
  assert.equal(materialized.mutationPreconditionValidity?.status, "valid");
  assert.equal(materialized.replayEligible, true);
  assert.equal(toSharedMcpScenario(materialized, "app").mcpExecutable, true);
});

test("REPEAT_ENTITY rejects an explicitly invalid structured precondition before replay", () => {
  const source = dateRepeatSource("2222-01-01");
  const materialized = materializeScenarioMutation(source, repeatMutation(source));
  assert.equal(materialized.mutationPreconditionValidity?.status, "invalid");
  assert.deepEqual(materialized.mutationPreconditionValidity?.invalidValueKeys, ["entity_1.start_date", "entity_2.start_date"]);
  assert.equal(materialized.mutationDiagnostics?.rejectionReason, "MUTATION_PRECONDITION_INVALID");
  assert.equal(materialized.replayEligible, false);
  assert.equal(toSharedMcpScenario(materialized, "app").mcpExecutable, false);
});

test("selection, formatted amount and mask activation become canonical actions", () => {
  const interactions = buildCanonicalInteractions([
    { seq: 0, t: 1, kind: "tap", screenKey: "s", target: { label: "Option", associatedField: "Type", interactionType: "select", afterValue: "A", locators: [{ strategy: "role", value: "combobox" }] } },
    { seq: 1, t: 2, kind: "tap", screenKey: "s", target: { label: "000-000-0000", placeholder: "000-000-0000", locators: [{ strategy: "label", value: "phone" }] } },
    { seq: 2, t: 3, kind: "fill", screenKey: "s", target: { label: "Phone", inputValue: "1234567890", locators: [{ strategy: "label", value: "phone" }] }, value: "1234567890" },
    { seq: 3, t: 4, kind: "fill", screenKey: "s", target: { label: "Amount", compoundRole: "amount_or_text", rawTypedValue: "1500", committedValue: "1500", displayValue: "DOP 1,5000", locators: [{ strategy: "css", value: "#amount" }] }, value: "DOP 1,5000" },
  ] as never);
  assert.equal(interactions.filter((interaction) => interaction.action === "select").length, 1);
  assert.equal(interactions.filter((interaction) => interaction.action === "fill").length, 2);
  assert.equal(interactions.some((interaction) => interaction.recordedValue === "1500" && interaction.displayValue === "DOP 1,5000"), true);
  assert.equal(interactions.some((interaction) => interaction.recordedValue === "000-000-0000"), false);
});

test("rehydrates a missing portalized selection without replacing persisted actions", () => {
  const scenario = primary();
  const hydrated = hydrateCanonicalInteractionsFromSemanticModel(scenario, {
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
  } as any);
  assert.deepEqual(hydrated.canonicalInteractions?.map((interaction) => interaction.id), [
    "i-document", "i-position", "i-currency", "i-amount", "i-type-selection",
  ]);
  assert.equal(hydrated.requiredData.some((field) => field.key === "entity_1.type_seleccion" && field.exampleValue === "ID"), true);
});

test("reviewed logical dataset value unlocks a derived scenario without using its display aggregate", () => {
  const candidate = { ...primary(), oracleAuthority: "review_required" as const, reviewStatus: "APPROVED" as const, reviewedExpectedResult: "El resultado es aceptable" };
  const applied = applyRuntimeDatasetValues(candidate, { "entity_1.amount_valor": "1500" });
  const amount = applied.runtimeInputRequirements?.find((requirement) => requirement.valueKey === "entity_1.amount_valor");
  assert.equal(amount?.value, "1500");
  assert.equal(applied.readiness?.oracleReadiness, true);
  assert.equal(applied.readiness?.publicationReadiness, true);
});

test("canonical semantic authority repairs persisted dataset values while preserving QA edits", () => {
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
  const repaired = applyRuntimeDatasetValues(scenario, {});
  assert.equal(repaired.runtimeDataset?.resolvedValues["entity_1.amount_valor"], "25000");
  assert.equal(repaired.requiredData.find((field) => field.key === "entity_1.amount_valor")?.exampleValue, "25000");
  const explicit = applyRuntimeDatasetValues(scenario, { "entity_1.amount_valor": "QA-override" });
  assert.equal(explicit.runtimeDataset?.resolvedValues["entity_1.amount_valor"], "QA-override");
  assert.equal(explicit.runtimeInputRequirements?.find((input) => input.valueKey === "entity_1.amount_valor")?.authority, "explicit_qa_edit");
  const rehydrated = applyRuntimeDatasetValues(explicit, {});
  assert.equal(rehydrated.runtimeDataset?.resolvedValues["entity_1.amount_valor"], "QA-override");
  assert.equal(rehydrated.runtimeInputRequirements?.find((input) => input.valueKey === "entity_1.amount_valor")?.authority, "explicit_qa_edit");
  const blocked = evaluateRecordingReadiness({
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
  assert.equal(blocked.dataReadiness, false);
  assert.deepEqual(blocked.datasetAuthorityMismatches.map((input) => input.valueKey), ["entity_1.amount_valor"]);
  assert.deepEqual(blocked.dataReadinessReasons, ["dataset_authority_mismatch"]);
});

test("TestRail publication is independent from technical execution readiness", () => {
  const scenario = { ...primary(), technicalReadiness: false, hasUncertainSteps: true };
  const applied = applyRuntimeDatasetValues(scenario, {});
  assert.equal(applied.readiness?.executionReadiness, false);
  assert.equal(applied.readiness?.publicationContentReadiness, true);
  assert.equal(applied.readiness?.publicationReadiness, true);
});

test("recording execution contract keeps target authority stable when dataset values change", () => {
  const first = toSharedMcpScenario(primary(), "app", { "entity_1.document": "123456" });
  const changed = toSharedMcpScenario(primary(), "app", { "entity_1.document": "987654" });
  const firstAction = first.recordingExecutionContract?.actions[0];
  const changedAction = changed.recordingExecutionContract?.actions[0];

  assert.equal(firstAction?.targetRef, "document");
  assert.equal(firstAction?.valueKey, "entity_1.document");
  assert.equal(firstAction?.runtimeValueSource, "dataset");
  assert.equal(changedAction?.targetRef, firstAction?.targetRef);
  assert.equal(changedAction?.technicalTargetRef, firstAction?.technicalTargetRef);
  assert.equal(first.runtimeInputRequirements.find((input) => input.valueKey === "entity_1.document")?.value, "123456");
  assert.equal(changed.runtimeInputRequirements.find((input) => input.valueKey === "entity_1.document")?.value, "987654");
});

test("execution auditor reports every executable action and exact target blockers", () => {
  const source = primary();
  const audit = evaluateRecordedScenarioExecutionReadiness(source);
  assert.equal(audit.actions.length, source.canonicalInteractions?.length);
  assert.equal(audit.actions.every((action) => action.technicalTargetCount > 0), true);
  assert.equal(audit.actions.filter((action) => action.actionType === "click").every((action) => action.runtimeValueResolved), true);
  const blocked = evaluateRecordedScenarioExecutionReadiness({
    ...source,
    canonicalInteractions: source.canonicalInteractions?.map((interaction) => interaction.id === "i-amount"
      ? { ...interaction, technicalTargetRefs: [], technicalTargetCandidates: [] }
      : interaction),
  });
  assert.equal(blocked.executionReady, false);
  assert.ok(blocked.actions.find((action) => action.actionId === "i-amount")?.blockReasons.includes("missing_technical_target"));
});

test("ZERO_ENTITY removes the entity block and preserves reachable finalization", () => {
  const source = primary();
  const materialized = materializeScenarioMutation(source, {
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
  assert.equal(materialized.testRailSteps.some((step) => step.entityScope === "entity_1"), false);
  assert.equal(materialized.testRailSteps.some((step) => step.content === "Continuar"), true);
  assert.ok((materialized.mutationDiagnostics?.stepsRemoved ?? 0) > 0);
  assert.notEqual(materialized.mutationDiagnostics?.rejectionReason, "MUTATION_NO_EFFECT");
});

test("ZERO_ENTITY prunes an unproven functional transition and exposes a negative oracle", () => {
  const source = primary();
  const terminal = {
    id: "i-final",
    controlIdentity: "finish",
    action: "click" as const,
    sourceEventRefs: [],
    technicalTargetRefs: ["role:button|finish"],
    causedTransition: true,
    confidence: 1,
  };
  source.canonicalInteractions = [...source.canonicalInteractions!, terminal];
  source.entityActionBlocks = [{
    entityScope: "entity_1",
    semanticActions: source.canonicalInteractions!.filter((interaction) => interaction.entityScope === "entity_1"),
    dataRequirements: [],
    runtimeDerivedOracles: [],
    technicalKnowledgeRefs: [],
  }];
  source.testRailSteps.push({ content: "Continuar", interactionId: terminal.id, expected: "" });
  const materialized = materializeScenarioMutation(source, {
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
  assert.equal(materialized.testRailSteps.some((step) => step.interactionId === terminal.id), false);
  assert.equal(materialized.canonicalInteractions?.some((interaction) => interaction.id === terminal.id), false);
  assert.deepEqual(materialized.negativeOracle, {
    kind: "negative",
    source: "mutation_precondition_graph",
    expectedState: { entityCount: 0, canSubmit: false },
    terminalActionApplicable: false,
  });
});

test("ALTERNATIVE_SELECTION does not retain functional actions after the terminal transition", () => {
  const source = primary();
  const terminal = {
    id: "i-final",
    controlIdentity: "finish",
    action: "click" as const,
    sourceEventRefs: [],
    technicalTargetRefs: ["role:button|finish"],
    causedTransition: true,
    confidence: 1,
  };
  const trailing = {
    id: "i-trailing",
    controlIdentity: "stale-select",
    action: "select" as const,
    valueKey: "entity_1.currency_seleccion",
    recordedValue: "USD",
    sourceEventRefs: [],
    technicalTargetRefs: ["role:combobox|stale"],
    confidence: 1,
  };
  source.canonicalInteractions = [...source.canonicalInteractions!, terminal, trailing];
  source.testRailSteps.push({ content: "Continuar", interactionId: terminal.id, expected: "" });
  source.testRailSteps.push({ content: "Seleccionar [entity_1.currency_seleccion]", interactionId: trailing.id, valueKey: trailing.valueKey, expected: "" });
  const materialized = materializeScenarioMutation(source, {
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
  assert.equal(materialized.canonicalInteractions?.some((interaction) => interaction.id === trailing.id), false);
  assert.equal(materialized.testRailSteps.some((step) => step.interactionId === trailing.id), false);
  assert.equal(materialized.canonicalInteractions?.find((interaction) => interaction.id === "i-final")?.recordedValue, undefined);
});

test("MUTATION_NO_EFFECT rejects a candidate with the primary semantic signature", () => {
  const source = primary();
  const noOp = materializeScenarioMutation(source, {
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
  assert.equal(noOp.mutationDiagnostics?.rejectionReason, "MUTATION_NO_EFFECT");
  assert.equal(toSharedMcpScenario(noOp, "app").mcpExecutable, false);
});

test("selected option alone is not an alternative opportunity; an observed inventory is", () => {
  const source = primary();
  const observation = (options: string[]) => ({
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
  const selectedOnly = detectMutationOpportunities(source, { technicalObservations: [observation(["DOP"])], semanticComponents: [] } as never);
  assert.equal(selectedOnly.some((opportunity) => opportunity.mutationType === "ALTERNATIVE_SELECTION"), false);
  const withInventory = detectMutationOpportunities(source, { technicalObservations: [observation(["DOP", "USD"])], semanticComponents: [] } as never);
  assert.equal(withInventory.some((opportunity) => opportunity.mutationType === "ALTERNATIVE_SELECTION"), true);
});

test("repeat affordance is inserted in its owned screen before a terminal transition", () => {
  const source = primary();
  source.testRailSteps = [
    { content: "Ingresar [entity_1.document]", valueKey: "entity_1.document", entityScope: "entity_1", interactionId: "i-document", expected: "" },
    { content: "Continuar", interactionId: "i-final", expected: "" },
  ];
  source.canonicalInteractions = [
    { ...source.canonicalInteractions![0], id: "i-document", screenBeforeRef: "screen-a", screenAfterRef: "screen-a", routeBefore: "/form", routeAfter: "/form" },
    { id: "i-final", controlIdentity: "finish", action: "click", sourceEventRefs: [], technicalTargetRefs: ["role:button|finish"], screenBeforeRef: "screen-a", screenAfterRef: "screen-b", routeBefore: "/form", routeAfter: "/result", causedTransition: true, confidence: 1 },
  ];
  const materialized = materializeScenarioMutation(source, {
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
  assert.equal(materialized.testRailSteps.map((step) => step.interactionId).join(","), "i-document,repeat,i-document-clone-1,i-final");
  assert.equal(materialized.stateSequenceValid, true);
  assert.equal(materialized.testRailSteps.at(-1)?.interactionId, "i-final");
});

test("state validation rejects a cross-screen action without an owned transition", () => {
  const result = validateInteractionStateSequence([
    { id: "a", controlIdentity: "a", action: "click", sourceEventRefs: [], technicalTargetRefs: [], screenBeforeRef: "screen-a", screenAfterRef: "screen-a", routeBefore: "/a", routeAfter: "/a", confidence: 1 },
    { id: "b", controlIdentity: "b", action: "click", sourceEventRefs: [], technicalTargetRefs: [], screenBeforeRef: "screen-b", screenAfterRef: "screen-b", routeBefore: "/b", routeAfter: "/b", confidence: 1 },
  ]);
  assert.equal(result.stateSequenceValid, false);
  assert.equal(result.stateSequenceIssues.length, 1);
});

test("a user-caused link transition remains functional after a preceding input", () => {
  const events = normalizeEvents([
    { seq: 0, t: 1, kind: "fill", screenKey: "login", url: "/login", target: { label: "Password", associatedField: "Password", role: "input", locators: [{ strategy: "css", value: "#password" }] }, value: "secret", valueSource: "user" },
    { seq: 1, t: 2, kind: "note", observationType: "pointer", screenKey: "home", url: "/", target: { label: "Solicitud multiproducto", role: "a", interactionType: "click", locators: [] } },
    { seq: 2, t: 3, kind: "tap", screenKey: "home", url: "/", target: { label: "Solicitud multiproducto", role: "a", interactionType: "click", locators: [{ strategy: "role", value: "a|Solicitud multiproducto" }] } },
    { seq: 3, t: 4, kind: "navigate", screenKey: "home", url: "/requests/create/multiproduct" },
  ] as never);
  const interactions = buildCanonicalInteractions(events);
  const link = interactions.find((interaction) => interaction.action === "click");
  assert.equal(link?.technicalOnly, undefined);
  assert.equal(link?.routeAfter, "/requests/create/multiproduct");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("technical coverage stays independent from an invalid state sequence", () => {
  const scenario = primary();
  scenario.testRailSteps = [{ content: "Campo", interactionId: "a", expected: "" }];
  scenario.requiredData = [];
  const interactions = [
    { id: "a", controlIdentity: "a", action: "fill", sourceEventRefs: [], technicalTargetRefs: ["css:#a"], screenBeforeRef: "s1", screenAfterRef: "s1", routeBefore: "/a", routeAfter: "/a", confidence: 1 },
    { id: "b", controlIdentity: "b", action: "click", sourceEventRefs: [], technicalTargetRefs: ["role:button|b"], screenBeforeRef: "s2", screenAfterRef: "s2", routeBefore: "/b", confidence: 1 },
  ] as never;
  const readiness = enrichRecordedScenarioContract({ ...scenario, technicalReadiness: true }, interactions, []);
  const audit = evaluateRecordedScenarioExecutionReadiness(readiness);
  assert.equal(readiness.stateSequenceValid, false);
  assert.equal(audit.technicalReady, true);
  assert.equal(audit.stateReady, false);
  assert.equal(audit.executionReady, false);
  assert.equal(readiness.readiness?.dataReadiness, true);
});

test("runtime route authority follows the immediately preceding transition", () => {
  assert.equal(
    deriveExpectedRouteBefore(
      { routeBefore: "/stale-captured-route" },
      { routeAfter: "/runtime-route" },
    ),
    "/runtime-route",
  );
  assert.equal(
    deriveExpectedRouteBefore({ routeBefore: "/captured-route" }),
    "/captured-route",
  );
});

test("recording stop preserves two real actions after a state transition", () => {
  const events = [
    { seq: 0, t: 100, kind: "tap", screenKey: "screen-a", url: "/a", target: { label: "finalize", role: "button", locators: [{ strategy: "role", value: "button|finalize" }] } },
    { seq: 1, t: 200, kind: "navigate", screenKey: "screen-a", url: "/b", target: { label: "transition", locators: [] } },
    { seq: 2, t: 300, kind: "tap", screenKey: "screen-b", url: "/b", target: { label: "select", role: "checkbox", locators: [{ strategy: "role", value: "checkbox|select" }] } },
    { seq: 3, t: 400, kind: "tap", screenKey: "screen-b", url: "/b", target: { label: "mark", role: "button", locators: [{ strategy: "role", value: "button|mark" }] } },
  ] as never;
  const actions = buildCanonicalInteractions(events).filter((interaction) => !interaction.technicalOnly);
  assert.deepEqual(actions.map((interaction) => interaction.description), [
    'Ingresar en "finalize"',
    'Ingresar en "select"',
    'Ingresar en "mark"',
  ]);
  assert.equal(actions.filter((interaction) => interaction.screenBeforeRef === "screen-b").length, 2);
});

test("checkbox state delta is preserved as semantic check or uncheck", () => {
  const interactions = buildCanonicalInteractions([
    { seq: 0, t: 1, kind: "tap", screenKey: "s", target: { label: "row", role: "checkbox", stateDelta: { checked: true }, afterState: { selected: true }, locators: [{ strategy: "role", value: "checkbox" }] } },
    { seq: 1, t: 2, kind: "tap", screenKey: "s", target: { label: "row", role: "checkbox", stateDelta: { checked: false }, afterState: { selected: false }, locators: [{ strategy: "role", value: "checkbox" }] } },
  ] as never);
  assert.deepEqual(interactions.map((interaction) => interaction.action), ["check", "uncheck"]);
});

test("alternative selection is confined to its selector inventory", () => {
  const source = primary();
  source.canonicalInteractions![2] = {
    ...source.canonicalInteractions![2],
    selectorControlId: "selector-a",
    optionSurfaceId: "surface-a",
  };
  const opportunities = detectMutationOpportunities(source, {
    technicalObservations: [],
    semanticComponents: [],
    selectorOptionInventories: [
      { selectorRef: "selector-a", semanticField: "Currency", entityScope: "entity_1", surfaceRef: "surface-a", options: ["DOP", "USD"], selectedOption: "DOP", observationRefs: ["obs-a"] },
      { selectorRef: "selector-b", semanticField: "Other", entityScope: "entity_1", surfaceRef: "surface-b", options: ["B1", "B2"], selectedOption: "B1", observationRefs: ["obs-b"] },
    ],
  } as never);
  const alternative = opportunities.find((opportunity) => opportunity.mutationType === "ALTERNATIVE_SELECTION");
  assert.equal(alternative?.operations[0].type, "replace_selection");
  assert.equal((alternative?.operations[0] as { value: string }).value, "USD");
  assert.notEqual((alternative?.operations[0] as { value: string }).value, "B2");
});

test("legacy unscoped runtime duplicates are suppressed when a scoped key exists", () => {
  const scenario = primary();
  scenario.requiredData.push({ ...scenario.requiredData[0], key: "entity_1.document", label: "Document" });
  scenario.requiredData.push({ ...scenario.requiredData[0], key: "document", label: "Document" });
  const requirements = materializeRuntimeInputRequirements(scenario);
  assert.equal(requirements.some((requirement) => requirement.valueKey === "document"), false);
  assert.equal(requirements.some((requirement) => requirement.valueKey === "entity_1.document"), true);
});

test("real recording promotes compound children and materializes distinct Repeat/Zero scenarios", { skip: !loadTrace("portalempresarial", "90512318-1ece-41ed-b7dc-8e419a8421fd") ? "diagnostic recording is not present in this checkout" : false }, () => {
  const recordingId = "90512318-1ece-41ed-b7dc-8e419a8421fd";
  const trace = loadTrace("portalempresarial", recordingId);
  assert.ok(trace);
  const events = normalizeEvents(trace.events);
  const base = buildHappyPathScenario(trace, events, { recordingId, goal: "registrar empleado" });
  const model = buildSemanticRecordingModel(trace, events);
  const scenario = enrichRecordedScenarioContract(base, base.canonicalInteractions ?? [], model.technicalObservations.map((observation) => observation.observationId), model);
  assert.deepEqual(scenario.entityActionBlocks?.map((block) => block.entityScope), ["entity_1"]);
  const primarySelection = scenario.canonicalInteractions?.find((interaction) => interaction.action === "select");
  const primaryAmount = scenario.canonicalInteractions?.find((interaction) => interaction.action === "fill" && interaction.valueKey?.endsWith("ingresos_valor"));
  assert.equal(primarySelection?.valueKey?.endsWith("ingresos_seleccion"), true);
  assert.equal(primarySelection?.recordedValue, "DOP");
  assert.ok(primaryAmount?.valueKey);
  assert.notEqual(primarySelection?.valueKey, primaryAmount?.valueKey);
  assert.equal(scenario.requiredData.filter((field) => field.key.includes("ingresos")).length, 2);
  assert.deepEqual(scenario.testRailSteps.map((step) => step.stepNumber), scenario.testRailSteps.map((_, index) => index + 1));
  assert.equal(scenario.scenarioStepCount, scenario.testRailSteps.length);
  assert.equal((scenario.functionalActionCount ?? 0) + (scenario.nonUserSetupSteps ?? 0), scenario.scenarioStepCount);
  assert.ok(scenario.testRailSteps.every((step) => !/^\d+\.\s/.test(step.content)));
  const repeat = scenario.mutationOpportunities?.find((opportunity) => opportunity.mutationType === "REPEAT_ENTITY");
  assert.ok(repeat);
  const repeated = materializeScenarioMutation(scenario, repeat!);
  assert.equal(repeated.entityActionBlocks?.some((block) => block.entityScope === "entity_2"), true);
  assert.equal(repeated.testRailSteps.filter((step) => step.entityScope === "entity_2").length, scenario.testRailSteps.filter((step) => step.entityScope === "entity_1").length);
  assert.ok(repeated.requiredData.filter((field) => field.key.startsWith("entity_2.")).every((field) => field.exampleValue !== undefined));
  assert.ok(repeated.runtimeInputRequirements?.filter((requirement) => requirement.valueKey.startsWith("entity_2.")).every((requirement) => requirement.value !== null && requirement.sourceAuthority === "CLONED_CONFIRMED_VALUE" && requirement.resolved));
  assert.ok((repeated.mutationDiagnostics?.stepsAdded ?? 0) > 0);
  const zero = scenario.mutationOpportunities?.find((opportunity) => opportunity.mutationType === "ZERO_ENTITY");
  assert.ok(zero);
  const omitted = materializeScenarioMutation(scenario, zero!);
  assert.equal(omitted.testRailSteps.some((step) => step.entityScope === "entity_1"), false);
  assert.ok((omitted.mutationDiagnostics?.stepsRemoved ?? 0) > 0);
  assert.notEqual(omitted.mutationDiagnostics?.materializedSemanticSignature, materializedSemanticSignature(scenario));
});

test("recording execution contract preserves the recorded post-action transition authority", () => {
  const source = primary();
  const scenario = {
    ...source,
    canonicalInteractions: [
      { id: "i-go", controlIdentity: "go", action: "click", sourceEventRefs: ["e1"], technicalTargetRefs: ["css:#go"], routeBefore: "https://app.test/list", routeAfter: "https://app.test/detail", transitionObserved: true, causedTransition: true, confidence: 1 },
    ],
    testRailSteps: [{ content: "Presionar go", expected: "" }],
    requiredData: [],
  } as RecordedScenario;
  const action = toSharedMcpScenario(scenario, "app").recordingExecutionContract?.actions[0];
  assert.equal(action?.expectedRouteBefore, "https://app.test/list");
  assert.equal(action?.expectedRouteAfter, "https://app.test/detail");
  assert.equal(action?.expectedOutcomeKind, "route_transition");
});

test("a same-route in-place transition keeps outcome authority without a recorded route", () => {
  const source = primary();
  const scenario = {
    ...source,
    canonicalInteractions: [
      { id: "i-inline", controlIdentity: "inline", action: "click", sourceEventRefs: ["e1"], technicalTargetRefs: ["css:#inline"], routeBefore: "https://app.test/list", transitionObserved: true, causedTransition: false, confidence: 1 },
    ],
    testRailSteps: [{ content: "Presionar inline", expected: "" }],
    requiredData: [],
  } as RecordedScenario;
  const action = toSharedMcpScenario(scenario, "app").recordingExecutionContract?.actions[0];
  assert.equal(action?.expectedRouteAfter, undefined);
  assert.equal(action?.expectedOutcomeKind, "in_place_transition");
});

test("an in-place action never inherits a later route postcondition", () => {
  const source = primary();
  const scenario = {
    ...source,
    canonicalInteractions: [
      {
        id: "i-dismiss",
        controlIdentity: "dismiss",
        action: "click",
        sourceEventRefs: ["e1"],
        technicalTargetRefs: ["role:button|dismiss"],
        routeBefore: "https://app.test/dashboard",
        routeAfter: "https://app.test/payroll",
        transitionObserved: true,
        causedTransition: false,
        confidence: 1,
      },
    ],
    testRailSteps: [{ content: "Presionar dismiss", expected: "" }],
    requiredData: [],
  } as RecordedScenario;
  const action = toSharedMcpScenario(scenario, "app").recordingExecutionContract?.actions[0];
  assert.equal(action?.expectedOutcomeKind, "in_place_transition");
  assert.equal(action?.expectedRouteAfter, undefined);
});

test("the checked-in CommonJS runtime sibling rejects stale route postconditions", () => {
  // QA Lab may run checked-in CommonJS server artifacts directly. Verify that sibling
  // carries the same causal guard as the TypeScript authority.
  const runtimeSource = fs.readFileSync(path.resolve(__dirname, "canonical-recording-contract.js"), "utf8");
  assert.match(runtimeSource, /interaction\.causedTransition === true && interaction\.routeAfter/);
  const runtimeToSharedMcpScenario = toSharedMcpScenario;
  const source = primary();
  source.canonicalInteractions = [{
    id: "i-dismiss-runtime",
    controlIdentity: "dismiss-runtime",
    action: "click",
    sourceEventRefs: ["e-runtime"],
    technicalTargetRefs: ["role:button|dismiss-runtime"],
    routeBefore: "https://app.test/dashboard",
    routeAfter: "https://app.test/future",
    transitionObserved: true,
    causedTransition: false,
    confidence: 1,
  }];
  source.testRailSteps = [{ content: "Presionar dismiss-runtime", expected: "" }];
  source.requiredData = [];
  const action = runtimeToSharedMcpScenario(source, "app").recordingExecutionContract?.actions[0];
  assert.equal(action?.expectedOutcomeKind, "in_place_transition");
  assert.equal(action?.expectedRouteAfter, undefined);
});

test("a navigation is causally bound to the pointer lifecycle that produced it, not raw event order", () => {
  const events = [
    { seq: 0, t: 100, kind: "note", observationType: "pointer", screenKey: "s", url: "/", target: { label: "Explora", role: "button", interactionType: "click" } },
    { seq: 1, t: 110, kind: "note", observationType: "focus", screenKey: "s", url: "/", target: { label: "Explora", role: "button" } },
    { seq: 2, t: 120, kind: "navigate", screenKey: "s", url: "/catalog", target: {} },
    { seq: 3, t: 200, kind: "tap", screenKey: "s", url: "/catalog", target: { label: "Explora", role: "button", locators: [{ strategy: "aria-label", value: "Explora" }] } },
    { seq: 4, t: 300, kind: "note", observationType: "pointer", screenKey: "s", url: "/catalog", target: { label: "Tarjetas", role: "button", interactionType: "click" } },
    { seq: 5, t: 320, kind: "navigate", screenKey: "s", url: "/cards", target: {} },
    { seq: 6, t: 400, kind: "tap", screenKey: "s", url: "/cards", target: { label: "Tarjetas", role: "button", locators: [{ strategy: "role", value: "button|Tarjetas" }] } },
  ] as never;
  const interactions = buildCanonicalInteractions(events as never);
  const explora = interactions.find((interaction) => interaction.id === "interaction-4");
  const tarjetas = interactions.find((interaction) => interaction.id === "interaction-7");
  assert.equal(explora?.routeBefore, "/");
  assert.equal(explora?.routeAfter, "/catalog");
  assert.equal(tarjetas?.routeBefore, "/catalog");
  assert.equal(tarjetas?.routeAfter, "/cards");
});

test("without a pointer anchor the forward transition keeps legacy behavior", () => {
  const events = [
    { seq: 0, t: 100, kind: "tap", screenKey: "s", url: "/a", target: { label: "go", role: "button", locators: [{ strategy: "role", value: "button|go" }] } },
    { seq: 1, t: 200, kind: "navigate", screenKey: "s", url: "/b", target: {} },
  ] as never;
  const interactions = buildCanonicalInteractions(events as never);
  const go = interactions.find((interaction) => interaction.action === "click");
  assert.equal(go?.routeBefore, "/a");
  assert.equal(go?.routeAfter, "/b");
});

test("an owned navigation is suppressed and an unowned navigation bridges the state timeline", () => {
  const events = [
    { seq: 0, t: 100, kind: "note", observationType: "pointer", screenKey: "s", url: "/", target: { label: "A", role: "button", interactionType: "click" } },
    { seq: 1, t: 200, kind: "navigate", screenKey: "s", url: "/a", target: {} },
    { seq: 2, t: 250, kind: "tap", screenKey: "s", url: "/a", target: { label: "A", role: "button", locators: [{ strategy: "role", value: "button|A" }] } },
    { seq: 3, t: 300, kind: "note", observationType: "pointer", screenKey: "s", url: "/a", target: { label: "B", role: "button", interactionType: "click" } },
    { seq: 4, t: 400, kind: "navigate", screenKey: "s", url: "/b", target: {} },
    { seq: 5, t: 450, kind: "tap", screenKey: "s", url: "/b", target: { label: "B", role: "button", locators: [{ strategy: "role", value: "button|B" }] } },
    { seq: 6, t: 500, kind: "note", observationType: "pointer", screenKey: "s", url: "/b", target: { label: "C", role: "div", interactionType: "click" } },
    { seq: 7, t: 510, kind: "note", observationType: "pointer", screenKey: "s", url: "/b", target: { label: "C", role: "div", interactionType: "click" } },
    { seq: 8, t: 600, kind: "navigate", screenKey: "s", url: "/c", target: {} },
    { seq: 9, t: 700, kind: "note", observationType: "pointer", screenKey: "s", url: "/c", target: { label: "D", role: "button", interactionType: "click" } },
    { seq: 10, t: 750, kind: "tap", screenKey: "s", url: "/c", target: { label: "D", role: "button", locators: [{ strategy: "role", value: "button|D" }] } },
  ] as never;
  const interactions = buildCanonicalInteractions(events as never);
  assert.deepEqual(interactions.map((interaction) => interaction.id), ["interaction-3", "interaction-6", "interaction-9", "interaction-11"]);
  const bridge = interactions.find((interaction) => interaction.id === "interaction-9");
  assert.equal(bridge?.action, "navigation");
  assert.equal(bridge?.technicalOnly, true);
  assert.equal(bridge?.routeBefore, "/b");
  assert.equal(bridge?.routeAfter, "/c");
  const validation = validateInteractionStateSequence(interactions);
  assert.equal(validation.stateSequenceValid, true);
  assert.deepEqual(validation.stateSequenceIssues, []);
});

test("two owned navigations in a row never duplicate a transition", () => {
  const events = [
    { seq: 0, t: 100, kind: "note", observationType: "pointer", screenKey: "s", url: "/", target: { label: "A", role: "button", interactionType: "click" } },
    { seq: 1, t: 120, kind: "navigate", screenKey: "s", url: "/loading", target: {} },
    { seq: 2, t: 180, kind: "navigate", screenKey: "s", url: "/a", target: {} },
    { seq: 3, t: 250, kind: "tap", screenKey: "s", url: "/a", target: { label: "A", role: "button", locators: [{ strategy: "role", value: "button|A" }] } },
  ] as never;
  const interactions = buildCanonicalInteractions(events as never);
  const navigations = interactions.filter((interaction) => interaction.action === "navigation");
  assert.equal(navigations.length, 0);
  const action = interactions.find((interaction) => interaction.action === "click");
  assert.equal(action?.routeBefore, "/");
  assert.equal(action?.routeAfter, "/a");
  assert.equal(validateInteractionStateSequence(interactions).stateSequenceValid, true);
});

test("technical coverage remains independent when state sequence is invalid", () => {
  const interactions = [
    {
      id: "interaction-a",
      action: "click",
      sourceEventRefs: ["event-1"],
      technicalTargetRefs: ["role:button|A"],
      technicalTargetCandidates: [{
        locatorCandidates: [{ strategy: "role", value: "button|A", confidence: 0.9 }],
        structuralContext: { owner: { tag: "button" }, stableDirectAttributes: { id: "action-a" } },
        targetType: "display",
        interactionEvidence: ["click"],
        confidence: 0.9,
        validatedByInteraction: true,
      }],
      routeBefore: "/a",
      routeAfter: "/b",
      screenBeforeRef: "surface-a",
      screenAfterRef: "surface-b",
    },
    {
      id: "interaction-b",
      action: "click",
      sourceEventRefs: ["event-2"],
      technicalTargetRefs: ["role:button|B"],
      technicalTargetCandidates: [{
        locatorCandidates: [{ strategy: "role", value: "button|B", confidence: 0.9 }],
        structuralContext: { owner: { tag: "button" }, stableDirectAttributes: { id: "action-b" } },
        targetType: "display",
        interactionEvidence: ["click"],
        confidence: 0.9,
        validatedByInteraction: true,
      }],
      routeBefore: "/unrelated",
      routeAfter: "/c",
      screenBeforeRef: "surface-c",
      screenAfterRef: "surface-d",
    },
  ] as never;
  const scenario = {
    scenarioId: "fresh-scenario",
    sourceRecordingId: "fresh-recording",
    title: "Fresh recording",
    requiredData: [],
    testRailSteps: [
      { content: "A", classification: "FUNCTIONAL_ACTION" },
      { content: "B", classification: "FUNCTIONAL_ACTION" },
    ],
    webSteps: [],
    canonicalInteractions: interactions,
    technicalReadiness: true,
    functionalReadiness: true,
    hasUncertainSteps: false,
    oracleAuthority: "observed_only",
    replayEligible: true,
  } as never;

  const enriched = enrichRecordedScenarioContract(scenario, interactions);

  assert.equal(enriched.stateSequenceValid, false);
  assert.deepEqual(enriched.stateSequenceIssues, ["interaction-a:surface-b->interaction-b:surface-c"]);
  assert.equal(enriched.technicalReadiness, true);
  assert.equal(enriched.readiness?.technicalReadiness, true);
  assert.equal(enriched.readiness?.executionReadiness, false);
});
