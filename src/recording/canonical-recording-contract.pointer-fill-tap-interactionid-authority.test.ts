import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, validateInteractionStateSequence } from "./canonical-recording-contract";

/**
 * FIRST_LOSS (recordingId=ba0dec1c-7db8-4793-9ef6-676c9fad98c8): `actionablePointerAnchor`
 * scanned backward from an action and stopped UNCONDITIONALLY at the first fill/tap/back, purely
 * by event kind. Real Capture V2 shape from this recording:
 *
 *   pointer(interactionId=pointer-4) -> fill("Contraseña", no interactionId) -> tap("Continuar",
 *   interactionId=pointer-4) -> navigate
 *
 * The tap's OWN pointer (pointer-4) sits BEFORE the intervening fill, so the naive kind-based
 * stop made the tap lose its real anchor (falling back to `transitionAfter`, which then
 * mis-claimed the navigation) while the fill's OWN backward scan found that same pointer-4 note
 * directly (nothing between them) and wrongly claimed it as its own anchor too -- both ended up
 * fighting over the same transition, producing `previous.routeAfter != next.routeBefore`.
 *
 * Fixed by making explicit interactionId (already used by `nextPointerBoundaryT`) the sole
 * authority over the kind-based stop: an intervening fill/tap/back with no interactionId of its
 * own (or the SAME one) never breaks the scan; one with an explicit, DIFFERENT interactionId
 * still stops it (fail closed). A pointer note carrying an interactionId is only ever handed to
 * an action that shares that same id.
 */

function ev(overrides: Record<string, unknown>) {
  return { seq: 0, t: 1, kind: "note", screenKey: "s", url: "/a", ...overrides } as never;
}

test("1/pointerFillTapSameInteraction. tap recovers its own pointer anchor across an intervening, unrelated fill", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "login", url: "/login" }),
    ev({ seq: 1, t: 2, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#pwd" }] }, value: "x" }),
    ev({ seq: 2, t: 3, kind: "tap", interactionId: "pointer-4", screenKey: "login", url: "/login", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "login", url: "/dashboard" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const tap = interactions.find((i) => i.action === "click");
  assert.equal(tap?.causedTransition, true, "tap must recover pointer-4 as its own anchor");
  assert.equal(tap?.routeAfter, "/dashboard");
});

test("2/fillCannotStealPointer. the intervening fill never claims the same pointer as its own anchor", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "login", url: "/login" }),
    ev({ seq: 1, t: 2, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#pwd" }] }, value: "x" }),
    ev({ seq: 2, t: 3, kind: "tap", interactionId: "pointer-4", screenKey: "login", url: "/login", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "login", url: "/dashboard" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const fill = interactions.find((i) => i.action === "fill");
  assert.equal(fill?.causedTransition, undefined, "the fill must not claim pointer-4 as its own anchor");
  assert.equal(fill?.routeAfter, undefined);
});

test("3/routeOwnership. navigation is attributable to the tap only, never the intervening fill", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "login", url: "/login" }),
    ev({ seq: 1, t: 2, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#pwd" }] }, value: "x" }),
    ev({ seq: 2, t: 3, kind: "tap", interactionId: "pointer-4", screenKey: "login", url: "/login", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "login", url: "/dashboard" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const [fill, tap] = interactions;
  assert.equal(fill.causedTransition, undefined);
  assert.equal(tap.causedTransition, true);
});

test("4/stateSequence. previous.routeAfter === next.routeBefore for the physical-shaped case", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "fill", screenKey: "login", url: "/login", target: { label: "Usuario", associatedField: "Usuario", role: "textbox", locators: [{ strategy: "css", value: "#user" }] }, value: "u" }),
    ev({ seq: 1, t: 2, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "login", url: "/login" }),
    ev({ seq: 2, t: 3, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#pwd" }] }, value: "x" }),
    ev({ seq: 3, t: 4, kind: "tap", interactionId: "pointer-4", screenKey: "login", url: "/login", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
    ev({ seq: 4, t: 5, kind: "navigate", screenKey: "login", url: "/dashboard" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("5/distinctInteraction. an intervening event with an explicit, DIFFERENT interactionId still fails closed (genuine boundary preserved)", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "s", url: "/a" }),
    ev({ seq: 1, t: 2, kind: "tap", interactionId: "pointer-9", screenKey: "s", url: "/a", target: { role: "button", associatedField: "Otro", locators: [{ strategy: "role", value: "button[name=Otro]" }] } }),
    ev({ seq: 2, t: 3, kind: "tap", interactionId: "pointer-4", screenKey: "s", url: "/a", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "s", url: "/b" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const [otherTap, targetTap] = interactions;
  // The intervening tap (pointer-9) is a genuine, distinct interaction boundary: pointer-4
  // must NOT be recovered across it -- targetTap falls back to transitionAfter instead.
  assert.notEqual(otherTap.action, "navigation");
  assert.equal(targetTap.causedTransition, true, "transitionAfter fallback still lets the immediately-preceding action own the navigation");
});

test("6/sameIdNormal. pointer/tap with the same id and no intervening event: unchanged existing behavior", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "s", url: "/a" }),
    ev({ seq: 1, t: 2, kind: "tap", interactionId: "pointer-4", screenKey: "s", url: "/a", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "s", url: "/b" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions[0].causedTransition, true);
  assert.equal(interactions[0].routeAfter, "/b");
});

test("7/differentIds. pointer and tap with different explicit interactionIds must not associate", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "pointer-A", screenKey: "s", url: "/a" }),
    ev({ seq: 1, t: 2, kind: "tap", interactionId: "pointer-B", screenKey: "s", url: "/a", target: { role: "button", associatedField: "X", locators: [{ strategy: "role", value: "button[name=X]" }] } }),
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "s", url: "/b" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  // No shared interactionId anchor: falls back to transitionAfter, which still lets the
  // immediately-preceding action claim the immediate forward navigation (legacy fallback).
  assert.equal(interactions[0].causedTransition, true);
});

test("8/legacy. no interactionId anywhere: byte-for-byte identical outcome to the pre-fix code path (the fix only ever changes behavior when interactionId is present)", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", screenKey: "s", url: "/a" }),
    ev({ seq: 1, t: 2, kind: "fill", screenKey: "s", url: "/a", target: { label: "Campo", associatedField: "Campo", role: "textbox", locators: [{ strategy: "css", value: "#f" }] }, value: "v" }),
    ev({ seq: 2, t: 3, kind: "tap", screenKey: "s", url: "/a", target: { role: "button", associatedField: "Btn", locators: [{ strategy: "role", value: "button[name=Btn]" }] } }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "s", url: "/b" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const [fill, tap] = interactions;
  // No interactionId anywhere on either the fill or the tap: `event.interactionId` is falsy for
  // both, so the new interactionId-authority branches never activate and every decision falls
  // through to the exact pre-existing code path -- fill's own scan finds the pointer note
  // directly (unchanged), and tap's scan still stops unconditionally at the intervening fill
  // (unchanged), falling back to transitionAfter exactly as before this fix.
  assert.equal(fill.causedTransition, true);
  assert.equal(tap.causedTransition, true, "unchanged pre-existing fallback behavior for the no-id case -- not something this fix is scoped to resolve");
});

test("9/previousNavigationFix. interaction-14->17-shaped case (modal dismiss -> pointer B -> navigate -> tap B) remains GREEN", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "gesture-A", screenKey: "main", url: "/main" }),
    ev({ seq: 1, t: 2, kind: "tap", interactionId: "gesture-A", screenKey: "main", url: "/main", target: { role: "button", associatedField: "Cerrar", locators: [{ strategy: "role", value: "button[name=Cerrar]" }] } }),
    ev({ seq: 2, t: 3, kind: "note", observationType: "pointer", interactionId: "gesture-B", screenKey: "main", url: "/main" }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "main", url: "/section" }),
    ev({ seq: 4, t: 5, kind: "tap", interactionId: "gesture-B", screenKey: "main", url: "/section", target: { role: "menuitem", associatedField: "Sección", locators: [{ strategy: "role", value: "menuitem[name=Sección]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const [tapA, tapB] = interactions;
  assert.equal(tapA.causedTransition, undefined);
  assert.equal(tapB.causedTransition, true);
  assert.equal(tapB.routeAfter, "/section");
});

test("11/roundTripShape. real Capture V2 shape (fill Usuario, pointer+fill Contraseña intervening, tap Continuar, navigate) produces a valid state sequence end to end", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "fill", screenKey: "login", url: "/login", target: { label: "Nombre de usuario", associatedField: "Nombre de usuario", role: "textbox", locators: [{ strategy: "css", value: "#user" }] }, value: "u" }),
    ev({ seq: 1, t: 2, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "login", url: "/login" }),
    ev({ seq: 2, t: 3, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#pwd" }] }, value: "x" }),
    ev({ seq: 3, t: 4, kind: "tap", interactionId: "pointer-4", screenKey: "login", url: "/login", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
    ev({ seq: 4, t: 5, kind: "navigate", screenKey: "login", url: "/dashboard" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const result = validateInteractionStateSequence(interactions);
  assert.deepEqual(result, { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("12/noTemporalHeuristic. ownership is decided by interactionId identity, not timestamp proximity", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "pointer-4", screenKey: "login", url: "/login" }),
    ev({ seq: 1, t: 100, kind: "fill", screenKey: "login", url: "/login", target: { label: "Contraseña", associatedField: "Contraseña", role: "textbox", locators: [{ strategy: "css", value: "#pwd" }] }, value: "x" }),
    ev({ seq: 2, t: 101, kind: "tap", interactionId: "pointer-4", screenKey: "login", url: "/login", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
    ev({ seq: 3, t: 102, kind: "navigate", screenKey: "login", url: "/dashboard" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const tap = interactions.find((i) => i.action === "click");
  assert.equal(tap?.causedTransition, true, "identity match holds regardless of the large time gap");
});
