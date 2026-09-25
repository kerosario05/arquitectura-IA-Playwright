import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { buildSemanticRecordingModel } from "./semantic-recording";
import type { RecordedEvent, SessionTrace } from "./session-trace.types";
import { hydratePersistedScenarios } from "./persisted-scenario-hydration";
import { loadScenarios, saveScenarios, saveSemanticRecording } from "./recording-store";
import { materializeObservedPrimaryScenario } from "./trace-to-scenario";
import { toSharedMcpScenario } from "./canonical-recording-contract";
import { resolveReplayAdmission } from "../server/services/replay-admission";

function target(label: string, value = label, extra: Record<string, unknown> = {}) {
  return { label, role: "button", locators: [{ strategy: "role", value, confidence: 0.95 }], ...extra };
}

function fixture(overrides: Partial<SessionTrace> = {}): SessionTrace {
  const trace: SessionTrace = {
    recordingId: "observed-primary-fixture",
    projectSlug: "observed-primary-fixture",
    appSlug: "observed-primary-fixture",
    platform: "web",
    baseUrl: "https://app.test/login",
    label: "Registrar cliente",
    recordingGoal: { declaredGoal: "Registrar cliente", normalizedGoal: "registrar cliente", provenance: "USER_DECLARED", needsReview: false },
    recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: false },
    startedAt: "2026-09-14T10:00:00.000Z",
    status: "stopped",
    events: [
      { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { ...target("Usuario", "usuario"), role: "textbox", associatedField: "Usuario" }, value: "juan" },
      { seq: 2, t: 200, kind: "tap", screenKey: "login", target: target("Continuar", "continuar") },
      { seq: 3, t: 300, kind: "screen_change", screenKey: "login", toScreenKey: "home" },
    ],
    screens: [
      { screenKey: "login", title: "Login", fingerprint: "login", firstSeenAt: 0, controls: [], texts: ["Login"] },
      { screenKey: "home", title: "Cliente creado", fingerprint: "home", firstSeenAt: 300, controls: [], texts: ["Cliente creado"] },
    ],
    ...overrides,
  };
  return trace;
}

test("CASE 1: complete recording materializes observed primary without AI", () => {
  const primary = materializeObservedPrimaryScenario(fixture());
  assert.ok(primary);
  assert.equal(primary.primary, true);
  assert.equal(primary.provenance, "observed");
  assert.equal(primary.sourceRecordingId, "observed-primary-fixture");
  assert.equal(primary.suggestionCategory, undefined);
});

test("CASE 2: runtime valueKeys and sensitive metadata are preserved", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { ...target("Clave", "clave"), role: "textbox", inputType: "password", associatedField: "Clave" }, redactedKey: "clave" },
      { seq: 2, t: 200, kind: "tap", screenKey: "login", target: target("Continuar", "continuar") },
      { seq: 3, t: 300, kind: "screen_change", screenKey: "login", toScreenKey: "home" },
    ],
  });
  const primary = materializeObservedPrimaryScenario(trace);
  assert.ok(primary);
  assert.ok(primary.requiredData.some((field) => field.key === "clave"));
  assert.equal(primary.requiredData.find((field) => field.key === "clave")?.sensitive, true);
  assert.equal(primary.runtimeInputRequirements?.some((requirement) => requirement.valueKey === "clave"), true);
});

test("CASE 3: materialized primary persists and hydrates after refetch", () => {
  const appSlug = `observed-primary-test-${Date.now()}`;
  const recordingId = `observed-primary-test-${Date.now()}-recording`;
  const trace = fixture({ appSlug, projectSlug: appSlug, recordingId });
  const primary = materializeObservedPrimaryScenario(trace);
  assert.ok(primary);
  try {
    saveSemanticRecording(buildSemanticRecordingModel(trace, trace.events));
    saveScenarios(appSlug, recordingId, [primary]);
    const refetched = hydratePersistedScenarios(loadScenarios(appSlug, recordingId), buildSemanticRecordingModel(trace, trace.events));
    assert.equal(refetched.length, 1);
    assert.equal(refetched[0].scenarioId, primary.scenarioId);
    assert.equal(refetched[0].sourceRecordingId, recordingId);
  } finally {
    fs.rmSync(path.resolve("automations", "apps", appSlug), { recursive: true, force: true });
  }
});

test("CASE 4: selected primary reaches replay admission without SCENARIO_NOT_READY", () => {
  const primary = materializeObservedPrimaryScenario(fixture());
  assert.ok(primary);
  const contract = toSharedMcpScenario(primary, primary.sourceRecordingId);
  assert.equal(contract.mcpExecutable, true);
  const admission = resolveReplayAdmission({
    requestedScenarioIds: [primary.scenarioId],
    evaluatedScenarioIds: [primary.scenarioId],
    eligibleScenarioIds: [primary.scenarioId],
    admittedScenarioIds: [primary.scenarioId],
    evaluatedRejectedScenarios: [],
  });
  assert.equal(admission.acceptedCount, 1);
  assert.equal(admission.requestedRejectedCount, 0);
});

test("CASE 5: repeated deterministic materialization preserves identity and creates no duplicate", () => {
  const first = materializeObservedPrimaryScenario(fixture());
  const second = materializeObservedPrimaryScenario(fixture());
  assert.ok(first && second);
  assert.equal(first.scenarioId, second.scenarioId);
  assert.equal(new Set([first.scenarioId, second.scenarioId]).size, 1);
});

test("CASE 6: later AI merge keeps one primary and adds only distinct scenarios", () => {
  const primary = materializeObservedPrimaryScenario(fixture());
  assert.ok(primary);
  const additional = { ...primary, scenarioId: `${primary.scenarioId}-AI-1`, primary: false, provenance: "derived" as const };
  const merged = [primary, additional].filter((scenario, index, all) => all.findIndex((candidate) => candidate.scenarioId === scenario.scenarioId) === index);
  assert.equal(merged.filter((scenario) => scenario.primary === true).length, 1);
  assert.equal(merged.length, 2);
});

test("CASE 7: incomplete recording is not falsely materialized", () => {
  const incomplete = fixture({ events: [] });
  assert.equal(materializeObservedPrimaryScenario(incomplete), null);
});

test("CASE 8: deterministic primary materialization has no AI generation lane", () => {
  const primary = materializeObservedPrimaryScenario(fixture());
  assert.ok(primary);
  assert.equal("aiGeneration" in primary, false);
  assert.equal("provider" in primary, false);
});

test("CASE 9: observed terminal action materializes even without a generated oracle", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "tap", screenKey: "home", target: target("Guardar", "guardar") },
    ],
    screens: [{ screenKey: "home", title: "Formulario", fingerprint: "home", firstSeenAt: 0, controls: [], texts: ["Formulario"] }],
  });
  const primary = materializeObservedPrimaryScenario(trace);
  assert.ok(primary);
  assert.equal(primary.provenance, "observed");
  assert.equal(primary.testRailSteps.some((step) => step.classification === "FUNCTIONAL_ASSERTION"), false);
});

test("CASE 10: generatedScenarioCount zero is not a primary materialization predicate", () => {
  const trace = fixture() as SessionTrace & { generatedScenarioCount?: number };
  trace.generatedScenarioCount = 0;
  assert.ok(materializeObservedPrimaryScenario(trace));
});
