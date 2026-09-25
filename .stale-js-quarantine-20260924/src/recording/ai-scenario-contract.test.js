"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const ai_scenario_contract_1 = require("./ai-scenario-contract");
const trace_ai_enricher_1 = require("./trace-ai-enricher");
const trace_to_scenario_1 = require("./trace-to-scenario");
const proposal = {
    title: "Validar colaborador sin correo",
    type: "AI_PROPOSED",
    rationale: "El campo de correo fue observado en el modelo semántico.",
    preconditions: ["La pantalla de colaboradores está abierta"],
    sharedSetupRef: "REC-PRIMARY",
    goalRelated: true,
    scenarioSpecificSteps: [{ content: "Usar una variante respaldada", expected: "Resultado por confirmar" }],
    steps: [{ content: "Dejar vacío Correo electrónico", expected: "Se muestra la validación del campo" }],
    expectedResultCandidate: "La aplicación mantiene el formulario y muestra una validación.",
    oracleAuthority: "AI_HYPOTHESIS",
    hypothesis: true,
    needsReview: true,
    sourceEvidenceRefs: ["event-7"],
    confidence: 0.82,
};
(0, node_test_1.default)("accepts the canonical structured recording response", () => {
    const result = (0, ai_scenario_contract_1.validateRecordingAiScenarioResponse)({ scenarios: [proposal], rejected: [] });
    strict_1.default.equal(result.valid, true);
    strict_1.default.equal(result.value?.scenarios[0]?.type, "AI_PROPOSED");
    strict_1.default.equal(ai_scenario_contract_1.RECORDING_AI_SCENARIO_SCHEMA.required.join(","), "scenarios,rejected");
});
(0, node_test_1.default)("rejects the old story/negatives top-level shape deterministically", () => {
    const result = (0, ai_scenario_contract_1.validateRecordingAiScenarioResponse)({
        title: "Agregar varios colaboradores",
        description: "...",
        preconditions: [],
        negatives: [],
    });
    strict_1.default.equal(result.valid, false);
    strict_1.default.match(result.reason ?? "", /unknown keys|canonical|top-level/i);
});
(0, node_test_1.default)("compact AI context excludes the raw trace and materially reduces context", () => {
    const trace = {
        recordingId: "compact-fixture",
        projectSlug: "fixture",
        appSlug: "fixture",
        platform: "web",
        recordingGoal: { declaredGoal: "Agregar varios colaboradores", normalizedGoal: "Agregar varios colaboradores", provenance: "USER_DECLARED", needsReview: false },
        startedAt: new Date(0).toISOString(),
        status: "stopped",
        events: Array.from({ length: 40 }, (_, index) => ({
            seq: index,
            t: index,
            kind: "fill",
            screenKey: "grid",
            target: { label: "campo", role: "input", rowIdentity: "1", associatedField: "Ingresos", locators: [{ strategy: "css", value: `#amount-${index}` }] },
            value: `value-${index}`,
        })),
        screens: [{ screenKey: "grid", title: "grid", fingerprint: "fingerprint", firstSeenAt: 0, controls: [], texts: ["noise".repeat(1000)] }],
    };
    const happy = (0, trace_to_scenario_1.buildHappyPathScenario)(trace, trace.events);
    const result = (0, trace_ai_enricher_1.buildCompactSemanticAiContext)(trace, [{ index: 0, screenKey: "grid", title: "grid", events: trace.events }], happy);
    strict_1.default.ok(result.afterChars < result.beforeChars);
    strict_1.default.equal(JSON.parse(result.context).recordingGoal, "Agregar varios colaboradores");
    strict_1.default.equal(JSON.parse(result.context).screens[0].fingerprint, undefined);
});
function fixtureTrace() {
    return {
        recordingId: "ai-contract-fixture",
        projectSlug: "fixture",
        appSlug: "fixture",
        platform: "web",
        recordingGoal: { declaredGoal: "Agregar colaboradores", normalizedGoal: "Agregar colaboradores", provenance: "USER_DECLARED", needsReview: false },
        startedAt: new Date(0).toISOString(),
        status: "stopped",
        events: [{
                seq: 0,
                t: 0,
                kind: "fill",
                screenKey: "form",
                target: { label: "Nombre", role: "textbox", associatedField: "Nombre", locators: [{ strategy: "css", value: "#name" }] },
                value: "Ana",
            }],
        screens: [{ screenKey: "form", title: "Formulario", fingerprint: "ignored", firstSeenAt: 0, controls: [], texts: [] }],
    };
}
function providerReturning(parsedJson) {
    const provider = {
        providerType: "fake",
        providerName: "fake",
        model: "test-model",
        async completeJson(request) {
            provider.lastRequest = request;
            return { rawText: JSON.stringify(parsedJson), parsedJson, model: "test-model", providerName: "fake", durationMs: 1 };
        },
    };
    return provider;
}
(0, node_test_1.default)("enricher accepts the canonical provider response and sends the same schema", async () => {
    const provider = providerReturning({ scenarios: [proposal], rejected: [] });
    const trace = fixtureTrace();
    const happy = (0, trace_to_scenario_1.buildHappyPathScenario)(trace, trace.events);
    const result = await (0, trace_ai_enricher_1.enrichFromTrace)(trace, [{ index: 0, screenKey: "form", title: "Formulario", events: trace.events }], happy, provider);
    strict_1.default.equal(result.schemaValid, true);
    strict_1.default.equal(result.fallbackUsed, false);
    strict_1.default.equal(result.aiProposals.length, 1);
    strict_1.default.equal(provider.lastRequest?.jsonSchema?.name, "recording-ai-scenario-response");
});
(0, node_test_1.default)("enricher rejects a legacy provider shape and uses deterministic fallback", async () => {
    const provider = providerReturning({ title: "Historia", description: "legacy", preconditions: [], negatives: [] });
    const trace = fixtureTrace();
    const happy = (0, trace_to_scenario_1.buildHappyPathScenario)(trace, trace.events);
    const result = await (0, trace_ai_enricher_1.enrichFromTrace)(trace, [{ index: 0, screenKey: "form", title: "Formulario", events: trace.events }], happy, provider);
    strict_1.default.equal(result.schemaValid, false);
    strict_1.default.equal(result.fallbackUsed, true);
    strict_1.default.deepEqual(result.aiProposals, []);
});
