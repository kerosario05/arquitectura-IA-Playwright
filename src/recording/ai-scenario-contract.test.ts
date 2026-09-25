import assert from "node:assert/strict";
import test from "node:test";
import { RECORDING_AI_SCENARIO_SCHEMA, validateRecordingAiScenarioResponse } from "./ai-scenario-contract";
import { buildCompactSemanticAiContext, enrichFromTrace } from "./trace-ai-enricher";
import type { AiProvider, AiCompletionResponse } from "../ai/ai-provider.types";
import type { SessionTrace } from "./session-trace.types";
import { buildHappyPathScenario } from "./trace-to-scenario";

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

test("accepts the canonical structured recording response", () => {
  const result = validateRecordingAiScenarioResponse({ scenarios: [proposal], rejected: [] });
  assert.equal(result.valid, true);
  assert.equal(result.value?.scenarios[0]?.type, "AI_PROPOSED");
  assert.equal(RECORDING_AI_SCENARIO_SCHEMA.required.join(","), "scenarios,rejected");
});

test("rejects the old story/negatives top-level shape deterministically", () => {
  const result = validateRecordingAiScenarioResponse({
    title: "Agregar varios colaboradores",
    description: "...",
    preconditions: [],
    negatives: [],
  });
  assert.equal(result.valid, false);
  assert.match(result.reason ?? "", /unknown keys|canonical|top-level/i);
});

test("compact AI context excludes the raw trace and materially reduces context", () => {
  const trace: SessionTrace = {
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
      kind: "fill" as const,
      screenKey: "grid",
      target: { label: "campo", role: "input", rowIdentity: "1", associatedField: "Ingresos", locators: [{ strategy: "css", value: `#amount-${index}` }] },
      value: `value-${index}`,
    })),
    screens: [{ screenKey: "grid", title: "grid", fingerprint: "fingerprint", firstSeenAt: 0, controls: [], texts: ["noise".repeat(1000)] }],
  };
  const happy = buildHappyPathScenario(trace, trace.events);
  const result = buildCompactSemanticAiContext(trace, [{ index: 0, screenKey: "grid", title: "grid", events: trace.events }], happy);
  assert.ok(result.afterChars < result.beforeChars);
  assert.equal(JSON.parse(result.context).recordingGoal, "Agregar varios colaboradores");
  assert.equal(JSON.parse(result.context).screens[0].fingerprint, undefined);
});

function fixtureTrace(): SessionTrace {
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

function providerReturning(parsedJson: Record<string, unknown>): AiProvider & { lastRequest?: Parameters<AiProvider["completeJson"]>[0] } {
  const provider: AiProvider & { lastRequest?: Parameters<AiProvider["completeJson"]>[0] } = {
    providerType: "fake",
    providerName: "fake",
    model: "test-model",
    async completeJson(request) {
      provider.lastRequest = request;
      return { rawText: JSON.stringify(parsedJson), parsedJson, model: "test-model", providerName: "fake", durationMs: 1 } satisfies AiCompletionResponse;
    },
  };
  return provider;
}

test("enricher accepts the canonical provider response and sends the same schema", async () => {
  const provider = providerReturning({ scenarios: [proposal], rejected: [] });
  const trace = fixtureTrace();
  const happy = buildHappyPathScenario(trace, trace.events);
  const result = await enrichFromTrace(trace, [{ index: 0, screenKey: "form", title: "Formulario", events: trace.events }], happy, provider);
  assert.equal(result.schemaValid, true);
  assert.equal(result.fallbackUsed, false);
  assert.equal(result.aiProposals.length, 1);
  assert.equal(provider.lastRequest?.jsonSchema?.name, "recording-ai-scenario-response");
});

test("enricher rejects a legacy provider shape and uses deterministic fallback", async () => {
  const provider = providerReturning({ title: "Historia", description: "legacy", preconditions: [], negatives: [] });
  const trace = fixtureTrace();
  const happy = buildHappyPathScenario(trace, trace.events);
  const result = await enrichFromTrace(trace, [{ index: 0, screenKey: "form", title: "Formulario", events: trace.events }], happy, provider);
  assert.equal(result.schemaValid, false);
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.aiProposals, []);
});
