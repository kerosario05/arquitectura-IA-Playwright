import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, evaluateRecordedScenarioExecutionReadiness, type CanonicalInteraction } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * FIRST_LOSS: a fill on "Número de identificación" followed by a click on an icon-only button
 * (no aria-label, no text, no name) positioned next to that field reached
 * `buildCanonicalInteractions` with `admissionRejected=true` (`genericWithoutIdentity`, since the
 * button's own label/associatedField/headerContext all resolve to nothing usable) -- correct so
 * far, this is not fabricatable identity. But `sufficientRuntimeEvidence` (the gate deciding
 * whether a REJECTED interaction is still worth handing to the runtime resolver) unconditionally
 * required `Boolean(value)` -- meaningful evidence for a rejected FILL/SELECT (the user typed
 * something), but a click/press never carries a "value" by design, so this requirement
 * permanently excluded EVERY rejected click from ever reaching `runtime_resolution_required`,
 * regardless of how much real structural evidence (technicalTargetRefs, a real associatedField
 * relation, role=button) backed it. The click was pushed as a `CanonicalInteraction` (this
 * function never drops any tap/fill/press event), but stuck at `unresolved_unrecoverable` --
 * genuinely dead weight for replay, indistinguishable from a truly unresolvable interaction.
 *
 * Fixed by only requiring `Boolean(value)` for actions that actually carry one (fill/select);
 * a click/press's own occurrence, backed by structural evidence, is now sufficient. A press with
 * no captured key (`missingPressKey`) stays hard-blocked regardless -- there being no key to
 * send is a different, non-recoverable gap this fix does not touch.
 */

let seq = 0;
function fillEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string }; value: string }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "fill", screenKey: overrides.screenKey, value: overrides.value, target: { locators: [], ...overrides.target } as RecordedTarget };
}
function tapEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey: overrides.screenKey, target: { locators: [], label: "", ...overrides.target } as RecordedTarget };
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

/**
 * The icon-only button's OWN target carries no real name (`label: "control"`, the same generic
 * fallback shape the admission gate exists to reject) and no `associatedField` of its own -- it
 * genuinely has nothing nameable, exactly the reported case. Its evidence is a raw structural
 * locator (the same shape a bare structural fallback produces for a fill, per
 * `canonical-recording-contract.runtime-resolution-required.test.ts` test 2), which is enough
 * non-textual technical evidence for the runtime-resolution carve-out once `Boolean(value)` is no
 * longer wrongly required for an action that never has one.
 */
function unnamedButtonTapEvent(screenKey: string): RecordedEvent {
  seq += 1;
  return {
    seq, t: seq * 100, kind: "tap", screenKey,
    target: { label: "control", role: "button", locators: [{ strategy: "structural", value: "grid=grid:div|role=button_icon" }] } as RecordedTarget,
  };
}

test("1/canonical + 4/relation. an unnamed icon-only button click next to a filled field still produces a CanonicalInteraction, never dropped", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Número de identificación", associatedField: "Número de identificación", locators: [{ strategy: "data-testid", value: "doc-input" }] }, value: "12345" }),
    unnamedButtonTapEvent("s"),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 2, "the click must survive as its own CanonicalInteraction");
  const click = interactions[1];
  assert.equal(click.action, "click");
});

test("8/runtimeResolution. that same click resolves to runtime_resolution_required, never fabricated as certified", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Número de identificación", associatedField: "Número de identificación", locators: [{ strategy: "data-testid", value: "doc-input" }] }, value: "12345" }),
    unnamedButtonTapEvent("s"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const click = interactions[1];
  assert.equal(click.admissionStatus, "unresolved", "never fabricated as certified -- the button genuinely has no accessible name");
  assert.equal(click.resolutionState, "runtime_resolution_required");
});

test("5/noFakeName. semanticField/valueKey are never derived from the rejected generic label -- runtime-resolution eligibility never fabricates a field identity for a click", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Número de identificación", associatedField: "Número de identificación", locators: [{ strategy: "data-testid", value: "doc-input" }] }, value: "12345" }),
    unnamedButtonTapEvent("s"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const click = interactions[1];
  assert.equal(click.semanticField, undefined, "a click has no valueKey/semanticField -- no accessibleName is fabricated for it either");
});

test("3/contract. that click reaches execution readiness (ready=true) once handed to the runtime-resolution carve-out", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Número de identificación", associatedField: "Número de identificación", locators: [{ strategy: "data-testid", value: "doc-input" }] }, value: "12345" }),
    unnamedButtonTapEvent("s"),
  ];
  const interactions = buildCanonicalInteractions(events);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  const clickAction = audit.actions.find((action) => action.actionType === "click");
  assert.ok(clickAction, "the click must be represented in the execution-readiness audit");
  assert.equal(clickAction.ready, true);
  assert.equal(clickAction.runtimeResolutionRequired, true);
});

test("9/ambiguity precondition unaffected: a button with NO structural relation at all (no associatedField, no technical evidence) stays unresolved_unrecoverable -- never a blanket relaxation", () => {
  seq = 0;
  const events = [tapEvent({ screenKey: "s", target: {} })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].resolutionState, "unresolved_unrecoverable");
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  assert.equal(audit.actions[0].ready, false);
});

test("6/namedButton regression. a button with a REAL accessible name/technical target is unaffected -- still certified as before", () => {
  seq = 0;
  const events = [tapEvent({ screenKey: "s", target: { label: "Buscar", role: "button", locators: [{ strategy: "aria-label", value: "Buscar" }] } })];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "accepted");
  assert.equal(interactions[0].resolutionState, "certified");
});

test("12/pressRegression. a press with no captured key stays hard-blocked even though it now shares the relaxed value requirement with click", () => {
  seq = 0;
  const events = [
    fillEvent({ screenKey: "s", target: { label: "Clave", associatedField: "Clave", locators: [{ strategy: "data-testid", value: "pwd" }] }, value: "secret" }),
    { seq: (seq += 1), t: seq * 100, kind: "press", screenKey: "s", note: "", target: { locators: [], associatedField: "Clave" } as unknown as RecordedTarget } as RecordedEvent,
  ];
  const interactions = buildCanonicalInteractions(events);
  const press = interactions.find((interaction) => interaction.action === "press");
  assert.ok(press);
  const audit = evaluateRecordedScenarioExecutionReadiness(baseScenario(interactions) as any);
  const pressAction = audit.actions.find((action) => action.actionType === "press");
  assert.equal(pressAction?.ready, false, "a press with no key must never become ready just because click's evidence requirement relaxed");
});

test("14/generic. no app/project/field hardcode drives the carve-out -- an arbitrary associatedField/role still qualifies", () => {
  for (const [field, id] of [["Cualquier campo", "a"], ["Otro campo distinto", "b"]] as const) {
    seq = 0;
    const events = [tapEvent({ screenKey: `s${id}`, target: { role: "button", associatedField: field } })];
    const interactions = buildCanonicalInteractions(events);
    assert.equal(interactions[0].resolutionState, "runtime_resolution_required", field);
  }
});
