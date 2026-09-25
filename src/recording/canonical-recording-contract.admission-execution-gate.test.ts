import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness, type CanonicalInteraction } from "./canonical-recording-contract";
import { isTechnicalIdentityAdmissible } from "./trace-normalizer";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * Physical evidence (recording cc1b51dc-e359-4f81-9181-926dd2037b67, job
 * b0778260-77ef-4d9d-8b41-bf70f9d2efdc): an unresolved identification field
 * ("Ingresar ... en \"Campo pendiente de identificar\"") reached the browser runtime as
 * `structural:grid=grid:div|role=amount_or_text` and failed with target_not_found. Two
 * independent gaps compounded:
 *
 * 1. web-session-recorder.ts's buildWebLocators last-resort fallback (used only when NO real
 *    signal — testid/aria/role+name/domId/text/name — was found) fabricates a `structural`
 *    locator from bare grid/role context with no header/cell component, and
 *    isTechnicalIdentityAdmissible previously admitted ANY `structural`-strategy locator,
 *    treating that fabricated fallback as if it were real technical identity — which then
 *    short-circuited canonical-recording-contract.ts's admission checks entirely (both
 *    ownerRecertificationRequired and genericWithoutIdentity are gated on
 *    `!structurallyCorroborated`).
 * 2. Even where admissionStatus DID correctly end up "unresolved", nothing downstream
 *    (evaluateRecordedScenarioExecutionReadiness, which directly feeds
 *    toSharedMcpScenario's mcpExecutable/executionReadiness) ever consulted it — an
 *    unresolved-but-target-bearing action could still be reported "ready".
 *
 * Fixed: (1) a `structural` locator is only admissible when it carries a header/cell
 * component (real column/field context), never a bare grid+role fallback; (2)
 * evaluateRecordedScenarioExecutionReadiness now blocks execution readiness for any action
 * whose source interaction has admissionStatus="unresolved", independent of whether some
 * target/candidate happens to be present.
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

test("0. the exact reported synthetic structural fallback is no longer admissible on its own", () => {
  const syntheticFallback = { label: "control", compoundRole: "amount_or_text", gridRef: "grid:div", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(syntheticFallback), false);
});

test("1. accepted action: real technical identity keeps executable=true, behavior unchanged", () => {
  seq = 0;
  const events = [fillEvent({
    screenKey: "s",
    target: { label: "Documento", associatedField: "Documento", attributes: { "data-testid": "doc-field" }, locators: [{ strategy: "data-testid", value: "doc-field" }] },
    value: "12345",
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "accepted");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, true);
  assert.equal(audit.executionReady, true);
});

test("2. unresolved required fill: preserved, but never executable, and executionReady=false", () => {
  seq = 0;
  const events = [fillEvent({ screenKey: "s", target: { label: "control" }, value: "402-1234567-8" })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 1, "the action must be preserved, never dropped");
  assert.equal(interactions[0].admissionStatus, "unresolved");
  assert.equal(interactions[0].recordedValue, "402-1234567-8", "the recorded value evidence must survive");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, false);
  assert.ok(audit.actions[0].blockReasons.includes("required_interaction_unresolved"));
  assert.equal(audit.executionReady, false);
});

test("3. 'Campo pendiente de identificar'-shaped label alone never becomes an executable target", () => {
  seq = 0;
  const events = [fillEvent({ screenKey: "s", target: { label: "campo" }, value: "x" })]; // generic label, no technical identity
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "unresolved");
  assert.equal(interactions[0].semanticField, undefined);
  assert.equal(interactions[0].description, undefined);
});

test("4. 'control'-labeled click never becomes an executable click target", () => {
  seq = 0;
  const events = [tapEvent({ screenKey: "s", target: { label: "control" } })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "unresolved");
  assert.equal(interactions[0].admissionReason, "generic_label_without_technical_identity");
});

test("5. the exact synthetic structural fallback shape stays unresolved (no fabricated technical authority), but with a recorded value it now qualifies for runtime resolution rather than being blocked outright", () => {
  // Superseded by the "runtime resolution required" ticket: a bare structural fallback plus a
  // genuinely recorded value is now real enough evidence to let the EXISTING runtime/MCP
  // resolver attempt live re-verification (Recording Replay only) instead of blocking the
  // scenario before any browser is ever reached. admissionStatus/semanticField/description stay
  // exactly as before — this is never treated as certified authority.
  seq = 0;
  const events = [fillEvent({
    screenKey: "s",
    target: { label: "control", compoundRole: "amount_or_text", gridRef: "grid:div", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
    value: "1500.00",
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "unresolved", "the fabricated fallback locator must not rescue admission");
  assert.equal(interactions[0].resolutionState, "runtime_resolution_required");
  assert.equal(interactions[0].semanticField, undefined, "never fabricated as an executable field name");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, true);
  assert.equal(audit.actions[0].runtimeResolutionRequired, true);
  assert.equal(audit.executionReady, true);
  assert.equal(audit.promotionReady, false, "promotion stays blocked while any action is only runtime-resolution-required");
});

test("5b. the same shape with NO recorded value at all stays fully blocked (bare structural locator alone is never sufficient evidence)", () => {
  seq = 0;
  const events = [fillEvent({
    screenKey: "s",
    target: { label: "control", compoundRole: "amount_or_text", gridRef: "grid:div", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
    value: "",
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "unresolved");
  assert.equal(interactions[0].resolutionState, "unresolved_unrecoverable");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, false);
  assert.equal(audit.executionReady, false);
});

test("6. a valid structural target (real header/cell context) from an accepted action remains allowed", () => {
  seq = 0;
  const events = [fillEvent({
    screenKey: "s",
    target: { label: "Monto", compoundRole: "amount_or_text", associatedField: "Monto", locators: [{ strategy: "structural", value: "grid=customerGrid|header=Monto|role=amount_or_text" }] },
    value: "1500.00",
  })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "accepted");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, true);
  assert.equal(audit.executionReady, true);
});

test("7. required unresolved interaction remains represented in the contract/readiness diagnostics, never silently dropped", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Documento", attributes: { "data-testid": "doc" } }, value: "A" }),
    fillEvent({ screenKey: "s", target: { label: "control" }, value: "B" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 2);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions.length, 2, "both actions must appear in the readiness diagnostics");
  assert.equal(audit.actions[1].ready, false);
});

test("8. contract gate: exactly one required unresolved action blocks the whole scenario's execution readiness", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Documento", attributes: { "data-testid": "doc" } }, value: "A" }),
    tapEvent({ screenKey: "s", target: { label: "Continuar", attributes: { "data-testid": "continue" } } }),
    fillEvent({ screenKey: "s", target: { label: "control" }, value: "unresolved-value" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.executionReady, false, "one unresolved required action must block the entire scenario, not just its own step");
  assert.ok(audit.blockReasons.includes("required_interaction_unresolved"));
});

test("9. fully resolved contract: current execution behavior unchanged", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Documento", attributes: { "data-testid": "doc" }, locators: [{ strategy: "data-testid", value: "doc" }] }, value: "A" }),
    tapEvent({ screenKey: "s", target: { label: "Continuar", attributes: { "data-testid": "continue" }, locators: [{ strategy: "data-testid", value: "continue" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.executionReady, true);
  assert.equal(audit.blockReasons.length, 0);
});

test("10. portal-shaped fixture: login accepted, surface transition, identification fill has real recorded evidence -> Recording Replay may attempt runtime resolution, but never as a fabricated/certified target and never promotable", () => {
  // Superseded by the "runtime resolution required" ticket: this exact physically-reported shape
  // (bare structural fallback + a real typed value, e.g. "402-12345678-9") is precisely the case
  // the ticket asks to stop blocking outright — see FIRST_LOSS in that ticket's own report. The
  // EXISTING runtime/MCP resolver (resolveActionTarget) already re-verifies any recorded
  // technical target live before trusting it (resolved / ambiguous / not_found / structurally
  // incompatible) — Recording Replay is only being ALLOWED to reach that resolver here, never
  // given false certified authority: admissionStatus stays "unresolved", semanticField/
  // description stay withheld, and promotionReady stays false.
  seq = 0;
  const events = [
    tapEvent({ screenKey: "screen:login", target: { label: "Iniciar sesión", attributes: { "data-testid": "login-btn" }, locators: [{ strategy: "data-testid", value: "login-btn" }] } }),
    fillEvent({
      screenKey: "screen:requests-create-multiproduct",
      target: { label: "control", compoundRole: "amount_or_text", gridRef: "grid:div", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
      value: "402-12345678-9",
    }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 2, "login preserved, identification action preserved");
  const login = interactions[0];
  const identification = interactions[1];
  assert.equal(login.admissionStatus, "accepted");
  assert.equal(identification.admissionStatus, "unresolved");
  assert.equal(identification.resolutionState, "runtime_resolution_required");
  assert.equal(identification.recordedValue, "402-12345678-9", "raw value evidence preserved");
  assert.equal(identification.semanticField, undefined, "never fabricated as an executable field");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.executionReady, true, "Recording Replay may now reach the existing runtime resolver for this action");
  assert.equal(audit.promotionReady, false, "promotion stays blocked — this target is never certified");
  assert.equal(audit.actions[1].runtimeResolutionRequired, true);
  assert.ok(!audit.actions[1].blockReasons.includes("required_interaction_unresolved"));
});

test("10b. same portal-shaped fixture but with NO recorded value at all: still fully blocked, never reaches runtime resolution", () => {
  seq = 0;
  const events = [
    tapEvent({ screenKey: "screen:login", target: { label: "Iniciar sesión", attributes: { "data-testid": "login-btn" } } }),
    fillEvent({
      screenKey: "screen:requests-create-multiproduct",
      target: { label: "control", compoundRole: "amount_or_text", gridRef: "grid:div", locators: [{ strategy: "structural", value: "grid=grid:div|role=amount_or_text" }] },
      value: "",
    }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const identification = interactions[1];
  assert.equal(identification.admissionStatus, "unresolved");
  assert.equal(identification.resolutionState, "unresolved_unrecoverable");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.executionReady, false, "browser runtime must not be reached — execution readiness blocked before it");
  assert.ok(audit.actions[1].blockReasons.includes("required_interaction_unresolved"));
});
