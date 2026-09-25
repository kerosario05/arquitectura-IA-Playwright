import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import type { SessionTrace } from "./session-trace.types";
import { loadScenarios, saveScenarios } from "./recording-store";
import { materializeObservedPrimaryScenario } from "./trace-to-scenario";
import { evaluateRecordedScenarioExecutionReadiness } from "./canonical-recording-contract";

/**
 * FIRST_LOSS: `materializeObservedPrimaryScenario` (the deterministic, no-AI lane STOP uses to
 * persist the primary the user actually walked) required EVERY non-technicalOnly action to
 * already carry a certified technical target (`technicalTargetRefs.length > 0 ||
 * technicalTargetCandidates.length > 0`) before it would return anything other than `null`. This
 * is strictly stronger than what `deriveScenarios`'s own richer pipeline
 * (`enrichRecordedScenarioContract`) ultimately allows through: an action whose `resolutionState`
 * is `runtime_resolution_required` (a real, non-generic field/owner identity was observed, just
 * no technical locator captured for it yet) is legitimately execution-eligible per
 * `evaluateRecordedScenarioExecutionReadiness`'s own carve-out (see
 * `canonical-recording-contract.runtime-resolution-required.test.ts`), but was still enough to
 * make `materializeObservedPrimaryScenario` return `null` -- forcing every such recording through
 * `POST /derive` just to get its OWN observed walkthrough persisted. Fixed by adding the
 * identical carve-out here, mirroring the one already established in
 * `evaluateRecordedScenarioExecutionReadiness` and `recording-readiness.ts` (frontend). A truly
 * unresolved/ambiguous action (`resolutionState: "unresolved_unrecoverable"`) still blocks
 * persistence -- never relaxed.
 */

function target(label: string, value = label, extra: Record<string, unknown> = {}) {
  return { label, role: "button", locators: [{ strategy: "role", value, confidence: 0.95 }], ...extra };
}

function fixture(overrides: Partial<SessionTrace> = {}): SessionTrace {
  return {
    recordingId: "observed-primary-runtime-resolution-fixture",
    projectSlug: "observed-primary-runtime-resolution-fixture",
    appSlug: "observed-primary-runtime-resolution-fixture",
    platform: "web",
    baseUrl: "https://app.test/login",
    label: "Registrar cliente",
    recordingGoal: { declaredGoal: "Registrar cliente", normalizedGoal: "registrar cliente", provenance: "USER_DECLARED", needsReview: false },
    recordingDataPolicy: { persistRecordedValues: true, persistQaCredentials: true, includeQaCredentialsInTestRail: false },
    startedAt: "2026-09-14T10:00:00.000Z",
    status: "stopped",
    events: [],
    screens: [
      { screenKey: "login", title: "Login", fingerprint: "login", firstSeenAt: 0, controls: [], texts: ["Login"] },
      { screenKey: "home", title: "Cliente creado", fingerprint: "home", firstSeenAt: 300, controls: [], texts: ["Cliente creado"] },
    ],
    ...overrides,
  } as SessionTrace;
}

function runtimeResolutionRequiredFixture(): SessionTrace {
  return fixture({
    events: [
      {
        seq: 1,
        t: 100,
        kind: "fill",
        screenKey: "login",
        target: { label: "control", compoundRole: "amount_or_text", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
        value: "402-1234567-8",
      },
      { seq: 2, t: 200, kind: "tap", screenKey: "login", target: target("Continuar", "continuar") },
      { seq: 3, t: 300, kind: "screen_change", screenKey: "login", toScreenKey: "home" },
    ] as SessionTrace["events"],
  });
}

test("1/stopPersist + 5/runtimeResolution. a runtime_resolution_required action does not block observed-primary persistence at STOP", () => {
  const primary = materializeObservedPrimaryScenario(runtimeResolutionRequiredFixture());
  assert.ok(primary, "expected the observed primary to be materialized despite a runtime_resolution_required action");
  const fillInteraction = primary.canonicalInteractions?.find((interaction) => interaction.action === "fill");
  assert.equal(fillInteraction?.resolutionState, "runtime_resolution_required");
  // Never fabricated as certified -- PERSISTED != CERTIFIED.
  assert.equal(fillInteraction?.admissionStatus, "unresolved");
});

test("observed unresolved tap persists for review while remaining non-executable", () => {
  const trace = fixture({
    events: [
      { seq: 1, t: 100, kind: "tap", screenKey: "login", target: target("Continuar", "continuar") },
      { seq: 2, t: 200, kind: "tap", screenKey: "login", interactionId: "pointer-sms", target: { label: "SMS", role: "button", locators: [] } },
      { seq: 3, t: 300, kind: "tap", screenKey: "login", target: target("Finalizar", "finalizar") },
    ] as SessionTrace["events"],
  });
  const primary = materializeObservedPrimaryScenario(trace);
  assert.ok(primary, "observed path must be persisted despite the unresolved tap");
  const sms = primary.canonicalInteractions?.find((interaction) => interaction.sourceEventRefs.includes("event-2"));
  assert.ok(sms);
  assert.deepEqual(sms!.technicalTargetRefs, []);
  assert.equal(primary.testRailSteps.some((step) => step.content.includes("SMS")), true);
  const audit = evaluateRecordedScenarioExecutionReadiness(primary);
  assert.equal(audit.technicalReady, false);
  assert.equal(audit.actions.some((action) => action.interactionId === sms!.id), false);
});

test("READINESS: persistence never depends on readiness -- the persisted primary's promotionReady stays false while readiness keeps governing execution/promotion independently", () => {
  const primary = materializeObservedPrimaryScenario(runtimeResolutionRequiredFixture());
  assert.ok(primary);
  const audit = evaluateRecordedScenarioExecutionReadiness(primary);
  // promotionReady requires EVERY action to be free of runtimeResolutionRequired -- the fill
  // action still carries it, so promotion (spec generation/reuse/publication) stays blocked
  // regardless of persistence, exactly as `evaluateRecordedScenarioExecutionReadiness` (untouched
  // by this ticket) already defines it. Whether `executionReady` itself is true depends on OTHER
  // independent axes (data/state/mutation readiness) this ticket does not touch or need to force
  // -- "PERSISTED != CERTIFIED" means persistence must not be gated by readiness, not that
  // readiness stops applying. The `runtime_resolution_required` carve-out for `executionReady`
  // itself is already proven, unmodified, by `canonical-recording-contract.runtime-resolution-required.test.ts`.
  assert.equal(audit.promotionReady, false);
});

test("3/noAI. deterministic materialization still has no AI generation lane even with a runtime_resolution_required action", () => {
  const primary = materializeObservedPrimaryScenario(runtimeResolutionRequiredFixture());
  assert.ok(primary);
  assert.equal("aiGeneration" in primary, false);
  assert.equal("provider" in primary, false);
});

test("4/stableId. the same recorded walkthrough always materializes the same scenarioId", () => {
  const first = materializeObservedPrimaryScenario(runtimeResolutionRequiredFixture());
  const second = materializeObservedPrimaryScenario(runtimeResolutionRequiredFixture());
  assert.ok(first);
  assert.ok(second);
  assert.equal(first.scenarioId, second.scenarioId);
});

test("2/noDerive + 10/restart. the runtime-resolution-required primary persists and survives an independent later load, without ever calling /derive", () => {
  const appSlug = `observed-primary-runtime-resolution-${Date.now()}`;
  const recordingId = `${appSlug}-recording`;
  const trace = runtimeResolutionRequiredFixture();
  const primary = materializeObservedPrimaryScenario({ ...trace, appSlug, projectSlug: appSlug, recordingId });
  assert.ok(primary);
  try {
    saveScenarios(appSlug, recordingId, [primary]);
    const reloaded = loadScenarios(appSlug, recordingId);
    assert.equal(reloaded.length, 1);
    assert.equal(reloaded[0].scenarioId, primary.scenarioId);
  } finally {
    fs.rmSync(path.resolve("automations", "apps", appSlug), { recursive: true, force: true });
  }
});

test("truly unresolved/ambiguous evidence (no value, no technical target, generic label) still fails closed -- the carve-out is never a blanket relaxation", () => {
  const trace = fixture({ events: [] });
  assert.equal(materializeObservedPrimaryScenario(trace), null);
});

test("11/generic. no app/project/business hardcode governs the carve-out -- an arbitrary compoundRole/value still qualifies", () => {
  for (const [value, compoundRole] of [["cualquier-valor-1", "role_x"], ["otro-valor-2", "role_y"]] as const) {
    const trace = fixture({
      events: [
        { seq: 1, t: 100, kind: "fill", screenKey: "login", target: { label: "control", compoundRole, locators: [{ strategy: "structural", value: `grid=grid:div|role=${compoundRole}` }] }, value },
        { seq: 2, t: 200, kind: "tap", screenKey: "login", target: target("Continuar", "continuar") },
        { seq: 3, t: 300, kind: "screen_change", screenKey: "login", toScreenKey: "home" },
      ] as SessionTrace["events"],
    });
    assert.ok(materializeObservedPrimaryScenario(trace), `expected materialization for compoundRole=${compoundRole}`);
  }
});

/**
 * MANDATORY end-to-end test, built from the REAL SHAPE confirmed against a physical recording's
 * persisted trace.json: a fill on a real field, followed by an icon-only button click whose
 * `target.label` is the literal capture sentinel "control" (never an empty string -- every real
 * capture path defaults to this exact value when no accessible name exists), followed by a
 * separately named button click. Demonstrates the full observed-primary pipeline end to end:
 * `materializeObservedPrimaryScenario` -> `canonicalInteractions` -> `testRailSteps` (display) ->
 * `evaluateRecordedScenarioExecutionReadiness` (execution).
 */
function realShapeIconButtonFixture(): SessionTrace {
  return fixture({
    events: [
      {
        seq: 1, t: 100, kind: "fill", screenKey: "login",
        target: { label: "control", role: "input", associatedField: "Número de identificación", locators: [] },
        value: "056-0154046-0",
      },
      {
        seq: 2, t: 200, kind: "tap", screenKey: "login",
        target: { label: "control", role: "button", associatedField: "Número de identificación", locators: [] },
      },
      { seq: 3, t: 300, kind: "tap", screenKey: "login", target: target("Depurar", "depurar") },
    ] as SessionTrace["events"],
  });
}

test("realShape/clickOrdering. fill + real-shape unnamed icon button (label=\"control\") + named click: recorded taps=2, canonical clicks=2, in order, observed primary preserves all 3, execution readiness accepts both clicks", () => {
  const primary = materializeObservedPrimaryScenario(realShapeIconButtonFixture());
  assert.ok(primary, "the observed primary must materialize despite the icon button's runtime_resolution_required action");

  const clicks = (primary.canonicalInteractions ?? []).filter((interaction) => interaction.action === "click");
  assert.equal(clicks.length, 2, "recorded taps=2 (icon button + Depurar)");
  assert.deepEqual(primary.canonicalInteractions?.map((interaction) => interaction.action), ["fill", "click", "click"], "order preserved: fill, click icon, click named button");

  // Display: the icon button's step must reference its real field relation, never the raw
  // "control" sentinel rendered as if it were the button's own accessible name.
  const iconStep = primary.testRailSteps.find((step) => step.sourceEventRefs?.includes("event-2"));
  assert.ok(iconStep, "the icon button must produce its own visible step");
  assert.equal(iconStep!.content, 'Presionar botón asociado a "Número de identificación"');
  assert.notEqual(iconStep!.content, 'Presionar "control"');

  // Execution: both clicks are execution-ready (icon button via runtime_resolution_required,
  // Depurar via its own certified locator) -- "execution clicks=2".
  const audit = evaluateRecordedScenarioExecutionReadiness(primary);
  const clickActions = audit.actions.filter((action) => action.actionType === "click");
  assert.equal(clickActions.length, 2);
  assert.ok(clickActions.every((action) => action.ready), "both clicks must be execution-ready");
});
