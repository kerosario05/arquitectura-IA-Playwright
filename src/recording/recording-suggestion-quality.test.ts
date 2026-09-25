import assert from "node:assert/strict";
import test from "node:test";
import { buildHappyPathScenario, evaluateRecordingSuggestionQuality, materializeRecordingSuggestion, type RecordedScenario } from "./trace-to-scenario";
import type { RecordingAiScenarioProposal } from "./ai-scenario-contract";
import type { SessionTrace } from "./session-trace.types";

function trace(withConstraint = false): SessionTrace {
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

function proposal(overrides: Partial<RecordingAiScenarioProposal> = {}): RecordingAiScenarioProposal {
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

function primaryFor(current: SessionTrace): RecordedScenario {
  return buildHappyPathScenario(current, current.events);
}

test("observed alternative inherits the Primary setup and materializes a complete preview", () => {
  const current = trace();
  const primary = primaryFor(current);
  const candidate = proposal({ sharedSetupRef: primary.scenarioId });
  const quality = evaluateRecordingSuggestionQuality(current.recordingGoal?.declaredGoal, current, primary, candidate);
  assert.equal(quality.finalDecision, "accepted");
  const materialized = materializeRecordingSuggestion(primary, candidate, quality);
  assert.equal(materialized.sharedSetupRef, primary.scenarioId);
  assert.equal(materialized.testRailSteps[0]?.content, primary.testRailSteps[0]?.content);
  assert.ok(materialized.testRailSteps.some((step) => step.content.includes('Presionar "Validar"')));
});

test("field existence alone cannot create an invalid-format negative", () => {
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
  const quality = evaluateRecordingSuggestionQuality(current.recordingGoal?.declaredGoal, current, primary, candidate);
  assert.equal(quality.finalDecision, "rejected");
  assert.equal(quality.rejectionReason, "generic_negative_without_constraint_or_validation_evidence");
});

test("a constraint-backed validation is accepted with its declared authority", () => {
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
  const quality = evaluateRecordingSuggestionQuality(current.recordingGoal?.declaredGoal, current, primary, candidate);
  assert.equal(quality.finalDecision, "accepted");
  assert.equal(quality.noUnsupportedExpectedResult, true);
});

test("an authoritative rejection without evidence is blocked, while a reviewed hypothesis stays explicit", () => {
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
  const quality = evaluateRecordingSuggestionQuality(current.recordingGoal?.declaredGoal, current, primary, unsupported);
  assert.equal(quality.finalDecision, "rejected");
  assert.equal(quality.rejectionReason, "unsupported_authoritative_expected_result");

  const reviewed = proposal({
    sharedSetupRef: primary.scenarioId,
    expectedResultCandidate: "El sistema rechaza el valor y solicita corregirlo",
    oracleAuthority: "AI_HYPOTHESIS",
    hypothesis: true,
    needsReview: true,
  });
  const reviewedQuality = evaluateRecordingSuggestionQuality(current.recordingGoal?.declaredGoal, current, primary, reviewed);
  assert.equal(reviewedQuality.finalDecision, "accepted");
  assert.equal(reviewedQuality.hasOracleAuthorityOrReview, true);
  assert.equal(materializeRecordingSuggestion(primary, reviewed, reviewedQuality).testRailSteps.at(-1)?.expected, "Resultado por confirmar: la grabación no observó esta variante");
});

test("vague mid-flow setup and unrelated navigation are rejected", () => {
  const current = trace();
  const primary = primaryFor(current);
  const vague = proposal({ sharedSetupRef: primary.scenarioId, scenarioSpecificSteps: [{ content: "Completar los demás campos", expected: "ok" }], steps: [{ content: "Abrir la aplicación configurada del proyecto", expected: "ok" }, { content: "Completar los demás campos", expected: "ok" }] });
  const unrelated = proposal({ sharedSetupRef: primary.scenarioId, title: "Abrir ayuda", goalRelated: false, scenarioSpecificSteps: [{ content: "Presionar \"Ayuda\"", expected: "Se abre ayuda" }], steps: [{ content: "Abrir la aplicación configurada del proyecto", expected: "ok" }, { content: "Presionar \"Ayuda\"", expected: "Se abre ayuda" }], sourceEvidenceRefs: ["event-2"] });
  assert.equal(evaluateRecordingSuggestionQuality(current.recordingGoal?.declaredGoal, current, primary, vague).finalDecision, "rejected");
  assert.equal(evaluateRecordingSuggestionQuality(current.recordingGoal?.declaredGoal, current, primary, unrelated).finalDecision, "rejected");
});
