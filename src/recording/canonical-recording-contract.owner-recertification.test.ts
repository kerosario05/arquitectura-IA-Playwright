import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions } from "./canonical-recording-contract";
import type { RecordedEvent, RecordedTarget } from "./session-trace.types";

/**
 * Physical recording evidence: a post-login selection materialized as
 * `Seleccionar "<value>" en "Iniciar sesión"` — the login button's field context survived a
 * real navigation (/login -> /requests/create/multiproduct) into an action on the new surface.
 * canonical-recording-contract.ts never actually inherits a target across events (fieldOf/
 * stableControlOf always read only the current event's own target) — ownershipForEvent already
 * correctly detects the transition (screenBeforeRef/screenAfterRef/transitionObserved). The gap
 * was that a field/owner identity resolved purely from an ancestor-walk label/header (fieldOf)
 * was trusted even for the first interaction on a brand new screen, with no requirement that it
 * be grounded in structural evidence captured on THAT interaction's own target — exactly the
 * kind of signal that can still reflect the previous screen's DOM for a brief window after a
 * transition. Fixed by withholding semanticField/description (never target text comparison)
 * whenever the first interaction on a new screenKey lacks a stable attribute/locator of its own.
 */

let seq = 0;
function tapEvent(overrides: { screenKey: string; target: Partial<RecordedTarget> & { label: string } }): RecordedEvent {
  seq += 1;
  return {
    seq,
    t: seq * 100,
    kind: "tap",
    screenKey: overrides.screenKey,
    target: { locators: [], ...overrides.target } as RecordedTarget,
  };
}

function corroboratedTarget(label: string, testId: string, extra: Partial<RecordedTarget> = {}): Partial<RecordedTarget> & { label: string } {
  return {
    label,
    attributes: { "data-testid": testId },
    locators: [{ strategy: "data-testid", value: testId, confidence: 0.95 }],
    ...extra,
  };
}

function uncorroboratedTarget(label: string, extra: Partial<RecordedTarget> = {}): Partial<RecordedTarget> & { label: string } {
  return { label, attributes: {}, locators: [], ...extra };
}

test("1. same surface: an uncorroborated field is still trusted when no screen transition occurred", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-a", target: corroboratedTarget("Documento", "doc-field", { associatedField: "Documento" }) }),
    tapEvent({ screenKey: "surface-a", target: uncorroboratedTarget("Nombre", { associatedField: "Nombre" }) }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 2);
  assert.equal(interactions[1].semanticField, "Nombre");
  assert.ok(!interactions[1].ownerRecertificationRequired);
});

test("2. surface transition + no structural corroboration: field/owner is withheld, never inherited from the previous screen", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-login", target: corroboratedTarget("Iniciar sesión", "login-button") }),
    tapEvent({ screenKey: "surface-requests", target: uncorroboratedTarget("Opción X", { associatedField: "Iniciar sesión", afterValue: "Opción X" }) }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 2);
  const postTransition = interactions[1];
  assert.equal(postTransition.semanticField, undefined, "must never carry the previous surface's field text");
  assert.equal(postTransition.description, undefined, "must not fall back to the raw label either, since that is the same vulnerable signal");
  assert.equal(postTransition.ownerRecertificationRequired, true);
});

test("3. same display text on two different, independently-corroborated owners is never treated as the same owner", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-a", target: corroboratedTarget("Continuar", "continue-a", { associatedField: "Paso 1" }) }),
    tapEvent({ screenKey: "surface-b", target: corroboratedTarget("Continuar", "continue-b", { associatedField: "Paso 2" }) }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.length, 2);
  assert.equal(interactions[0].semanticField, "Paso 1");
  assert.equal(interactions[1].semanticField, "Paso 2");
  assert.notEqual(interactions[0].controlIdentity, interactions[1].controlIdentity);
});

test("4. surface transition WITH structural corroboration on the new surface: the new owner is admitted, not blocked", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-login", target: corroboratedTarget("Iniciar sesión", "login-button") }),
    tapEvent({ screenKey: "surface-requests", target: corroboratedTarget("Cuenta A", "customer-account-field", { associatedField: "Tipo de producto", afterValue: "Cuenta A" }) }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const postTransition = interactions[1];
  assert.equal(postTransition.semanticField, "Tipo de producto");
  assert.equal(postTransition.recordedValue, "Cuenta A");
  assert.ok(!postTransition.ownerRecertificationRequired);
});

test("5. portal-comercial-shaped regression fixture: login -> surface transition -> post-login selection never carries the login field", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "screen:login", target: corroboratedTarget("Iniciar sesión", "btn-login") }),
    tapEvent({
      screenKey: "screen:requests-create-multiproduct",
      target: uncorroboratedTarget("WPX5ZUJ U52SW4S5 WZW WSJP5ZW", { associatedField: "Iniciar sesión", afterValue: "WPX5ZUJ U52SW4S5 WZW WSJP5ZW" }),
    }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const loginAction = interactions[0];
  const postLoginAction = interactions[1];
  assert.notEqual(postLoginAction.semanticField, loginAction.semanticField);
  assert.notEqual(postLoginAction.semanticField, "Iniciar sesión");
  assert.equal(postLoginAction.ownerRecertificationRequired, true);
});
