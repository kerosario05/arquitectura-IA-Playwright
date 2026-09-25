import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness, type CanonicalInteraction } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * Physical evidence (recording 2151a2f0-4c62-466d-832d-480754586092, scenario
 * REC-2151A2F0-01, job 6d0eac58-9400-4948-98aa-0c05f5cc7627): the accepted scenario contained
 * "Presionar \"Iniciar sesión\"" with NO preceding "Ingresar [usuario] en Usuario"/"Ingresar
 * [contrasena] en Contraseña" fills — runtime executed the click with no fills, reached
 * `RECORDED_POSTCONDITION_NOT_REACHED` (stayed on /login).
 *
 * Traced to FIRST LOSS: the raw trace.json for this recording contains ZERO `"kind": "fill"`
 * events anywhere (grep-verified). The credential fields were genuinely typed in the browser —
 * proven by `activeElementBefore` on the very next event (the "Iniciar sesión" click), which
 * shows `id: "password"`, `committedValue: "Masteryi15."` (a real, non-empty value) — but the
 * capture script's own change/input listeners never emitted a first-class `fill` RecordedEvent
 * for either field. This is a CAPTURE-side gap upstream of buildCanonicalInteractions,
 * semantic-recording.ts, and trace-to-scenario.ts — all of those layers are already behaving
 * correctly given their input (they faithfully reflect a raw trace that is itself missing the
 * fill events), so `canonicalInteractionPresent=false` / `semanticActionPresent=false` /
 * `executionContractActionPresent=false` / `previewActionPresent=false` for both fields follow
 * directly from `rawEventPresent=false` — there is no separate "drop" bug at any downstream
 * boundary to fix there.
 *
 * Per this ticket's own explicit instruction, the missing fills are NEVER synthesized. Instead,
 * `buildCanonicalInteractions` now recognizes this specific, generic, structural pattern — a
 * click landing on a screen with NO preceding fill/select interaction, whose OWN
 * `activeElementBefore` snapshot shows a real, non-empty EDITABLE element (structural: tag
 * input/textarea/select or role textbox/combobox — never a field name/label match) — and marks
 * that click `admissionStatus: "unresolved"`, `admissionReason:
 * "missing_required_credential_fill"`, `resolutionState: "unresolved_unrecoverable"` (never
 * runtime-resolvable: no amount of live target re-resolution recovers a value that was simply
 * never recorded). This blocks the scenario at the SAME preflight gate every other unresolved
 * required interaction already blocks at, turning a confusing runtime
 * RECORDED_POSTCONDITION_NOT_REACHED into an accurate, early EXECUTION_NOT_READY.
 */

let seq = 0;
function fillEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string }; value: string }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "fill", screenKey: overrides.screenKey, value: overrides.value, target: { locators: [], ...overrides.target } as RecordedTarget };
}
function tapEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string } }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey: overrides.screenKey, target: { locators: [], ...overrides.target } as RecordedTarget };
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

// Real technical identity for the submit click itself, matching the physical evidence's own
// aria-label-backed button — proves this bug is independent of the click's own identity quality.
function submitClick(screenKey: string, activeElementBefore?: RecordedTarget["activeElementBefore"]): RecordedEvent {
  return tapEvent({
    screenKey,
    target: {
      label: "Iniciar sesión",
      associatedField: "Iniciar sesión",
      locators: [{ strategy: "aria-label", value: "Iniciar sesión" }],
      activeElementBefore,
    },
  });
}

test("1. normal case unaffected: recorded username fill + password fill + submit -> all 3 preserved, submit accepted, no missing-fill flag", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "login", target: { label: "Usuario", associatedField: "Usuario", locators: [{ strategy: "data-testid", value: "username" }] }, value: "qauser" }),
    fillEvent({ screenKey: "login", target: { label: "Contraseña", associatedField: "Contraseña", locators: [{ strategy: "data-testid", value: "password" }] }, value: "Masteryi15." }),
    submitClick("login", { tag: "input", id: "password", value: "Masteryi15.", committedValue: "Masteryi15." }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 3, "all three recorded actions preserved");
  assert.equal(interactions[0].action, "fill");
  assert.equal(interactions[1].action, "fill");
  assert.equal(interactions[2].action, "click");
  assert.equal(interactions[2].admissionStatus, "accepted");
  assert.notEqual(interactions[2].admissionReason, "missing_required_credential_fill");
});

test("2. missing-fill case (the reported bug): submit with real activeElementBefore evidence but NO preceding fill -> unresolved_unrecoverable, never fabricated", () => {
  seq = 0;
  const events = [submitClick("login", { tag: "input", id: "password", value: "Masteryi15.", committedValue: "Masteryi15." })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 1, "no fill interaction is ever synthesized -- only the click itself, now blocked");
  assert.equal(interactions[0].action, "click");
  assert.equal(interactions[0].admissionStatus, "unresolved");
  assert.equal(interactions[0].admissionReason, "missing_required_credential_fill");
  assert.equal(interactions[0].resolutionState, "unresolved_unrecoverable", "never runtime-resolvable -- no target re-resolution recovers an un-recorded value");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, false);
  assert.equal(audit.executionReady, false, "blocked before runtime ever attempts the doomed submit");
});

test("3. sensitive data: the real password text captured in activeElementBefore never leaks into the click's own semanticField/description/recordedValue", () => {
  seq = 0;
  const events = [submitClick("login", { tag: "input", id: "password", value: "Masteryi15.", committedValue: "Masteryi15." })];
  const interactions = buildCanonicalInteractions(events);
  const click = interactions[0];
  assert.notEqual(click.semanticField, "Masteryi15.");
  assert.notEqual(click.recordedValue, "Masteryi15.");
  assert.ok(!click.description?.includes("Masteryi15."));
});

test("4. post-login preservation: a later click on a different, already-filled screen is not falsely flagged", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "login", target: { label: "Usuario", associatedField: "Usuario", locators: [{ strategy: "data-testid", value: "username" }] }, value: "qauser" }),
    fillEvent({ screenKey: "login", target: { label: "Contraseña", associatedField: "Contraseña", locators: [{ strategy: "data-testid", value: "password" }] }, value: "Masteryi15." }),
    submitClick("login", { tag: "input", id: "password", value: "Masteryi15.", committedValue: "Masteryi15." }),
    // A plain business-form button with no editable activeElementBefore -- must never trip the
    // same detector just because it is the first click on its own (new) screen.
    tapEvent({ screenKey: "requests-create-multiproduct", target: { label: "Continuar", associatedField: "Continuar", locators: [{ strategy: "data-testid", value: "continue" }], activeElementBefore: { tag: "body", role: "body" } } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const continueClick = interactions[3];
  assert.equal(continueClick.admissionReason === "missing_required_credential_fill", false);
});

test("5. ownerRecertification behavior remains green: a stale post-transition owner is still rejected for its own reason, not reclassified as missing-fill", () => {
  seq = 0;
  const events = [
    submitClick("login", { tag: "input", id: "password", value: "x", committedValue: "x" }),
    tapEvent({ screenKey: "next-screen", target: { label: "Iniciar sesión", associatedField: "Iniciar sesión", locators: [{ strategy: "text", value: "Iniciar sesión" }] } }),
  ];
  // First click has no prior fill either, so it is (correctly, independently) flagged missing-fill;
  // the SECOND interaction is a stale, post-transition, text-locator-only owner with no active
  // element evidence at all, so it must be classified by its own pre-existing reason.
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[1].admissionReason, "post_transition_owner_not_recertified");
});

test("6. missingRawNoSynthesis: buildCanonicalInteractions never fabricates a fill interaction for Usuario/Contraseña when none was recorded", () => {
  seq = 0;
  const events = [submitClick("login", { tag: "input", id: "password", value: "Masteryi15.", committedValue: "Masteryi15." })];
  const interactions = buildCanonicalInteractions(events);
  assert.ok(!interactions.some((i) => i.action === "fill"), "no fill action exists anywhere in the output");
  assert.equal(interactions.length, 1);
});

test("7. no activeElementBefore evidence at all (a plain button, nothing was ever focused/filled): not flagged as missing-fill", () => {
  seq = 0;
  const events = [tapEvent({ screenKey: "s", target: { label: "Buscar", associatedField: "Buscar", locators: [{ strategy: "data-testid", value: "search" }] } })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "accepted");
});
