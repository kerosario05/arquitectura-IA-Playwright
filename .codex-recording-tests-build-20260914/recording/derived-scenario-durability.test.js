"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const scenario_preview_types_1 = require("../types/scenario-preview.types");
const recording_store_1 = require("./recording-store");
const canonical_recording_contract_1 = require("./canonical-recording-contract");
const persisted_scenario_hydration_1 = require("./persisted-scenario-hydration");
const appSlug = "portalempresarial";
const recordingId = "f6f29217-b81c-4f5d-8067-0e399f726d5b";
(0, node_test_1.default)("persisted derived catalog survives a fresh store read with stable IDs", () => {
    const firstRead = (0, recording_store_1.loadScenarios)(appSlug, recordingId);
    const restartedRead = (0, recording_store_1.loadScenarios)(appSlug, recordingId);
    const firstIds = firstRead.map((scenario) => scenario.scenarioId);
    const restartedIds = restartedRead.map((scenario) => scenario.scenarioId);
    strict_1.default.equal(firstRead.length, 4);
    strict_1.default.equal(restartedRead.length, 4);
    strict_1.default.deepEqual(restartedIds, firstIds);
    strict_1.default.equal(new Set(restartedIds).size, restartedIds.length);
});
(0, node_test_1.default)("persisted scenario hydration keeps all suggestions and repairs their runtime projection", () => {
    const persisted = (0, recording_store_1.loadScenarios)(appSlug, recordingId);
    const hydrated = (0, persisted_scenario_hydration_1.hydratePersistedScenarios)(persisted, (0, recording_store_1.loadSemanticRecording)(appSlug, recordingId));
    const ids = hydrated.map((scenario) => scenario.scenarioId);
    const alternative = hydrated.find((scenario) => scenario.mutation?.mutationType === "ALTERNATIVE_SELECTION");
    const selection = alternative?.canonicalInteractions?.find((interaction) => interaction.action === "select" && interaction.recordedValue === "USD");
    const requirement = alternative?.runtimeInputRequirements?.find((input) => input.valueKey === selection?.valueKey);
    const step = alternative?.testRailSteps.find((candidate) => candidate.interactionId === selection?.id);
    strict_1.default.equal(hydrated.length, 4);
    strict_1.default.deepEqual(ids, persisted.map((scenario) => scenario.scenarioId));
    strict_1.default.equal(selection?.recordedValue, "USD");
    strict_1.default.equal(requirement?.value, "DOP");
    strict_1.default.equal(step?.renderedStep, 'Seleccionar "DOP" en "Ingresos"');
});
(0, node_test_1.default)("persisted scenario hydration is idempotent and does not duplicate canonical actions", () => {
    const persisted = (0, recording_store_1.loadScenarios)(appSlug, recordingId);
    const semanticModel = (0, recording_store_1.loadSemanticRecording)(appSlug, recordingId);
    const hydrated = (0, persisted_scenario_hydration_1.hydratePersistedScenarios)(persisted, semanticModel);
    const rehydrated = (0, persisted_scenario_hydration_1.hydratePersistedScenarios)(hydrated, semanticModel);
    strict_1.default.deepEqual(rehydrated.map((scenario) => scenario.scenarioId), persisted.map((scenario) => scenario.scenarioId));
    for (const scenario of rehydrated) {
        const interactionIds = (scenario.canonicalInteractions ?? []).map((interaction) => interaction.id);
        strict_1.default.equal(new Set(interactionIds).size, interactionIds.length);
    }
});
(0, node_test_1.default)("a navigational scenario with no runtime inputs remains execution-ready", () => {
    const readiness = (0, canonical_recording_contract_1.evaluateRecordingReadiness)({
        functionalReadiness: true,
        technicalReadiness: true,
        oracleReadiness: true,
        runtimeInputRequirements: [],
    });
    strict_1.default.equal(readiness.dataReadiness, true);
    strict_1.default.equal(readiness.executionReadiness, true);
});
(0, node_test_1.default)("alternative mutation changes canonical dataset and no-effect intent is rejected", () => {
    const primary = (0, recording_store_1.loadScenarios)(appSlug, recordingId).find((scenario) => scenario.primary);
    strict_1.default.ok(primary);
    const selection = primary.canonicalInteractions?.find((interaction) => interaction.action === "select" && interaction.observedOptions?.includes("USD"));
    strict_1.default.ok(selection?.valueKey);
    const effectiveMutation = {
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
    const effective = (0, canonical_recording_contract_1.materializeScenarioMutation)(primary, effectiveMutation);
    const effectiveRequirement = effective.runtimeInputRequirements?.find((input) => input.valueKey === selection.valueKey);
    const effectiveStep = effective.testRailSteps.find((step) => step.interactionId === selection.id);
    strict_1.default.equal(effective.canonicalInteractions?.find((interaction) => interaction.id === selection.id)?.recordedValue, "USD");
    strict_1.default.equal(effectiveRequirement?.value, "USD");
    strict_1.default.equal(effectiveStep?.renderedStep, 'Seleccionar "USD" en "Ingresos"');
    strict_1.default.equal(effective.mutationDiagnostics?.rejectionReason, undefined);
    strict_1.default.equal(effective.replayEligible, true);
    const preview = (0, scenario_preview_types_1.toVirtualCase)((0, canonical_recording_contract_1.toSharedMcpScenario)(effective, appSlug), 0);
    strict_1.default.ok(preview.steps.includes('Seleccionar "USD" en "Ingresos"'));
    strict_1.default.equal(preview.recordingExecutionContract?.actions.find((action) => action.valueKey === selection.valueKey)?.value, "USD");
    const noEffect = (0, canonical_recording_contract_1.materializeScenarioMutation)(primary, {
        ...effectiveMutation,
        title: "Registrar usando una opción distinta",
        operations: [{ type: "replace_selection", interactionId: selection.id, value: selection.recordedValue ?? "" }],
    });
    strict_1.default.equal(noEffect.mutationDiagnostics?.rejectionReason, "MUTATION_NO_EFFECT");
    strict_1.default.equal(noEffect.title, primary.title);
    strict_1.default.equal(noEffect.replayEligible, false);
    strict_1.default.equal((0, canonical_recording_contract_1.toSharedMcpScenario)(noEffect, appSlug).mcpExecutable, false);
});
