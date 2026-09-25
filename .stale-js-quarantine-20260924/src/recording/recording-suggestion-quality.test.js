"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const trace_to_scenario_1 = require("./trace-to-scenario");
function trace(withConstraint = false) {
    return {
        recordingId: "quality-fixture",
        projectSlug: "fixture",
        appSlug: "fixture",
        platform: "web",
        baseUrl: "https://app.test",
        recordingGoal: { declaredGoal: "Agregar varios colaboradores", normalizedGoal: "Agregar varios colaboradores", provenance: "USER_DECLARED", needsReview: false },
        startedAt: new Date(0).toISOString(),
        status: "stopped",
        events: [
            {
                seq: 0,
                t: 0,
                kind: "fill",
                screenKey: "form",
                target: { label: "Fecha de ingreso", associatedField: "Fecha de ingreso", role: "input", ...(withConstraint ? { attributes: { pattern: "\\d{4}-\\d{2}-\\d{2}" } } : {}), locators: [{ strategy: "css", value: "#date" }] },
                value: "2025-01-01",
            },
            { seq: 1, t: 1, kind: "tap", screenKey: "form", target: { label: "Validar", role: "button", locators: [{ strategy: "text", value: "Validar" }] } },
        ],
        screens: [{ screenKey: "form", title: "Colaboradores", fingerprint: "ignored", firstSeenAt: 0, controls: [{ label: "Validar", role: "button", locators: [{ strategy: "text", value: "Validar" }] }], texts: [] }],
    };
}
function proposal(overrides = {}) {
    return {
        title: "Agregar colaboradores: alternativa observada",
        type: "DERIVED_ALTERNATIVE",
        rationale: "La variante conserva el objetivo del recorrido.",
        preconditions: ["La aplicación está disponible"],
        sharedSetupRef: "REC-QUALITY-01",
        goalRelated: true,
        scenarioSpecificSteps: [{ content: 'Presionar "Validar"', expected: "Resultado por confirmar" }],
        steps: [
            { content: "Abrir la aplicación configurada del proyecto", expected: "La aplicación carga su pantalla inicial" },
            { content: 'Presionar "Validar"', expected: "Resultado por confirmar" },
        ],
        expectedResultCandidate: "Resultado por confirmar",
        oracleAuthority: "AI_HYPOTHESIS",
        hypothesis: true,
        needsReview: true,
        sourceEvidenceRefs: ["event-2"],
        confidence: 0.7,
        ...overrides,
    };
}
function primaryFor(current) {
    return (0, trace_to_scenario_1.buildHappyPathScenario)(current, current.events);
}
(0, node_test_1.default)("observed alternative inherits the Primary setup and materializes a complete preview", () => {
    const current = trace();
    const primary = primaryFor(current);
    const candidate = proposal({ sharedSetupRef: primary.scenarioId });
    const quality = (0, trace_to_scenario_1.evaluateRecordingSuggestionQuality)(current.recordingGoal?.declaredGoal, current, primary, candidate);
    strict_1.default.equal(quality.finalDecision, "accepted");
    const materialized = (0, trace_to_scenario_1.materializeRecordingSuggestion)(primary, candidate, quality);
    strict_1.default.equal(materialized.sharedSetupRef, primary.scenarioId);
    strict_1.default.equal(materialized.testRailSteps[0]?.content, primary.testRailSteps[0]?.content);
    strict_1.default.ok(materialized.testRailSteps.some((step) => step.content.includes('Presionar "Validar"')));
});
(0, node_test_1.default)("field existence alone cannot create an invalid-format negative", () => {
    const current = trace();
    const primary = primaryFor(current);
    const candidate = proposal({
        sharedSetupRef: primary.scenarioId,
        type: "DERIVED_VALIDATION",
        title: "Agregar colaboradores: validar fecha de ingreso con formato inválido",
        scenarioSpecificSteps: [{ content: 'Ingresar un formato inválido en "Fecha de ingreso"', expected: "El sistema rechaza el valor" }],
        steps: [{ content: "Abrir la aplicación configurada del proyecto", expected: "La aplicación carga su pantalla inicial" }, { content: 'Ingresar un formato inválido en "Fecha de ingreso"', expected: "El sistema rechaza el valor" }],
        expectedResultCandidate: "El sistema rechaza el valor",
        sourceEvidenceRefs: ["event-1"],
    });
    const quality = (0, trace_to_scenario_1.evaluateRecordingSuggestionQuality)(current.recordingGoal?.declaredGoal, current, primary, candidate);
    strict_1.default.equal(quality.finalDecision, "rejected");
    strict_1.default.equal(quality.rejectionReason, "generic_negative_without_constraint_or_validation_evidence");
});
(0, node_test_1.default)("a constraint-backed validation is accepted with its declared authority", () => {
    const current = trace(true);
    const primary = primaryFor(current);
    const candidate = proposal({
        sharedSetupRef: primary.scenarioId,
        type: "DERIVED_VALIDATION",
        title: "Agregar colaboradores: validar fecha de ingreso",
        oracleAuthority: "CONSTRAINT_BACKED",
        hypothesis: false,
        needsReview: false,
        scenarioSpecificSteps: [{ content: 'Ingresar un valor fuera del patrón en "Fecha de ingreso"', expected: "Se muestra la validación del campo" }],
        steps: [{ content: "Abrir la aplicación configurada del proyecto", expected: "La aplicación carga su pantalla inicial" }, { content: 'Ingresar un valor fuera del patrón en "Fecha de ingreso"', expected: "Se muestra la validación del campo" }],
        expectedResultCandidate: "Se muestra la validación del campo",
        sourceEvidenceRefs: ["event-1"],
    });
    const quality = (0, trace_to_scenario_1.evaluateRecordingSuggestionQuality)(current.recordingGoal?.declaredGoal, current, primary, candidate);
    strict_1.default.equal(quality.finalDecision, "accepted");
    strict_1.default.equal(quality.noUnsupportedExpectedResult, true);
});
(0, node_test_1.default)("an authoritative rejection without evidence is blocked, while a reviewed hypothesis stays explicit", () => {
    const current = trace();
    const primary = primaryFor(current);
    const unsupported = proposal({
        sharedSetupRef: primary.scenarioId,
        type: "DERIVED_ALTERNATIVE",
        oracleAuthority: "OBSERVED",
        hypothesis: false,
        needsReview: false,
        expectedResultCandidate: "El sistema rechaza el valor y solicita corregirlo",
        sourceEvidenceRefs: ["event-1"],
    });
    const quality = (0, trace_to_scenario_1.evaluateRecordingSuggestionQuality)(current.recordingGoal?.declaredGoal, current, primary, unsupported);
    strict_1.default.equal(quality.finalDecision, "rejected");
    strict_1.default.equal(quality.rejectionReason, "unsupported_authoritative_expected_result");
    const reviewed = proposal({
        sharedSetupRef: primary.scenarioId,
        expectedResultCandidate: "El sistema rechaza el valor y solicita corregirlo",
        oracleAuthority: "AI_HYPOTHESIS",
        hypothesis: true,
        needsReview: true,
    });
    const reviewedQuality = (0, trace_to_scenario_1.evaluateRecordingSuggestionQuality)(current.recordingGoal?.declaredGoal, current, primary, reviewed);
    strict_1.default.equal(reviewedQuality.finalDecision, "accepted");
    strict_1.default.equal(reviewedQuality.hasOracleAuthorityOrReview, true);
    strict_1.default.equal((0, trace_to_scenario_1.materializeRecordingSuggestion)(primary, reviewed, reviewedQuality).testRailSteps.at(-1)?.expected, "Resultado por confirmar: la grabación no observó esta variante");
});
(0, node_test_1.default)("vague mid-flow setup and unrelated navigation are rejected", () => {
    const current = trace();
    const primary = primaryFor(current);
    const vague = proposal({ sharedSetupRef: primary.scenarioId, scenarioSpecificSteps: [{ content: "Completar los demás campos", expected: "ok" }], steps: [{ content: "Abrir la aplicación configurada del proyecto", expected: "ok" }, { content: "Completar los demás campos", expected: "ok" }] });
    const unrelated = proposal({ sharedSetupRef: primary.scenarioId, title: "Abrir ayuda", goalRelated: false, scenarioSpecificSteps: [{ content: "Presionar \"Ayuda\"", expected: "Se abre ayuda" }], steps: [{ content: "Abrir la aplicación configurada del proyecto", expected: "ok" }, { content: "Presionar \"Ayuda\"", expected: "Se abre ayuda" }], sourceEvidenceRefs: ["event-2"] });
    strict_1.default.equal((0, trace_to_scenario_1.evaluateRecordingSuggestionQuality)(current.recordingGoal?.declaredGoal, current, primary, vague).finalDecision, "rejected");
    strict_1.default.equal((0, trace_to_scenario_1.evaluateRecordingSuggestionQuality)(current.recordingGoal?.declaredGoal, current, primary, unrelated).finalDecision, "rejected");
});
