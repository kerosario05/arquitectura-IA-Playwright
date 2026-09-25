import assert from "node:assert/strict";
import test from "node:test";
import { diffAssertionObservation, diffStateCandidates, type AssertionObservationSnapshot } from "./assertion-observation";
import { resolvePostActionSynchronization } from "./post-action-synchronization";

/**
 * FIRST_LOSS (jobId 085dc21f-9e2e-4afb-844e-1a047aa25c07, step=7 target="4"): a same-surface click
 * on a keypad-like owner mutates a RELATED display's text (no navigation, no network, no newly
 * visible next target) and stalled with `loading_timeout` because no generic branch observed the
 * state mutation. The mutation lives on a DIFFERENT node than the clicked owner (a plain text
 * carrier with no ARIA/role marker), which the controls/validation diff never sees.
 *
 * The fix reuses the redacted `stateCandidates` channel: a causal single-node before!=after on a
 * pre-existing state candidate becomes `stateMutation`, wired to a dedicated
 * `structured_state_mutation` completion signal. Ambiguity, focus-only, and newly-appeared-only
 * changes fail closed.
 */

type Candidate = NonNullable<AssertionObservationSnapshot["stateCandidates"]>[number];

function snapshot(overrides: Partial<AssertionObservationSnapshot> = {}): AssertionObservationSnapshot {
  return {
    urlPath: "/amount",
    controls: [{ identity: "button|role=button|type=button", tagName: "button", disabled: false, required: false, focused: false, valueFingerprint: "0:2166136261", validationNodeIds: [] }],
    validationNodes: [],
    forms: [],
    fingerprint: "synthetic",
    ...overrides,
  };
}

const display = (text: string): Candidate => ({
  tag: "div",
  contentEditable: false,
  identity: "div|id=amount-display",
  propertyFingerprints: { textContent: `${text.length}:${text.length * 31}` },
});

test("1/causalStateMutation. a same-surface display text change is a causal state mutation", () => {
  const before = snapshot({ stateCandidates: [display("4022999")] });
  const after = snapshot({ stateCandidates: [display("40229994")] });
  const diff = diffAssertionObservation(before, after);
  assert.equal(diff.stateMutation, true, "one pre-existing display candidate changed");
  assert.deepEqual(diff.stateMutationProperties, ["textContent"]);
  assert.equal(diff.changed, false, "the controls/validation/forms diff stays untouched");
});

test("2/unchangedStateNoMutation. identical display text is not a mutation", () => {
  const before = snapshot({ stateCandidates: [display("40229994")] });
  const after = snapshot({ stateCandidates: [display("40229994")] });
  assert.equal(diffAssertionObservation(before, after).stateMutation, false);
});

test("3/focusOnlyRejected. a focus/activeElement change alone never becomes a state mutation", () => {
  const before = snapshot({ focusedIdentity: "input|name=a", stateCandidates: [display("x")] });
  const after = snapshot({ focusedIdentity: "input|name=b", stateCandidates: [display("x")] });
  const diff = diffAssertionObservation(before, after);
  assert.equal(diff.stateMutation, false, "focus is not a structured state mutation");
  assert.equal(diff.accessibilityMutation, true, "focus is still surfaced as an accessibility change, never as completion authority");
});

test("4/ambiguousStateFailsClosed. two changed candidates are not a single causal owner", () => {
  const before = snapshot({ stateCandidates: [display("a"), display("b")] });
  const after = snapshot({ stateCandidates: [display("a2"), display("b2")] });
  assert.equal(diffAssertionObservation(before, after).stateMutation, false);
});

test("5/newlyAppearedOnlyNotCausal. a node that only appeared after the click never counts", () => {
  const before = snapshot({ stateCandidates: [display("a")] });
  const after = snapshot({ stateCandidates: [display("a"), { tag: "span", contentEditable: false, identity: "span|id=new", propertyFingerprints: { textContent: "1:1" } }] });
  assert.equal(diffAssertionObservation(before, after).stateMutation, false);
});

test("6/repeatedActions. each action is compared against its own before snapshot", () => {
  const x = snapshot({ stateCandidates: [display("1")] });
  const y = snapshot({ stateCandidates: [display("12")] });
  const z = snapshot({ stateCandidates: [display("123")] });
  assert.equal(diffAssertionObservation(x, y).stateMutation, true);
  assert.equal(diffAssertionObservation(y, z).stateMutation, true);
  assert.equal(diffAssertionObservation(x, z).stateMutation, true);
  assert.equal(diffStateCandidates(x, y)[0].fingerprintAfter, diffStateCandidates(y, z)[0].fingerprintBefore);
});

test("7/structuredStateCompletesProbe. a causal state mutation with no nav/network completes via structured_state_mutation", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      structuredStateMutation: true,
      loadingSettled: true,
      routeChanged: false,
      nextTargetAvailable: true,
      nextTargetBecameVisible: false,
    }),
    { completed: true, signal: "structured_state_mutation" },
  );
});

test("8/preexistingNextTargetRejected. a visible-before next target with no state mutation never completes", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      structuredStateMutation: false,
      loadingSettled: true,
      routeChanged: false,
      nextTargetAvailable: true,
      nextTargetBecameVisible: false,
    }),
    { completed: false },
  );
});

test("9/stateMutationRouteChangedRejected. a route change is not a same-surface state mutation", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      structuredStateMutation: true,
      loadingSettled: true,
      routeChanged: true,
    }),
    { completed: false },
  );
});

test("10/stateMutationOwnerBlocked. a known-not-ready next owner still blocks the state signal", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      structuredStateMutation: true,
      loadingSettled: true,
      routeChanged: false,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("11/existingSignalsStillFirst. network and newly-visible next target keep priority over state mutation", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({ actionNetworkObserved: true, actionNetworkResponse: true, structuredStateMutation: true, loadingSettled: true, routeChanged: false }),
    { completed: true, signal: "network_response" },
  );
  assert.deepEqual(
    resolvePostActionSynchronization({ nextTargetBecameVisible: true, structuredStateMutation: true, loadingSettled: true, routeChanged: false }),
    { completed: true, signal: "next_target_visible" },
  );
});
