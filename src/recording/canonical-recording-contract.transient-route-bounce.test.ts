import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCanonicalInteractions,
  reconcileTransientRouteTransitions,
  validateInteractionStateSequence,
  type CanonicalInteraction,
} from "./canonical-recording-contract";
import type { RecordedEvent } from "./session-trace.types";

/**
 * FIRST_LOSS (recording 58fb8166-1f85-4b30-b19c-6953de7b75ff, app kiosko): a kiosk emits its own
 * navigation back to the attract screen while the user is mid-keypad, then returns to the page
 * without emitting a navigate of its own. `causalTransition` claims the LAST navigation inside
 * the action's pointer window, so that one-off blip became `interaction-34.routeAfter="/"` while
 * the very next action still started on `/product-extended?...`.
 *
 * Nothing downstream ever checked whether the recorded destination HELD. `validateInteractionStateSequence`
 * then correctly reported the broken chain -- but, as in
 * `canonical-recording-contract.state-sequence-press.test.ts`, the defect was the upstream
 * evidence, not the validator: a destination the very next action contradicts, returning to the
 * same `routeBefore`, was never a transition at all.
 *
 * The cost was disproportionate: one spurious sample zeroed `stateSequenceValid`, which the UI
 * multiplies into BOTH `technicalReadiness` and `executionActionReadiness`, disabling replay for
 * a scenario whose 15 actions were all individually ready (13 certified, 2
 * `runtime_resolution_required`).
 *
 * Fixed by `reconcileTransientRouteTransitions`: a recorded `routeAfter` is dropped, together
 * with the transition flags it justified, only when the next executable action BOTH contradicts
 * it AND returns to the same `routeBefore`. Both conditions are required -- a real forward
 * navigation never satisfies the second one.
 */

const PRODUCT = "https://kiosk.test/product-extended?product=visa";
const HOME = "https://kiosk.test/";
const CATALOG = "https://kiosk.test/product-catalog";

function tap(seq: number, t: number, url: string, label: string, screenKey = "keypad"): RecordedEvent {
  return {
    seq,
    t,
    kind: "tap",
    screenKey,
    url,
    target: { label, associatedField: label, role: "button", locators: [{ strategy: "css", value: `#k${label}` }] },
  } as unknown as RecordedEvent;
}

/** The persisted shape of the real interactions 34 and 37, as `scenarios.json` holds them. */
function persistedKioskBounce(): CanonicalInteraction[] {
  return [
    {
      id: "interaction-34",
      action: "click",
      routeBefore: PRODUCT,
      routeAfter: HOME,
      screenBeforeRef: "a55a1c9d0381",
      screenAfterRef: "a55a1c9d0381",
      causedTransition: true,
      transitionObserved: true,
      terminalForContext: true,
    },
    {
      id: "interaction-37",
      action: "click",
      routeBefore: PRODUCT,
      screenBeforeRef: "a55a1c9d0381",
      screenAfterRef: "a55a1c9d0381",
    },
  ] as unknown as CanonicalInteraction[];
}

test("1/bounce. a navigation the next action contradicts is never claimed as the action's destination", () => {
  const events = [
    { seq: 0, t: 10, kind: "pointerdown", screenKey: "keypad", url: PRODUCT },
    tap(1, 11, PRODUCT, "9"),
    // The kiosk bounces home on its own and comes back without a navigate of its own.
    { seq: 2, t: 12, kind: "navigate", screenKey: "keypad", url: HOME },
    { seq: 3, t: 20, kind: "pointerdown", screenKey: "keypad", url: PRODUCT },
    tap(4, 21, PRODUCT, "3"),
  ] as unknown as RecordedEvent[];

  const interactions = buildCanonicalInteractions(events);
  const first = interactions.find((interaction) => interaction.semanticField === "9");
  assert.ok(first, "the first keypad tap must produce its own canonical interaction");
  assert.equal(first!.routeAfter, undefined, "a destination that did not hold is not a destination");
  assert.notEqual(first!.causedTransition, true, "no transition was caused, so the flag must not survive");
  assert.deepEqual(
    validateInteractionStateSequence(interactions),
    { stateSequenceValid: true, stateSequenceIssues: [] },
    "the keypad sequence is coherent: both taps happened on the same screen",
  );
});

test("2/forward. a real forward navigation is still claimed by the action that caused it", () => {
  const events = [
    { seq: 0, t: 10, kind: "pointerdown", screenKey: "menu", url: HOME },
    tap(1, 11, HOME, "Explora", "menu"),
    { seq: 2, t: 12, kind: "navigate", screenKey: "catalog", url: CATALOG },
    { seq: 3, t: 20, kind: "pointerdown", screenKey: "catalog", url: CATALOG },
    tap(4, 21, CATALOG, "Tarjetas", "catalog"),
  ] as unknown as RecordedEvent[];

  const interactions = buildCanonicalInteractions(events);
  const first = interactions.find((interaction) => interaction.semanticField === "Explora");
  assert.ok(first, "the menu tap must produce its own canonical interaction");
  assert.equal(first!.routeAfter, CATALOG, "the destination held, so the action keeps claiming it");
  assert.equal(first!.causedTransition, true);
  assert.deepEqual(validateInteractionStateSequence(interactions), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("3/persisted. a scenario already on disk with the bounce is repaired by reconciliation alone", () => {
  const persisted = persistedKioskBounce();
  assert.equal(
    validateInteractionStateSequence(persisted).stateSequenceValid,
    false,
    "guard: the persisted shape really does reproduce the reported incoherence",
  );

  const reconciled = reconcileTransientRouteTransitions(persisted);
  assert.equal(reconciled[0]!.routeAfter, undefined);
  assert.notEqual(reconciled[0]!.causedTransition, true);
  assert.notEqual(reconciled[0]!.transitionObserved, true);
  assert.notEqual(reconciled[0]!.terminalForContext, true);
  assert.deepEqual(validateInteractionStateSequence(reconciled), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("4/identity. reconciliation returns the very same array when there is nothing to repair", () => {
  const clean = [
    { id: "a", action: "click", routeBefore: HOME, routeAfter: CATALOG, causedTransition: true },
    { id: "b", action: "click", routeBefore: CATALOG },
  ] as unknown as CanonicalInteraction[];

  assert.equal(
    reconcileTransientRouteTransitions(clean),
    clean,
    "callers rely on identity to skip rewriting untouched scenarios",
  );
});

test("5/noEvidence. a destination the next action neither confirms nor contradicts is left alone", () => {
  // `routeBefore` absent on the next action means no evidence either way. Dropping the recorded
  // destination there would be inventing a verdict the recording never supports.
  const unknown = [
    { id: "a", action: "click", routeBefore: PRODUCT, routeAfter: HOME, causedTransition: true },
    { id: "b", action: "click" },
  ] as unknown as CanonicalInteraction[];

  assert.equal(reconcileTransientRouteTransitions(unknown)[0]!.routeAfter, HOME);
});

test("6/movedOn. a destination that changed without returning is a real transition, not a bounce", () => {
  // The next action starts somewhere ELSE than both the recorded destination and the previous
  // `routeBefore`: the app genuinely moved on. Only the validator may judge that chain.
  const movedOn = [
    { id: "a", action: "click", routeBefore: HOME, routeAfter: CATALOG, causedTransition: true },
    { id: "b", action: "click", routeBefore: PRODUCT },
  ] as unknown as CanonicalInteraction[];

  const reconciled = reconcileTransientRouteTransitions(movedOn);
  assert.equal(reconciled[0]!.routeAfter, CATALOG, "not a bounce: the route never returned");
  assert.equal(validateInteractionStateSequence(reconciled).stateSequenceValid, false, "the validator still owns this verdict");
});

test("7/adjacency. system observations do not count as the next action for bounce detection", () => {
  // The validator skips `system_observation`; the reconciler must agree on who the neighbour is,
  // or it would compare against a different pair than the one that gets flagged.
  const withObservation = [
    { id: "a", action: "click", routeBefore: PRODUCT, routeAfter: HOME, causedTransition: true },
    { id: "obs", action: "system_observation", routeBefore: HOME },
    { id: "b", action: "click", routeBefore: PRODUCT },
  ] as unknown as CanonicalInteraction[];

  const reconciled = reconcileTransientRouteTransitions(withObservation);
  assert.equal(reconciled[0]!.routeAfter, undefined, "the real next action still contradicts the destination");
  assert.deepEqual(validateInteractionStateSequence(reconciled), { stateSequenceValid: true, stateSequenceIssues: [] });
});

test("8/corroborated. a destination the next action records too is never treated as a blip", () => {
  // The legacy double-claim shape pinned by
  // `canonical-recording-contract.pointer-fill-tap-interactionid-authority.test.ts` 8/legacy:
  // two actions on one screen, the later one causing the navigation, BOTH claiming it. The
  // first action's `routeBefore` matches the second's, so the bounce rule would otherwise fire
  // -- but a destination two independent observations agree on is not a one-off blip, and
  // reassigning ownership is not this function's job.
  const doubleClaim = [
    { id: "fill", action: "fill", routeBefore: HOME, routeAfter: CATALOG, causedTransition: true },
    { id: "tap", action: "click", routeBefore: HOME, routeAfter: CATALOG, causedTransition: true },
  ] as unknown as CanonicalInteraction[];

  const reconciled = reconcileTransientRouteTransitions(doubleClaim);
  assert.equal(reconciled, doubleClaim, "nothing to repair: the destination is corroborated");
  assert.equal(reconciled[0]!.causedTransition, true);
});

console.log("All transient-route-bounce tests passed.");
