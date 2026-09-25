import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness, type CanonicalInteraction } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * Physical evidence chain: scenario REC-6DB50111-01 correctly reported EXECUTION_NOT_READY with
 * required_interaction_unresolved for a "Número de identificación" fill whose only recorded
 * technical evidence was the last-resort bare structural fallback
 * (`structural:grid=grid:div|role=amount_or_text`) — but the user genuinely typed a value into
 * it, and the discovery/replay runtime resolver (`resolveActionTarget` in
 * src/discovery/target-resolver.ts`, invoked by every Recording Replay execution today via its
 * `recordedTechnicalTargetRefs` hint) ALREADY re-verifies any recorded technical target live
 * before trusting it — it never blindly executes a locator, and already distinguishes resolved /
 * ambiguous / not_found / structurally-incompatible outcomes. The gap was never the runtime: it
 * was the PREFLIGHT admission gate in `evaluateRecordedScenarioExecutionReadiness`, which
 * unconditionally blocked `admissionStatus="unresolved"` before the resolver was ever reached.
 *
 * Fixed by adding a `resolutionState` tri-state ("certified" / "runtime_resolution_required" /
 * "unresolved_unrecoverable") computed in `buildCanonicalInteractions` from EXISTING evidence
 * only (a recorded value plus at least one independent structural signal: its own technical
 * target evidence, a real structural field name, or a captured field-owner diagnostic attempt —
 * never a single isolated field, never a bare structural locator or generic label alone), and
 * changing the readiness gate to let a `runtime_resolution_required` action reach execution
 * (Recording Replay only) while `promotionReady` stays false and `admissionStatus` stays
 * "unresolved" — never fabricated as certified authority.
 *
 * Tests 5-8 in the ticket's own list (runtime resolve outcomes: unique/ambiguous/not-found/
 * incompatible) exercise `resolveActionTarget` itself, which this ticket does NOT modify (it
 * already implements exactly this A/B/C/D contract via its `status: "resolved" | "ambiguous" |
 * "not_found" | "locator_resolution_failed"` union and its live structural-compatibility check)
 * and which has no pre-existing dedicated unit test file in this repo — exercising it
 * meaningfully needs a real Page/DOM snapshot, which this ticket's own "NO browser" constraint
 * rules out. That is a disclosed gap, not a fabricated pass.
 */

let seq = 0;
function tapEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string } }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey: overrides.screenKey, target: { locators: [], ...overrides.target } as RecordedTarget };
}
function fillEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string }; value: string }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "fill", screenKey: overrides.screenKey, value: overrides.value, target: { locators: [], ...overrides.target } as RecordedTarget };
}
function baseScenario(interactions: CanonicalInteraction[]) {
  return {
    canonicalInteractions: interactions,
    runtimeInputRequirements: [],
    testRailSteps: [{ content: "step" } as any],
    stateSequenceValid: true,
    mutationDiagnostics: undefined,
    readiness: undefined,
  };
}

test("1. certified required interaction: accepted, resolutionState=certified, unaffected", () => {
  seq = 0;
  const events = [fillEvent({ screenKey: "s", target: { label: "Documento", associatedField: "Documento", locators: [{ strategy: "data-testid", value: "doc" }] }, value: "12345" })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "accepted");
  assert.equal(interactions[0].resolutionState, "certified");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, true);
  assert.equal(audit.executionReady, true);
  assert.equal(audit.promotionReady, true);
});

test("2. unresolved required interaction + sufficient recording evidence (value + own technical target): accepted for Recording Replay, resolutionState=runtime_resolution_required", () => {
  seq = 0;
  const events = [fillEvent({
    screenKey: "s",
    target: { label: "control", compoundRole: "amount_or_text", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
    value: "402-1234567-8",
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "unresolved", "never fabricated as certified");
  assert.equal(interactions[0].resolutionState, "runtime_resolution_required");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, true);
  assert.equal(audit.actions[0].runtimeResolutionRequired, true);
  assert.equal(audit.executionReady, true);
});

test("3. unresolved + bare structural locator only (no recorded value): rejected, resolutionState=unresolved_unrecoverable", () => {
  seq = 0;
  const events = [fillEvent({
    screenKey: "s",
    target: { label: "control", compoundRole: "amount_or_text", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
    value: "",
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].resolutionState, "unresolved_unrecoverable");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, false);
  assert.equal(audit.executionReady, false);
});

test("3b. unresolved + generic label alone, no technical target, no value: rejected, resolutionState=unresolved_unrecoverable", () => {
  seq = 0;
  const events = [tapEvent({ screenKey: "s", target: { label: "control" } })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].resolutionState, "unresolved_unrecoverable");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, false);
});

test("4. generic display label ('control'-shaped, the same raw fallback rendered as \"Campo pendiente de identificar\" downstream) WITH real recording evidence (value + technical target): runtime_resolution_required, and the provisional locator/label is never promoted to executable authority", () => {
  seq = 0;
  const events = [fillEvent({
    screenKey: "s",
    target: { label: "control", compoundRole: "amount_or_text", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
    value: "some-typed-value",
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "unresolved");
  assert.equal(interactions[0].resolutionState, "runtime_resolution_required");
  assert.equal(interactions[0].semanticField, undefined, "the display label is never promoted to a semantic/executable field name");
  assert.equal(interactions[0].description, undefined, "no fabricated human-facing description either");
});

test("post-transition stale owner is NEVER eligible for runtime_resolution_required via its (possibly real-looking but stale) structural field name — untouched field-owner heuristic", () => {
  seq = 0;
  const events = [
    tapEvent({ screenKey: "screen:login", target: { label: "Iniciar sesión", attributes: { "data-testid": "login-btn" }, locators: [{ strategy: "data-testid", value: "login-btn" }] } }),
    // Post-transition, text-locator-only: ownerRecertificationRequired, with a value present so
    // it would otherwise qualify — must still stay unresolved_unrecoverable via this path.
    fillEvent({ screenKey: "screen:next", target: { label: "Iniciar sesión", associatedField: "Iniciar sesión", locators: [{ strategy: "text", value: "Iniciar sesión" }] }, value: "x" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const second = interactions[1];
  assert.equal(second.admissionReason, "post_transition_owner_not_recertified");
  assert.equal(second.resolutionState, "unresolved_unrecoverable", "a stale post-transition owner must never be treated as runtime-resolvable evidence");
  assert.equal(second.semanticField, undefined);
});

test("9. promotion gate: a scenario with a runtime_resolution_required action stays promotionReady=false even though executionReady=true", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Documento", associatedField: "Documento", locators: [{ strategy: "data-testid", value: "doc" }] }, value: "A" }),
    fillEvent({
      screenKey: "s",
      target: { label: "control", compoundRole: "amount_or_text", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
      value: "402-1234567-8",
    }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.executionReady, true);
  assert.equal(audit.promotionReady, false);
});

test("11. all-rejected side-effect ordering is untouched: a wholly unresolved_unrecoverable scenario still reports executionReady=false, exactly as the preflight-ordering ticket relies on", () => {
  seq = 0;
  const events = [tapEvent({ screenKey: "s", target: { label: "control" } })];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.executionReady, false, "the recordings.ts admission gate (evaluateRecordingExecutionAdmission) still short-circuits before any TestRail/spec/discovery side effect for this scenario");
});

test("12. fieldOwnerDiagnostic remains diagnostic-only, never execution authority: identical evidence produces identical resolutionState regardless of whether a fieldOwnerDiagnostic is attached", () => {
  seq = 0;
  const withDiagnostic = buildCanonicalInteractions([fillEvent({
    screenKey: "s",
    target: {
      label: "control",
      compoundRole: "amount_or_text",
      locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }],
      fieldOwnerDiagnostic: { result: "unresolved", trace: [] },
    },
    value: "402-1234567-8",
  })]);
  seq = 0;
  const withoutDiagnostic = buildCanonicalInteractions([fillEvent({
    screenKey: "s",
    target: { label: "control", compoundRole: "amount_or_text", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
    value: "402-1234567-8",
  })]);
  assert.equal(withDiagnostic[0].resolutionState, "runtime_resolution_required");
  assert.equal(withoutDiagnostic[0].resolutionState, "runtime_resolution_required");
  assert.equal(withDiagnostic[0].admissionStatus, withoutDiagnostic[0].admissionStatus, "fieldOwnerDiagnostic presence never changes admission authority on its own");
});
