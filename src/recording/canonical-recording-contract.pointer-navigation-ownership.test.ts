import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalInteractions, deriveExpectedRouteBefore, validateInteractionStateSequence } from "./canonical-recording-contract";

/**
 * FIRST_LOSS (recordingId=ba0dec1c-7db8-4793-9ef6-676c9fad98c8):
 * `transitionAfter` scanned past pointer notes (kind=note/observationType=pointer) because they
 * are not in `actionEvent`. A `fill` with no pointer anchor of its own would find and claim the
 * navigate event that belongs to the subsequent pointer tap, making `previous.routeAfter` !=
 * `next.routeBefore` and `stateSequenceValid=false`.
 *
 * Fixed by stopping `transitionAfter` at pointer notes — same boundary semantics as `press`.
 */

function ev(overrides: Record<string, unknown>) {
  return {
    seq: 0,
    t: 1,
    kind: "note",
    screenKey: "s",
    url: "/a",
    ...overrides,
  } as never;
}

// ─── Test 1: fill → pointer → navigate → tap ──────────────────────────────

test("1/fillThenPointerNavigation. fill does not steal navigation from subsequent pointer tap", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "fill", screenKey: "login", url: "/login", target: { label: "Campo", associatedField: "Campo", role: "textbox", locators: [{ strategy: "css", value: "#campo" }] }, value: "x" }),
    ev({ seq: 1, t: 2, kind: "note", observationType: "pointer", screenKey: "login", url: "/login" }),
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "login", url: "/dashboard" }),
    ev({ seq: 3, t: 4, kind: "tap", screenKey: "login", url: "/dashboard", target: { role: "button", associatedField: "Acción", locators: [{ strategy: "role", value: "button[name=Acción]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const fill = interactions.find((i) => i.action === "fill");
  const click = interactions.find((i) => i.action === "click");
  assert.equal(fill?.causedTransition, undefined, "fill must not own the navigation");
  assert.equal(click?.causedTransition, true, "tap must own the navigation");
  assert.equal(click?.routeAfter, "/dashboard");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

// ─── Test 2: modal dismiss (tap A) → pointer B → navigate → tap B ─────────

test("2/modalDismissThenNavigation. preceding tap does not steal navigation from subsequent pointer tap", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "gesture-A", screenKey: "dashboard", url: "/dashboard" }),
    ev({ seq: 1, t: 2, kind: "tap", interactionId: "gesture-A", screenKey: "dashboard", url: "/dashboard", target: { role: "button", associatedField: "Cerrar", locators: [{ strategy: "role", value: "button[name=Cerrar]" }] } }),
    ev({ seq: 2, t: 3, kind: "note", observationType: "pointer", interactionId: "gesture-B", screenKey: "dashboard", url: "/dashboard" }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "dashboard", url: "/payroll" }),
    ev({ seq: 4, t: 5, kind: "tap", interactionId: "gesture-B", screenKey: "dashboard", url: "/payroll", target: { role: "menuitem", associatedField: "Sección", locators: [{ strategy: "role", value: "menuitem[name=Sección]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const [dismissal, nav] = interactions;
  assert.equal(dismissal?.causedTransition, undefined, "modal dismiss tap must not own the navigation");
  assert.equal(nav?.causedTransition, true, "second tap must own the navigation");
  assert.equal(nav?.routeAfter, "/payroll");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

// ─── Test 3: same interactionId pair produces a single action owner ────────

test("3/sameInteractionIdentity. pointer note + tap for same gesture produce exactly one canonical action (no duplicate navigation interaction)", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", screenKey: "s", url: "/a" }),
    ev({ seq: 1, t: 2, kind: "navigate", screenKey: "s", url: "/b" }),
    ev({ seq: 2, t: 3, kind: "tap", screenKey: "s", url: "/b", target: { role: "button", associatedField: "Btn", locators: [{ strategy: "role", value: "button[name=Btn]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.equal(interactions.filter((i) => i.action === "navigation").length, 0, "no duplicate standalone navigation interaction");
  const tap = interactions.find((i) => i.action === "click");
  assert.equal(tap?.routeAfter, "/b");
});

// ─── Test 4: nav after tap (pointer then tap then navigate, no new interaction) ─

test("4/navigationAfterTap. navigation after tap still belongs to that tap when no new pointer starts", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", screenKey: "s", url: "/a" }),
    ev({ seq: 1, t: 2, kind: "tap", screenKey: "s", url: "/a", target: { role: "button", associatedField: "Enviar", locators: [{ strategy: "role", value: "button[name=Enviar]" }] } }),
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "s", url: "/b" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const tap = interactions.find((i) => i.action === "click");
  assert.equal(tap?.causedTransition, true);
  assert.equal(tap?.routeAfter, "/b");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

// ─── Test 5: two distinct interactions — nav stays with B ─────────────────

test("5/distinctInteractions. navigation cannot cross from interaction B to interaction A", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "gesture-A", screenKey: "s", url: "/a" }),
    ev({ seq: 1, t: 2, kind: "tap", interactionId: "gesture-A", screenKey: "s", url: "/a", target: { role: "button", associatedField: "X", locators: [{ strategy: "role", value: "button[name=X]" }] } }),
    ev({ seq: 2, t: 3, kind: "note", observationType: "pointer", interactionId: "gesture-B", screenKey: "s", url: "/a" }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "s", url: "/b" }),
    ev({ seq: 4, t: 5, kind: "tap", interactionId: "gesture-B", screenKey: "s", url: "/b", target: { role: "button", associatedField: "Y", locators: [{ strategy: "role", value: "button[name=Y]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const [tapA, tapB] = interactions;
  assert.equal(tapA?.causedTransition, undefined);
  assert.equal(tapB?.causedTransition, true);
  assert.equal(tapB?.routeAfter, "/b");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

// ─── Test 6: fill without pointer cannot consume navigation from pointer tap ──

test("6/fillCannotStealNavigation. fill without pointer anchor cannot consume navigation owned by subsequent pointer tap", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "fill", screenKey: "s", url: "/login", target: { label: "Clave", associatedField: "Clave", role: "textbox", locators: [{ strategy: "css", value: "#clave" }] }, value: "y" }),
    ev({ seq: 1, t: 2, kind: "note", observationType: "pointer", screenKey: "s", url: "/login" }),
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "s", url: "/home" }),
    ev({ seq: 3, t: 4, kind: "tap", screenKey: "s", url: "/home", target: { role: "button", associatedField: "Ingresar", locators: [{ strategy: "role", value: "button[name=Ingresar]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const fill = interactions.find((i) => i.action === "fill");
  assert.equal(fill?.causedTransition, undefined);
  const click = interactions.find((i) => i.action === "click");
  assert.equal(click?.causedTransition, true);
  assert.equal(click?.routeAfter, "/home");
});

// ─── Test 7: legacy trace without pointer notes still parses correctly ─────

test("7/legacy. trace without pointer notes: fill + press → press owns navigation (legacy fallback unchanged)", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "fill", screenKey: "s", url: "/a", target: { label: "Campo", associatedField: "Campo", role: "textbox", locators: [{ strategy: "css", value: "#f" }] }, value: "v" }),
    ev({ seq: 1, t: 2, kind: "press", screenKey: "s", url: "/a", target: { label: "Campo", associatedField: "Campo", role: "textbox", locators: [{ strategy: "css", value: "#f" }] }, note: "Enter" }),
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "s", url: "/b" }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const press = interactions.find((i) => i.action === "press");
  assert.equal(press?.routeAfter, "/b");
  assert.equal(press?.causedTransition, true);
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

// ─── Test 8: canonical round-trip — routeAfter/routeBefore chain ──────────

test("8/canonicalRoundTrip. previous.routeAfter === next.routeBefore when pointer tap causes transition", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "fill", screenKey: "s", url: "/login", target: { label: "F", associatedField: "F", role: "textbox", locators: [{ strategy: "css", value: "#f" }] }, value: "v" }),
    ev({ seq: 1, t: 2, kind: "note", observationType: "pointer", screenKey: "s", url: "/login" }),
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "s", url: "/home" }),
    ev({ seq: 3, t: 4, kind: "tap", screenKey: "s", url: "/home", target: { role: "button", associatedField: "Btn", locators: [{ strategy: "role", value: "button[name=Btn]" }] } }),
    ev({ seq: 4, t: 5, kind: "note", observationType: "pointer", screenKey: "home", url: "/home" }),
    ev({ seq: 5, t: 6, kind: "tap", screenKey: "home", url: "/home", target: { role: "button", associatedField: "Next", locators: [{ strategy: "role", value: "button[name=Next]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
  const [fill, loginTap] = interactions;
  assert.equal(fill?.routeAfter, undefined, "fill owns no transition");
  assert.equal(loginTap?.routeAfter, "/home");
  assert.equal(loginTap?.routeBefore, "/login");
});

// ─── Test 9: physical-shaped regression — Case 1 ─────────────────────────

test("9a/physicalCase1. fill → pointer → navigate → tap: replicates physical recording shape (Case 1)", () => {
  const events = [
    ev({ seq: 10, t: 10, kind: "fill", screenKey: "auth", url: "/login", target: { label: "Clave", associatedField: "Clave", role: "textbox", locators: [{ strategy: "css", value: "#pwd" }] }, value: "hidden" }),
    ev({ seq: 11, t: 11, kind: "note", observationType: "pointer", screenKey: "auth", url: "/login" }),
    ev({ seq: 12, t: 12, kind: "navigate", screenKey: "auth", url: "/main" }),
    ev({ seq: 13, t: 13, kind: "tap", screenKey: "auth", url: "/main", target: { role: "button", associatedField: "Continuar", locators: [{ strategy: "role", value: "button[name=Continuar]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const fill = interactions.find((i) => i.action === "fill");
  const tap = interactions.find((i) => i.action === "click");
  assert.equal(fill?.causedTransition, undefined);
  assert.equal(tap?.causedTransition, true);
  assert.equal(tap?.routeAfter, "/main");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("9b/physicalCase2. modal tap → pointer B → navigate → tap B: replicates physical recording shape (Case 2)", () => {
  const events = [
    ev({ seq: 14, t: 14, kind: "note", observationType: "pointer", interactionId: "gesture-14", screenKey: "main", url: "/main" }),
    ev({ seq: 15, t: 15, kind: "tap", interactionId: "gesture-14", screenKey: "main", url: "/main", target: { role: "button", associatedField: "Cerrar", locators: [{ strategy: "role", value: "button[name=Cerrar]" }] } }),
    ev({ seq: 16, t: 16, kind: "note", observationType: "pointer", interactionId: "gesture-17", screenKey: "main", url: "/main" }),
    ev({ seq: 17, t: 17, kind: "navigate", screenKey: "main", url: "/section" }),
    ev({ seq: 18, t: 18, kind: "tap", interactionId: "gesture-17", screenKey: "main", url: "/section", target: { role: "menuitem", associatedField: "Sección", locators: [{ strategy: "role", value: "menuitem[name=Sección]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const [tapA, tapB] = interactions;
  assert.equal(tapA?.causedTransition, undefined, "modal dismiss must not own the navigation");
  assert.equal(tapB?.causedTransition, true);
  assert.equal(tapB?.routeAfter, "/section");
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

// ─── Test 10: no temporal heuristic — only structural boundaries ──────────

test("10/noTemporalHeuristic. ownership is determined by pointer note boundary, not timestamp proximity", () => {
  // Long gap (t=100) between pointer note and its tap: still correctly owned because boundary is structural.
  const events = [
    ev({ seq: 0, t: 1, kind: "fill", screenKey: "s", url: "/a", target: { label: "F", associatedField: "F", role: "textbox", locators: [{ strategy: "css", value: "#f" }] }, value: "v" }),
    ev({ seq: 1, t: 2, kind: "note", observationType: "pointer", screenKey: "s", url: "/a" }),
    ev({ seq: 2, t: 100, kind: "navigate", screenKey: "s", url: "/b" }),
    ev({ seq: 3, t: 101, kind: "tap", screenKey: "s", url: "/b", target: { role: "button", associatedField: "Btn", locators: [{ strategy: "role", value: "button[name=Btn]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const fill = interactions.find((i) => i.action === "fill");
  const tap = interactions.find((i) => i.action === "click");
  assert.equal(fill?.causedTransition, undefined, "fill never owns navigation regardless of timing");
  assert.equal(tap?.causedTransition, true);
});

// ─── Test 11: delayed tap delivery keeps the first transition with its action ─

test("11/delayedTapDelivery. first transition after pointer belongs to that action, later transitions await their own pointer", () => {
  const events = [
    ev({ seq: 0, t: 1, kind: "note", observationType: "pointer", interactionId: "gesture-A", screenKey: "s", url: "/start" }),
    // The browser emits the first transition before the recorder flushes the tap.
    ev({ seq: 1, t: 2, kind: "navigate", screenKey: "s", url: "/middle-1" }),
    // Additional browser transitions arrive before the delayed tap, but are not owned by A.
    ev({ seq: 2, t: 3, kind: "navigate", screenKey: "s", url: "/middle-2" }),
    ev({ seq: 3, t: 4, kind: "navigate", screenKey: "s", url: "/final" }),
    ev({ seq: 4, t: 5, kind: "tap", interactionId: "gesture-A", screenKey: "s", url: "/final", target: { role: "button", associatedField: "A", locators: [{ strategy: "role", value: "button[name=A]" }] } }),
    ev({ seq: 5, t: 6, kind: "note", observationType: "pointer", interactionId: "gesture-B", screenKey: "s", url: "/final" }),
    ev({ seq: 6, t: 7, kind: "tap", interactionId: "gesture-B", screenKey: "s", url: "/final", target: { role: "button", associatedField: "B", locators: [{ strategy: "role", value: "button[name=B]" }] } }),
  ];
  const interactions = buildCanonicalInteractions(events);
  const [actionA, actionB] = interactions;
  assert.equal(actionA?.routeBefore, "/start");
  assert.equal(actionA?.routeAfter, "/middle-1");
  assert.equal(actionB?.routeBefore, "/final");
  assert.equal(actionB?.routeAfter, undefined);
  assert.equal(deriveExpectedRouteBefore(actionB!, actionA!), "/middle-1");
  assert.equal(validateInteractionStateSequence(interactions).stateSequenceValid, false, "raw delayed-delivery evidence remains auditable; replay uses the preceding owned transition");
});
