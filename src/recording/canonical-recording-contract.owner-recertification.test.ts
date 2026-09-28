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

/**
 * Recording b56d2e4e (kiosko): "Generar Turno" is a card-shaped <button> (heading + description),
 * so Capture V2 records no exact role locator, only a unique structural identity. Once the modal it
 * lives in is registered as its own screen, the click is the first action on a new surface.
 */
function cardButtonTarget(extra: Partial<RecordedTarget> = {}): Partial<RecordedTarget> & { label: string } {
  return {
    label: "Generar Turno",
    role: "button",
    tag: "button",
    attributes: {},
    locators: [],
    technicalTargetCandidates: [{
      targetType: "structural",
      locatorCandidates: [],
      structuralContext: {
        owner: { tag: "button" },
        stableDirectAttributes: {},
        stableDescendants: [],
        semanticShape: ["div", "h3", "p"],
        deterministicStructuralIdentity: true,
        topologyTieBreakUnique: true,
        structuralIdentityMatchCount: 1,
      },
      interactionEvidence: ["v2_click_owner"],
      confidence: 0.85,
      validatedByInteraction: true,
    }],
    ...extra,
  } as Partial<RecordedTarget> & { label: string };
}

test("6. post-transition click on a card button with its own unique structural identity is admitted for runtime resolution", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-product", target: corroboratedTarget("Solicitar", "solicitar") }),
    tapEvent({ screenKey: "surface-turn-modal", target: cardButtonTarget() }),
  ];
  const postTransition = buildCanonicalInteractions(events)[1];
  assert.ok(!postTransition.ownerRecertificationRequired);
  assert.equal(postTransition.resolutionState, "runtime_resolution_required");
});

test("7. the same structural evidence never readmits a field label inherited from the previous screen", () => {
  seq = 0;
  const events: RecordedEvent[] = [
    tapEvent({ screenKey: "surface-login", target: corroboratedTarget("Iniciar sesión", "login-button") }),
    tapEvent({ screenKey: "surface-requests", target: cardButtonTarget({ label: "Opción X", associatedField: "Iniciar sesión" }) }),
  ];
  const postTransition = buildCanonicalInteractions(events)[1];
  assert.equal(postTransition.ownerRecertificationRequired, true);
  assert.notEqual(postTransition.semanticField, "Iniciar sesión");
});

test("8. an ambiguous or non-unique structural identity is still not enough after a transition", () => {
  for (const structural of [
    { identityAmbiguous: true },
    { topologyTieBreakUnique: false, structuralIdentityMatchCount: 2 },
    { deterministicStructuralIdentity: false },
  ]) {
    seq = 0;
    const base = cardButtonTarget();
    const candidate = base.technicalTargetCandidates![0];
    const target = { ...base, technicalTargetCandidates: [{ ...candidate, structuralContext: { ...candidate.structuralContext!, ...structural } }] };
    const events: RecordedEvent[] = [
      tapEvent({ screenKey: "surface-product", target: corroboratedTarget("Solicitar", "solicitar") }),
      tapEvent({ screenKey: "surface-turn-modal", target }),
    ];
    assert.equal(buildCanonicalInteractions(events)[1].ownerRecertificationRequired, true, JSON.stringify(structural));
  }
});
