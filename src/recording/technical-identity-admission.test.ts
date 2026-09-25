import assert from "node:assert/strict";
import test from "node:test";
import { isTechnicalIdentityAdmissible, isGenericUnresolvedLabel } from "./trace-normalizer";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * Single source of truth for the admission gate: isTechnicalIdentityAdmissible/
 * isGenericUnresolvedLabel (trace-normalizer.ts) decide, once, whether a target's identity is
 * strong enough to be executable authority — consumed identically by post-transition owner
 * recertification, semantic field resolution (semantic-recording.ts), and trace/scenario
 * rendering (trace-to-scenario.ts), so none of them can independently decide differently
 * whether "control" or "Campo pendiente de identificar" is admissible.
 */

test("1. stable attribute (data-testid/id) is admissible technical identity", () => {
  assert.equal(isTechnicalIdentityAdmissible({ label: "x", locators: [], attributes: { "data-testid": "field-a" } } as RecordedTarget), true);
  assert.equal(isTechnicalIdentityAdmissible({ label: "x", locators: [], attributes: { id: "field-b" } } as RecordedTarget), true);
});

test("2. a stable, non-positional structural locator is admissible", () => {
  const target = { label: "x", locators: [{ strategy: "structural", value: "grid=g1|row=1|cell=c1" }] } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(target), true);
});

test("3. a text-only locator carries no admission authority on its own", () => {
  const target = { label: "x", locators: [{ strategy: "text", value: "Cuentas de Efectivo" }] } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(target), false);
});

test("4. generic label 'control' with no technical identity is rejected", () => {
  assert.equal(isGenericUnresolvedLabel("control"), true);
  const target = { label: "control", locators: [] } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(target), false);
});

test("5. 'Campo pendiente de identificar' is recognized as an unresolved display fallback, never technical authority", () => {
  // The literal string itself carries no technical identity — it is display-only fallback text,
  // and a target whose only identity is that text must never be admitted.
  const target = { label: "Campo pendiente de identificar", locators: [] } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(target), false);
});

test("6. a role+value locator (the fixture that previously forced widening to 'any locator') has independent technical evidence and is admitted", () => {
  const target = { label: "select", locators: [{ strategy: "role", value: "checkbox|select" }] } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(target), true, "role+value identifies the element independent of its display text — legitimately admissible, not a legacy-test concession");
});

test("a positional (ambiguous) locator never grants admission on its own, even with a normally-admissible strategy", () => {
  const target = { label: "x", locators: [{ strategy: "id", value: "generated-42", ambiguous: true, matchIndex: 2 }] } as RecordedTarget;
  assert.equal(isTechnicalIdentityAdmissible(target), false);
});

// --- Integration: the same decision drives buildCanonicalInteractions' admission gate ---

let seq = 0;
function tapEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string } }): RecordedEvent {
  seq += 1;
  return { seq, t: seq * 100, kind: "tap", screenKey: overrides.screenKey, target: { locators: [], ...overrides.target } as RecordedTarget };
}

test("7. post-transition + text-locator-only owner: rejected, never recertified", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-login", target: { label: "Login", attributes: { "data-testid": "login" }, locators: [{ strategy: "data-testid", value: "login" }] } }),
    tapEvent({ screenKey: "surface-next", target: { label: "Login", associatedField: "Login", locators: [{ strategy: "text", value: "Login" }], afterValue: "x" } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const postTransition = interactions[1];
  assert.equal(postTransition.ownerRecertificationRequired, true);
  assert.equal(postTransition.admissionStatus, "unresolved");
  assert.equal(postTransition.semanticField, undefined);
});

test("8. post-transition + genuine structural identity on the new surface: admitted as a NEW owner", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-login", target: { label: "Login", attributes: { "data-testid": "login" }, locators: [{ strategy: "data-testid", value: "login" }] } }),
    tapEvent({ screenKey: "surface-next", target: { label: "Cuenta A", associatedField: "Tipo de producto", attributes: { "data-testid": "account-field" }, afterValue: "Cuenta A" } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const postTransition = interactions[1];
  assert.equal(postTransition.admissionStatus, "accepted");
  assert.equal(postTransition.semanticField, "Tipo de producto");
});

test("9. same display text on two surfaces, only one technically corroborated: never treated as the same admitted owner", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-a", target: { label: "Continuar", attributes: { "data-testid": "continue-a" } } }),
    tapEvent({ screenKey: "surface-b", target: { label: "Continuar", locators: [{ strategy: "text", value: "Continuar" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "accepted");
  assert.equal(interactions[1].admissionStatus, "unresolved", "same text must never substitute for the missing technical identity on surface b");
});

test("generic label rejected even with NO surface transition at all (general admission gate, not only post-transition)", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-a", target: { label: "control", locators: [] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].admissionStatus, "unresolved");
  assert.equal(interactions[0].admissionReason, "generic_label_without_technical_identity");
  assert.equal(interactions[0].semanticField, undefined);
  assert.equal(interactions[0].description, undefined, "raw label evidence must not surface as if it were an executable target's description");
});
