import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTrace } from "./session-trace.types";
import {
  buildHappyPathScenario,
  deduplicateGoalSuggestions,
  filterGoalScopedSuggestions,
} from "./trace-to-scenario";
import {
  buildSemanticRecordingModel,
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
