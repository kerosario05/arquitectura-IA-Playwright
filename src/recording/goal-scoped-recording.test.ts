import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTrace } from "./session-trace.types";
import {
  buildHappyPathScenario,
  deduplicateGoalSuggestions,
  filterGoalScopedSuggestions,
  materializeRecordedScenario,
} from "./trace-to-scenario";
import {
  buildSemanticRecordingModel,
  hasSignificantSemanticChange,
  normalizeRecordingDataPolicy,
  normalizeRecordingGoal,
} from "./semantic-recording";
import { toPublishableScenario } from "./scenario-to-testrail";

function trace(overrides: Partial<SessionTrace> = {}): SessionTrace {
  return {
    recordingId: "recording-goal-test",
    projectSlug: "project-test",
    appSlug: "app-test",
    platform: "web",
    baseUrl: "https://app.test",
    label: "Fallback label",
    startedAt: new Date(0).toISOString(),
    status: "stopped",
    events: [],
    screens: [{
      screenKey: "screen-a",
      title: "Formulario",
      fingerprint: "technical-fingerprint",
      firstSeenAt: 0,
      controls: [],
      texts: ["Formulario"],
    }],
    ...overrides,
  };
}

function fillEvent(valueSource: "user" | "application" = "user") {
  return {
    seq: 0,
    t: 1,
    kind: "fill" as const,
    screenKey: "screen-a",
    value: valueSource === "application" ? "derived" : "input",
    valueSource,
    target: {
      label: valueSource === "application" ? "Nombre resultante" : "Nombre cliente",
      role: "textbox",
      locators: [{ strategy: "aria-label", value: valueSource === "application" ? "result" : "name" }],
    },
  };
}

test("recording goal is explicit and keeps its declared authority", () => {
  const goal = normalizeRecordingGoal("  Crear   cliente. ");
  assert.deepEqual(goal, {
    declaredGoal: "Crear cliente.",
    normalizedGoal: "Crear cliente",
    provenance: "USER_DECLARED",
    needsReview: false,
  });
});

test("one goal produces one primary scenario from the complete trace", () => {
  const current = trace({
    recordingGoal: normalizeRecordingGoal("Crear cliente"),
    events: [fillEvent()],
  });
  const primary = buildHappyPathScenario(current, current.events);
  assert.equal(primary.primary, true);
  assert.equal(primary.title, "Crear cliente");
  assert.equal(primary.containsUnexecutedActions, false);
  assert.equal(primary.traceBacked, true);
});

test("irrelevant controls are rejected while relevant alternatives remain candidates", () => {
  const irrelevant = buildHappyPathScenario(trace(), []);
  const related = { ...irrelevant, title: "Tipo de cliente", requiredData: [], testRailSteps: [{ content: "Elegir tipo de cliente", expected: "Aceptado" }] };
  const unrelated = { ...irrelevant, title: "Ayuda", requiredData: [], testRailSteps: [{ content: "Abrir ayuda", expected: "Se muestra ayuda" }] };
  const result = filterGoalScopedSuggestions("Crear cliente", [related, unrelated]);
  assert.equal(result.suggestions.length, 1);
  assert.equal(result.irrelevantCandidatesRejected, 1);
  assert.equal(result.suggestions[0].primary, false);
  assert.ok((result.suggestions[0].goalRelevanceScore ?? 0) >= 0.35);
});

test("semantic identity deduplicates wording variants", () => {
  const base = buildHappyPathScenario(trace(), []);
  const one = { ...base, title: "Tipo de cliente", testRailSteps: [{ content: "Elegir tipo de cliente", expected: "ok" }] };
  const two = { ...base, title: "Seleccionar tipo cliente", testRailSteps: [{ content: "Elegir tipo de cliente", expected: "ok" }] };
  assert.equal(deduplicateGoalSuggestions([one, two]).duplicatesRemoved, 1);
});

test("partial traces remain usable and application changes are derived outputs", () => {
  const current = trace({
    recordingGoal: normalizeRecordingGoal("Crear cliente"),
    events: [fillEvent("user"), { ...fillEvent("application"), seq: 1, dependsOnEventRef: "event-1" }],
  });
  const model = buildSemanticRecordingModel(current, current.events);
  assert.equal(model.semanticEvents.length, 2);
  assert.equal(model.datasets.find((item) => item.valueRole === "runtime_derived_oracle")?.source, "OBSERVED");
  assert.deepEqual(model.datasets.find((item) => item.valueRole === "runtime_derived_oracle")?.dependsOn, ["nombre_cliente"]);
});

test("QA credential persistence is project-scoped and opt-in", () => {
  assert.deepEqual(normalizeRecordingDataPolicy(), {
    persistRecordedValues: true,
    persistQaCredentials: false,
    includeQaCredentialsInTestRail: false,
  });
  assert.deepEqual(normalizeRecordingDataPolicy({ persistQaCredentials: true, includeQaCredentialsInTestRail: true }), {
    persistRecordedValues: true,
    persistQaCredentials: true,
    includeQaCredentialsInTestRail: true,
  });
});

test("TestRail preview keeps the primary first and applies credential policy", () => {
  const primary = buildHappyPathScenario(trace({ recordingGoal: normalizeRecordingGoal("Crear cliente") }), []);
  primary.requiredData.push({ key: "auth_password", label: "Password", stepIndex: 1, sensitive: true, exampleValue: "fixture-only" });
  const referenceOnly = toPublishableScenario(primary, "app-test", "recording-goal-test", normalizeRecordingDataPolicy());
  const allowed = toPublishableScenario(primary, "app-test", "recording-goal-test", normalizeRecordingDataPolicy({
    persistQaCredentials: true,
    includeQaCredentialsInTestRail: true,
  }));
  assert.equal(referenceOnly.dataRequirements, "auth_password");
  assert.equal(allowed.dataRequirements, "auth_password=fixture-only");
  assert.equal(primary.primary, true);
});

test("human preview uses rendered values while the execution template stays key-based", () => {
  const current = trace({
    recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: true },
    events: [{
      ...fillEvent(),
      target: { ...fillEvent().target, label: "Identificador", locators: [{ strategy: "aria-label", value: "Identificador" }] },
      value: "ABC123",
    }],
  });
  const scenario = buildHappyPathScenario(current, current.events);
  const preview = toPublishableScenario(scenario, "app-test", "recording-goal-test", current.recordingDataPolicy);
  assert.equal(scenario.webSteps[1]?.value, undefined);
  assert.equal(scenario.webSteps[1]?.valueKey, "identificador");
  assert.match(preview.steps[1], /ABC123/);
  assert.match(preview.steps[1], /Esperado:/);
});

test("TestRail uses rendered values only when the credential policy allows it", () => {
  const baseEvent = fillEvent();
  const event = {
    ...baseEvent,
    value: "fixture-secret",
    target: { ...baseEvent.target, label: "Contraseña", inputType: "password" },
  };
  const protectedTrace = trace({
    events: [event],
    recordingDataPolicy: normalizeRecordingDataPolicy(),
  });
  const protectedScenario = buildHappyPathScenario(protectedTrace, protectedTrace.events);
  const protectedPreview = toPublishableScenario(protectedScenario, "app-test", "recording-goal-test", protectedTrace.recordingDataPolicy);
  assert.ok(protectedPreview.steps.every((step) => !step.includes("fixture-secret")));

  const allowedTrace = trace({
    events: [event],
    recordingDataPolicy: normalizeRecordingDataPolicy({ persistQaCredentials: true, includeQaCredentialsInTestRail: true }),
  });
  const allowedScenario = buildHappyPathScenario(allowedTrace, allowedTrace.events);
  const allowedPreview = toPublishableScenario(allowedScenario, "app-test", "recording-goal-test", allowedTrace.recordingDataPolicy);
  assert.ok(allowedPreview.steps.some((step) => step.includes("fixture-secret")));
});

test("selection values are materialized without replacing the runtime target", () => {
  const current = trace({
    events: [{
      seq: 0,
      t: 1,
      kind: "tap",
      screenKey: "screen-a",
      target: {
        label: "Moneda",
        role: "combobox",
        associatedField: "currency",
        afterValue: "DOP",
        locators: [{ strategy: "role", value: "combobox|Moneda" }],
      },
    }],
  });
  const scenario = buildHappyPathScenario(current, current.events);
  assert.equal(scenario.webSteps[1]?.value, undefined);
  assert.equal(scenario.webSteps[1]?.valueKey, "currency");
  assert.match(scenario.testRailSteps[1]?.content ?? "", /\[currency\]/);
  assert.match(scenario.testRailSteps[1]?.renderedStep ?? "", /DOP/);
});

test("editing the confirmed dataset updates rendered steps without changing the template", () => {
  const current = trace({
    events: [fillEvent()],
  });
  const scenario = buildHappyPathScenario(current, current.events);
  const original = scenario.testRailSteps[1];
  const edited = materializeRecordedScenario(scenario, { nombre_cliente: "valor-editado" });
  assert.equal(original?.stepTemplate, 'Ingresar [nombre_cliente] en "Nombre cliente"');
  assert.equal(edited.testRailSteps[1]?.stepTemplate, original?.stepTemplate);
  assert.equal(edited.testRailSteps[1]?.renderedStep, 'Ingresar "valor-editado" en "Nombre cliente"');
});

test("live refresh ignores non-semantic polling noise", () => {
  const base = { events: [fillEvent()], screens: trace().screens };
  const noisy = { events: [{ ...fillEvent(), target: { ...fillEvent().target, beforeValue: "old", afterValue: "input" } }], screens: trace().screens };
  const meaningful = { events: [{ ...fillEvent(), seq: 1, t: 50, target: { ...fillEvent().target, label: "Correo" } }], screens: trace().screens };
  assert.equal(hasSignificantSemanticChange(undefined, base), true);
  assert.equal(hasSignificantSemanticChange(base, noisy), false);
  assert.equal(hasSignificantSemanticChange(base, meaningful), true);
});
