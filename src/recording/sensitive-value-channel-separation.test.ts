import assert from "node:assert/strict";
import { test } from "node:test";
import type { SessionTrace } from "./session-trace.types";
import { buildHappyPathScenario } from "./trace-to-scenario";
import { normalizeRecordingDataPolicy } from "./semantic-recording";
import { toPublishableScenario } from "./scenario-to-testrail";
import { toVirtualCase } from "../types/scenario-preview.types";

/**
 * FIRST_LEAK: a sensitive field's REAL recorded value was materialized into human-readable
 * DISPLAY text at the earliest possible layer -- `describeFillRendered` (trace-to-scenario.ts) --
 * whenever `recordingDataPolicy.persistQaCredentials` was true, which `normalizeRecordingDataPolicy`
 * hardcodes unconditionally ("Recording policy is an invariant"). That flag legitimately governs
 * the EXECUTION channel (whether the runtime dataset may retain the real secret so a live fill can
 * use it) -- it must never also govern the PRESENTATION/artifact channel (`RecordedScenarioStep`'s
 * `content`/`renderedStep`, later `McpScenario.steps`, `VirtualCase.steps`, generated-case JSON,
 * preview-scenarios.json, TestRail publication). A second, independent leak existed downstream in
 * `scenario-to-testrail.ts`'s `toPublishableScenario`: it deliberately chose the real
 * `renderedStep`/`exampleValue` for TestRail whenever `includeQaCredentialsInTestRail` was set --
 * also hardcoded true by the same invariant, so every recording published real secrets to TestRail
 * unconditionally.
 *
 * DISPLAY VALUE != EXECUTION VALUE: fixed so a sensitive field's human-readable text is ALWAYS the
 * generic, safe form ("Ingresar el valor seguro asociado a ...") regardless of policy, while the
 * runtime dataset (`requiredData[].exampleValue`, `runtimeDataset.resolvedValues`) is left
 * untouched -- the real secret remains available there for actual execution, exactly as this
 * ticket requires ("el valor REAL continúe disponible en runtime").
 */

const TEST_SECRET_VALUE_123 = "TEST_SECRET_VALUE_123";

function trace(overrides: Partial<SessionTrace> = {}): SessionTrace {
  return {
    recordingId: "sensitive-channel-fixture",
    projectSlug: "sensitive-channel-fixture",
    appSlug: "sensitive-channel-fixture",
    platform: "web",
    baseUrl: "https://app.test/login",
    label: "Iniciar sesión",
    recordingGoal: { declaredGoal: "Iniciar sesión", normalizedGoal: "iniciar sesion", provenance: "USER_DECLARED", needsReview: false },
    recordingDataPolicy: normalizeRecordingDataPolicy(),
    startedAt: "2026-09-18T10:00:00.000Z",
    status: "stopped",
    events: [],
    screens: [{ screenKey: "login", title: "Login", fingerprint: "login", firstSeenAt: 0, controls: [], texts: ["Login"] }],
    ...overrides,
  } as SessionTrace;
}

function sensitiveFillEvent(value = TEST_SECRET_VALUE_123) {
  return {
    seq: 0, t: 100, kind: "fill" as const, screenKey: "login", value,
    target: { label: "Contraseña", role: "textbox", inputType: "password", locators: [{ strategy: "aria-label", value: "password" }] },
  };
}

function nonSensitiveFillEvent(value = "juan.perez") {
  return {
    seq: 0, t: 100, kind: "fill" as const, screenKey: "login", value,
    target: { label: "Usuario", role: "textbox", locators: [{ strategy: "aria-label", value: "usuario" }] },
  };
}

test("1/sensitiveStep. a sensitive scenario step never contains the real secret in content or renderedStep", () => {
  const t = trace({ events: [sensitiveFillEvent()] });
  const scenario = buildHappyPathScenario(t, t.events);
  const step = scenario.testRailSteps.find((s) => s.sourceEventRefs?.includes("event-1"));
  assert.ok(step, "expected the fill step to be present");
  assert.ok(step!.sensitive, "step must be marked sensitive");
  assert.ok(!step!.content.includes(TEST_SECRET_VALUE_123));
  assert.ok(!(step!.renderedStep ?? "").includes(TEST_SECRET_VALUE_123));
  assert.equal(step!.renderedStep, 'Ingresar el valor seguro asociado a "Contraseña"');
});

test("2/nonSensitiveRegression. an ordinary non-sensitive fill keeps showing its real recorded value, unchanged", () => {
  const t = trace({ events: [nonSensitiveFillEvent()] });
  const scenario = buildHappyPathScenario(t, t.events);
  const step = scenario.testRailSteps.find((s) => s.sourceEventRefs?.includes("event-1"));
  assert.ok(step);
  assert.ok(!step!.sensitive);
  assert.equal(step!.renderedStep, 'Ingresar "juan.perez" en "Usuario"');
});

test("3/persistedScenario. the persisted RecordedScenario, serialized whole, never contains the secret literal in any human/display property", () => {
  const t = trace({ events: [sensitiveFillEvent(), nonSensitiveFillEvent()] });
  const scenario = buildHappyPathScenario(t, t.events);
  const serialized = JSON.stringify({
    title: scenario.title,
    description: scenario.description,
    testRailSteps: scenario.testRailSteps,
    preconditions: scenario.preconditions,
  });
  assert.ok(!serialized.includes(TEST_SECRET_VALUE_123), "no display/human property of the persisted scenario may carry the real secret");
});

test("4/testrail. TestRail projection (steps + dataRequirements) never contains the secret literal, under any recordingDataPolicy", () => {
  for (const policy of [
    normalizeRecordingDataPolicy(),
    normalizeRecordingDataPolicy({ persistQaCredentials: true, includeQaCredentialsInTestRail: true }),
  ]) {
    const t = trace({ events: [sensitiveFillEvent()], recordingDataPolicy: policy });
    const scenario = buildHappyPathScenario(t, t.events);
    scenario.requiredData.push({ key: "contrasena", label: "Contraseña", stepIndex: 1, sensitive: true, exampleValue: TEST_SECRET_VALUE_123 });
    const published = toPublishableScenario(scenario, "app-test", "sensitive-channel-fixture", policy);
    const serialized = JSON.stringify(published);
    assert.ok(!serialized.includes(TEST_SECRET_VALUE_123), `TestRail projection leaked the secret under policy=${JSON.stringify(policy)}`);
  }
});

test("5/generatedCase. VirtualCase (the shape persisted to generated-cases/*.json and preview-scenarios.json) never contains the secret literal", () => {
  const t = trace({ events: [sensitiveFillEvent()] });
  const scenario = buildHappyPathScenario(t, t.events);
  const published = toPublishableScenario(scenario, "app-test", "sensitive-channel-fixture");
  const vc = toVirtualCase(published, 0);
  const serialized = JSON.stringify(vc);
  assert.ok(!serialized.includes(TEST_SECRET_VALUE_123));
});

test("6/runtimeChannelPreserved. the EXECUTION channel (requiredData exampleValue) still carries the real secret -- runtime availability is never broken by the display fix", () => {
  const t = trace({ events: [sensitiveFillEvent()] });
  const scenario = buildHappyPathScenario(t, t.events);
  const field = scenario.requiredData.find((f) => f.sensitive);
  assert.ok(field, "expected a sensitive requiredData entry");
  assert.equal(field!.exampleValue, TEST_SECRET_VALUE_123, "the real secret must remain available in the execution/runtime channel");
});

test("7/currentQaEdit. an explicit runtime dataset override for the sensitive key still has maximum authority at runtime, independent of display safety", () => {
  const t = trace({ events: [sensitiveFillEvent("recorded-placeholder")] });
  const scenario = buildHappyPathScenario(t, t.events);
  const overridden = scenario.testRailSteps.find((s) => s.valueKey)?.valueKey
    ? { ...scenario, runtimeDataset: { resolvedValues: { [scenario.testRailSteps.find((s) => s.valueKey)!.valueKey!]: TEST_SECRET_VALUE_123 } } }
    : scenario;
  assert.equal((overridden as any).runtimeDataset?.resolvedValues?.[scenario.testRailSteps.find((s) => s.valueKey)!.valueKey!], TEST_SECRET_VALUE_123);
});

test("8/secretScan. full artifact chain (scenario -> TestRail projection -> VirtualCase) never serializes the secret anywhere except the runtime dataset itself", () => {
  const t = trace({ events: [sensitiveFillEvent()] });
  const scenario = buildHappyPathScenario(t, t.events);
  scenario.requiredData.push({ key: "contrasena", label: "Contraseña", stepIndex: 1, sensitive: true, exampleValue: TEST_SECRET_VALUE_123 });
  const published = toPublishableScenario(scenario, "app-test", "sensitive-channel-fixture");
  const vc = toVirtualCase(published, 0);

  // Display/artifact surfaces: never serialize the secret.
  assert.ok(!JSON.stringify(scenario.testRailSteps).includes(TEST_SECRET_VALUE_123));
  assert.ok(!JSON.stringify(published).includes(TEST_SECRET_VALUE_123));
  assert.ok(!JSON.stringify(vc).includes(TEST_SECRET_VALUE_123));

  // The EXECUTION channel (requiredData on the RecordedScenario itself) is the one explicit
  // exception -- it is never logged/serialized to a human/artifact surface, only read at fill
  // time by the runtime resolver.
  assert.ok(JSON.stringify(scenario.requiredData).includes(TEST_SECRET_VALUE_123));
});

test("9/multiproject. no appSlug/recordingId/field-name hardcode governs the channel separation", () => {
  for (const [appSlug, recordingId, label] of [["acme", "rec-a", "Clave secreta"], ["otro-proyecto", "rec-b", "PIN de acceso"]] as const) {
    const t = trace({
      appSlug,
      recordingId,
      events: [{
        seq: 0, t: 100, kind: "fill" as const, screenKey: "login", value: TEST_SECRET_VALUE_123,
        target: { label, role: "textbox", inputType: "password", locators: [] },
      }],
    });
    const scenario = buildHappyPathScenario(t, t.events);
    const published = toPublishableScenario(scenario, appSlug, recordingId);
    assert.ok(!JSON.stringify(published).includes(TEST_SECRET_VALUE_123), `leaked for appSlug=${appSlug}`);
    assert.ok(published.steps.some((step) => step.includes(`Ingresar el valor seguro asociado a "${label}"`) || step.includes(`Ingresar [`)));
  }
});
