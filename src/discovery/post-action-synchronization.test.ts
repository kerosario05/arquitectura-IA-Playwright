import assert from "node:assert/strict";
import test from "node:test";
import { resolvePostActionSynchronization } from "./post-action-synchronization";

test("immediate action response is accepted when the watcher was armed before click", () => {
  assert.deepEqual(resolvePostActionSynchronization({ actionNetworkObserved: true, actionNetworkResponse: true }), {
    completed: true,
    signal: "network_response",
  });
});

test("DOM transition plus a next target that BECAME visible is accepted without requiring HTTP response", () => {
  assert.deepEqual(resolvePostActionSynchronization({ domMutation: true, nextTargetAvailable: true, nextTargetBecameVisible: true }), {
    completed: true,
    signal: "next_target_visible",
  });
});

/**
 * FIRST_LOSS (jobIds 2890e715-cf1a-455f-b853-3ef673524b90, e90e20b7-6c3b-4a0a-b9be-8e416f247a54,
 * actionIndex=6): `nextTargetAvailable` was a level check on the post-click snapshot only -- a
 * next target already visible BEFORE the click (same static form, unrelated to this action)
 * could satisfy `next_target_visible` completion together with an incidental DOM mutation (e.g.
 * a focus change any click produces), without the action itself causing anything. Fixed by
 * requiring an explicit `nextTargetBecameVisible` (false->true) transition for this signal only;
 * `nextTargetAvailable` keeps its prior meaning/behavior for the other (auth_gate_changed)
 * branches that read it.
 */
test("1/preExistingVisibleRejected. a next target already visible before the click, still visible after, with only an incidental DOM mutation, never completes via next_target_visible", () => {
  assert.deepEqual(resolvePostActionSynchronization({ domMutation: true, nextTargetAvailable: true, nextTargetBecameVisible: false }), { completed: false });
});

test("2/falseToTrueAccepted. a next target that only became visible after the click (real transition) completes via next_target_visible", () => {
  assert.deepEqual(resolvePostActionSynchronization({ domMutation: true, nextTargetAvailable: true, nextTargetBecameVisible: true }), {
    completed: true,
    signal: "next_target_visible",
  });
});

test("3/strongSignalPreserved. a real network response still completes via its own strong signal regardless of next-target transition", () => {
  assert.deepEqual(resolvePostActionSynchronization({ actionNetworkObserved: true, actionNetworkResponse: true, nextTargetAvailable: true, nextTargetBecameVisible: false }), {
    completed: true,
    signal: "network_response",
  });
});

test("4/focusOnlyRejected. an auth-unrelated, next-target-unrelated incidental mutation with a pre-existing next target never completes", () => {
  assert.deepEqual(resolvePostActionSynchronization({ domMutation: true, nextTargetAvailable: true, nextTargetBecameVisible: false, loadingSettled: false }), { completed: false });
});

test("5/neitherVisible. next target visible neither before nor after -- unaffected, no completion from this branch", () => {
  assert.deepEqual(resolvePostActionSynchronization({ domMutation: true, nextTargetAvailable: false, nextTargetBecameVisible: false }), { completed: false });
});

test("6/authGateBranchUnaffected. nextTargetAvailable alone (no transition needed) still corroborates an auth gate change, unchanged", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({ authGateChanged: true, nextTargetAvailable: true, nextTargetBecameVisible: false }),
    { completed: true, signal: "auth_gate_changed" },
  );
});

test("pending action with no transition reaches bounded timeout state", () => {
  assert.deepEqual(resolvePostActionSynchronization({ actionNetworkObserved: true }), { completed: false });
});

test("application error is terminal and does not request a retry", () => {
  assert.deepEqual(resolvePostActionSynchronization({ applicationError: true, actionNetworkObserved: true }), {
    completed: true,
    signal: "application_error",
  });
});

test("redirect chain is completed by the terminal action response", () => {
  assert.deepEqual(resolvePostActionSynchronization({ actionNetworkObserved: true, actionNetworkResponse: true }), {
    completed: true,
    signal: "network_response",
  });
});

test("unrelated network activity cannot satisfy action synchronization", () => {
  assert.deepEqual(resolvePostActionSynchronization({ actionNetworkObserved: false, actionNetworkResponse: false }), {
    completed: false,
  });
});

test("an auth gate change alone cannot declare a transition stable", () => {
  assert.deepEqual(resolvePostActionSynchronization({ authGateChanged: true }), { completed: false });
  assert.deepEqual(resolvePostActionSynchronization({ authGateChanged: true, nextTargetAvailable: false, loadingSettled: false, screenFingerprintChanged: false }), { completed: false });
});

test("a navigation mutation with transport still active is not readiness", () => {
  assert.deepEqual(resolvePostActionSynchronization({ navigationMutation: true, loadingSettled: false }), { completed: false });
});

test("a navigation mutation is progress, not readiness, even once loading settles", () => {
  assert.deepEqual(resolvePostActionSynchronization({ navigationMutation: true, loadingSettled: true }), { completed: false });
});

test("an inline DOM mutation with settled transport is a validation signal", () => {
  assert.deepEqual(resolvePostActionSynchronization({ domMutation: true, loadingSettled: true }), {
    completed: true,
    signal: "dom_validation_mutation",
  });
});

test("a DOM mutation across a route change is progress, not readiness", () => {
  assert.deepEqual(resolvePostActionSynchronization({ domMutation: true, loadingSettled: true, routeChanged: true }), { completed: false });
});

test("a recorded post-action surface is not satisfied by a generic DOM mutation", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      domMutation: true,
      loadingSettled: true,
      nextTargetAvailable: true,
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: false,
    }),
    { completed: false },
  );
});

test("a recorded post-action surface is not satisfied by a 2xx on an intermediate surface", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: false,
    }),
    { completed: false },
  );
});

test("reaching the recorded post-action surface allows completion", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: true,
      domMutation: true,
      loadingSettled: true,
    }),
    { completed: true, signal: "dom_validation_mutation" },
  );
});

test("1/requiredTrueReachedFalseAuthChanged. auth_gate_changed can no longer substitute for an unmet recorded postcondition (fail-closed)", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      authGateChanged: true,
      loadingSettled: true,
      nextTargetAvailable: true,
      screenFingerprintChanged: true,
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: false,
    }),
    { completed: false },
  );
});

test("2/requiredTrueReachedFalseNoAuthChange. still not completed without an auth-gate flip either -- same outcome, not a special case", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      authGateChanged: false,
      loadingSettled: true,
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: false,
    }),
    { completed: false },
  );
});

test("3/requiredTrueReachedTrueAuthChanged. once the recorded surface is reached, completion is allowed and falls through to the normal auth_gate_changed signal", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      authGateChanged: true,
      nextTargetAvailable: true,
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: true,
    }),
    { completed: true, signal: "auth_gate_changed" },
  );
});

test("4/requiredFalseAuthChanged. legacy behavior preserved when no recorded surface is required at all", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      authGateChanged: true,
      loadingSettled: true,
      recordedPostActionSurfaceRequired: false,
    }),
    { completed: true, signal: "auth_gate_changed" },
  );
});

/**
 * FIRST_LOSS (job 33eac151-4ad6-4f7d-b652-0452ac4d525e, actionIndex=8, target="Continuar"):
 * `dom_validation_mutation` fired and marked the step PASSED even though the recording's own next
 * structured target ("Categoría de producto") was known and still not visible -- the real
 * functional surface never arrived; the flow later failed at actionIndex=9 on a stale surface.
 */

test("1/nextAbsentDomMutation. a known-but-not-yet-visible next target blocks the generic dom_validation_mutation completion", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      domMutation: true,
      loadingSettled: true,
      nextTargetKnown: true,
      nextTargetAvailable: false,
    }),
    { completed: false },
  );
});

test("2/nextVisible. once the known next target is visible, dom_validation_mutation completes via the existing mechanism", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      domMutation: true,
      loadingSettled: true,
      nextTargetKnown: true,
      nextTargetAvailable: true,
    }),
    { completed: true, signal: "dom_validation_mutation" },
  );
});

test("3/noNextAuthority. no next-target authority known at all preserves legacy dom_validation_mutation completion, unchanged", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      domMutation: true,
      loadingSettled: true,
      nextTargetAvailable: false,
    }),
    { completed: true, signal: "dom_validation_mutation" },
  );
});

test("4/recordedSurfaceReachedStillCompletesWithoutNextTarget. an authoritative recorded-surface completion is unaffected by nextTargetKnown/nextTargetAvailable", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: true,
      domMutation: true,
      loadingSettled: true,
      nextTargetKnown: true,
      nextTargetAvailable: false,
    }),
    { completed: true, signal: "dom_validation_mutation" },
  );
});

/**
 * FIRST_LOSS (job 119f8c19-2a42-4232-a4e2-7bb37a712fbb, actionIndex=8, target="Continuar"):
 * `network_response` closed the step even though the next structured action ("Categoría de
 * producto", a combobox owner with real `associatedField` authority) had only its LABEL visible,
 * not an actually-resolvable owner. The flow advanced onto a surface where the owner never
 * materialized and failed two actions later with target_not_found. A label being visible is not
 * the same as the shared resolver confirming the owner is resolvable.
 */

test("1/labelVisibleOwnerAbsent. network_response cannot close the action while the next structured owner is required but not yet resolvable", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("2/ownerEventuallyReady. once the shared resolver confirms the owner is resolvable, network_response completes normally", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: true,
    }),
    { completed: true, signal: "network_response" },
  );
});

test("3/networkResponseBlocked. dom_validation_mutation is blocked the same way as network_response while the owner is required but absent", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      domMutation: true,
      loadingSettled: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("4/legacyBehaviorNoRuntimeResolutionRequired. a plain next target with no structured runtime-resolution authority preserves existing behavior unchanged", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      nextTargetRequiresRuntimeResolution: false,
      nextTargetReady: false,
    }),
    { completed: true, signal: "network_response" },
  );
});

test("6/recordedSurfaceOutranksOwnerReadiness. an already-confirmed recorded post-action surface is never blocked by owner-readiness either", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: true,
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: true, signal: "network_response" },
  );
});

test("7/resolverAmbiguousStaysNotReady. an ambiguous/unresolved owner (nextTargetReady left false) fails closed exactly like an absent owner", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      domMutation: true,
      loadingSettled: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

/**
 * PHYSICAL BRANCH (job 119f8c19-2a42-4232-a4e2-7bb37a712fbb, actionIndex=8, target="Continuar"):
 * the exact real input shape observed -- a genuine network_response with no accompanying
 * domMutation/routeChanged/recordedPostActionSurfaceReached -- closing the network_response
 * branch specifically, not the dom_validation_mutation branch already covered above.
 */

test("8/ownerAbsentNetworkResponsePhysical. the exact physical network_response-only shape from job 119f8c19 stays pending while the owner is not yet resolvable", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      domMutation: false,
      routeChanged: false,
      recordedPostActionSurfaceRequired: false,
      recordedPostActionSurfaceReached: false,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("9/ownerReadyNetworkResponsePhysical. the same physical shape completes via network_response once the owner is resolvable", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      domMutation: false,
      routeChanged: false,
      recordedPostActionSurfaceRequired: false,
      recordedPostActionSurfaceReached: false,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: true,
    }),
    { completed: true, signal: "network_response" },
  );
});

/**
 * FIRST_LOSS (job a2b3373c-d7a9-40d1-9c8c-a6f1ba49bc3c, actionIndex=8, target="Continuar"):
 * `auth_gate_changed` closed the step (`signal=auth_gate_changed`) while the next structured
 * action ("Categoría de producto") was known, required runtime resolution, and was still not
 * ready (two requests, `Bizagi/FlagMotor` and `MDW/CategoriasProducto`, still pending after
 * ~22.3s). actionIndex=9 then failed with target_not_found across 44 evaluated candidates.
 * `auth_gate_changed` had the same completion-authority gap network_response and
 * dom_validation_mutation already had fixed -- it reuses the exact same `nextOwnerBlocking` guard,
 * never a parallel/new one.
 */

test("10/ownerAbsentAuthChanged. auth_gate_changed cannot complete the action while the next structured owner is required but not yet resolvable", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      authGateChanged: true,
      loadingSettled: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("11/ownerReadyAuthChanged. once the shared resolver confirms the owner is resolvable, auth_gate_changed completes normally", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      authGateChanged: true,
      loadingSettled: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: true,
    }),
    { completed: true, signal: "auth_gate_changed" },
  );
});

test("12/authGateNoNextAuthorityLegacyPreserved. no next-target authority known at all preserves legacy auth_gate_changed completion, unchanged", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      authGateChanged: true,
      loadingSettled: true,
      nextTargetKnown: false,
      nextTargetRequiresRuntimeResolution: false,
      nextTargetReady: false,
    }),
    { completed: true, signal: "auth_gate_changed" },
  );
});

test("13/authGateRecordedSurfaceGuardStillBlocks. an unmet recorded post-action surface still blocks auth_gate_changed, exactly as before this ticket", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      authGateChanged: true,
      loadingSettled: true,
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: false,
    }),
    { completed: false },
  );
});

test("14/networkPlusAuthOwnerAbsent. both network_response and auth_gate_changed are present but the owner is absent -- neither completes the action", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      authGateChanged: true,
      loadingSettled: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("15/domPlusAuthOwnerAbsent. both dom_validation_mutation and auth_gate_changed are present but the owner is absent -- neither completes the action", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      domMutation: true,
      loadingSettled: true,
      authGateChanged: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

/**
 * FIRST_LOSS (job 7a01ab45-ba60-49af-bff0-63d23938862f, actionIndex=8, target="Continuar"):
 * `next_target_visible` closed the step (`signal=next_target_visible`) purely because
 * "Categoría de producto"'s label text became visible, even though the SAME structured resolver
 * already reported `field-scoped-fallback status=field_container_not_resolved` for that exact
 * field during this action's own completionProbe. actionIndex=9 then failed with
 * target_not_found in ~12ms. Reuses the SAME `nextOwnerBlocking` guard as network_response,
 * dom_validation_mutation, and auth_gate_changed -- no new resolver, no second opinion.
 */

test("16/visibleButOwnerAbsent. next_target_visible cannot complete the action while the next structured owner is required but not yet resolvable", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetBecameVisible: true,
      domMutation: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("17/visibleAndOwnerReady. once the shared resolver confirms the owner is resolvable, next_target_visible completes normally", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetBecameVisible: true,
      domMutation: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: true,
    }),
    { completed: true, signal: "next_target_visible" },
  );
});

test("17b/resolverReadyAlreadyVisible. jobId 95102491: a next owner already visible before the click (never a false->true transition, so next_target_visible cannot fire) still completes via next_target_resolver_ready once the shared resolver positively confirms it, on a real run where 18 consecutive probes all reported resolverStatus=resolved", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetBecameVisible: false,
      domMutation: false,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: true,
    }),
    { completed: true, signal: "next_target_resolver_ready" },
  );
});

test("17c/resolverNotReadyStaysPending. nextTargetReady=false never completes via next_target_resolver_ready, exactly as every other generic signal stays blocked", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetBecameVisible: false,
      domMutation: false,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("17d/resolverReadyNoRuntimeAuthorityNeverFires. next_target_resolver_ready requires nextTargetRequiresRuntimeResolution -- a plain target with no structured runtime authority never gets this signal even if nextTargetReady happens to be true", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetBecameVisible: false,
      domMutation: false,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: false,
      nextTargetReady: true,
    }),
    { completed: false },
  );
});

test("18/nextTargetVisibleLegacyNoNextAuthority. no next-target authority known at all preserves legacy next_target_visible completion, unchanged", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetBecameVisible: true,
      domMutation: true,
      nextTargetKnown: false,
      nextTargetRequiresRuntimeResolution: false,
      nextTargetReady: false,
    }),
    { completed: true, signal: "next_target_visible" },
  );
});

test("19/nextTargetVisibleNonRuntimeTargetLegacyPreserved. a plain (non-structured) next target preserves legacy next_target_visible completion, unchanged", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetBecameVisible: true,
      domMutation: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: false,
      nextTargetReady: false,
    }),
    { completed: true, signal: "next_target_visible" },
  );
});

test("20/allGenericSignalsBlockedTogether. next_target_visible, auth_gate_changed, network_response, and dom_validation_mutation are ALL present but the owner is absent -- none of them completes the action", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetBecameVisible: true,
      authGateChanged: true,
      actionNetworkObserved: true,
      actionNetworkResponse: true,
      domMutation: true,
      loadingSettled: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: false },
  );
});

test("21/nextTargetVisibleRecordedSurfaceOutranksOwnerReadiness. an already-confirmed recorded post-action surface is never blocked by owner-readiness for next_target_visible either", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: true,
      nextTargetBecameVisible: true,
      domMutation: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: true, signal: "next_target_visible" },
  );
});

/**
 * FIRST_LOSS (job a85d2d3b-e509-476b-9bf6-d3828a03cf5a, app kiosko, actionIndex=10,
 * target="Mobile"): a same-surface, structured selection-like action produced no network
 * request, no route change, and no DOM signal the shared observers track -- every existing
 * completion branch requires one of those. `targetSelectionStateChanged` is a direct, causal
 * signal about the CURRENT action's own already-resolved target, so it is unaffected by
 * `nextOwnerBlocking` (a next-action concern) and unaffected by next-target visibility/readiness.
 */

test("22/nonNetworkSelectionCompletes. a same-surface selection-state transition alone, with nothing else observed, completes the action", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      targetSelectionStateChanged: true,
    }),
    { completed: true, signal: "target_selection_state_changed" },
  );
});

test("23/noTransitionStaysPending. no selection-state transition and no other signal stays pending, exactly as before this ticket", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      targetSelectionStateChanged: false,
    }),
    { completed: false },
  );
});

test("24/selectionCompletionUnaffectedByNextOwnerBlocking. a blocked next-owner readiness never prevents the CURRENT target's own selection-state completion -- unrelated concerns", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      targetSelectionStateChanged: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: false,
    }),
    { completed: true, signal: "target_selection_state_changed" },
  );
});

test("25/selectionCompletionRespectsRecordedSurfaceGuard. an unmet recorded post-action surface still blocks completion even with a selection-state transition observed", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      targetSelectionStateChanged: true,
      recordedPostActionSurfaceRequired: true,
      recordedPostActionSurfaceReached: false,
    }),
    { completed: false },
  );
});

/**
 * FIRST_LOSS (jobId 6b17012d-d32c-4882-8d37-0f43d0d1b266, step=5 target="Solicitar", next
 * "Generar Turno"): a modal-mounting click produced a real `absent/hidden -> visible` transition
 * for the next target, but the `next_target_visible` branch ALSO required a co-occurring generic
 * mutation (`navigationMutation || domMutation || screenFingerprintChanged`). Those observers are
 * blind to a pure visibility transition (the modal mounts its controls hidden before the click, so
 * their `controls` diff is byte-identical), so the correctly-causal signal was discarded and the
 * action stalled (`signal=none`, `stalled`, `loading_timeout`) despite the next target being
 * certified. Causality is the transition itself. These tests pin the transition-only contract while
 * proving the pre-existing visible-before / focus-only rejections are untouched.
 */

test("26/newlyVisibleNextTargetCompletes. a next target absent/ineligible before and visible+eligible after completes with NO navigation, network, or generic DOM/route signal", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetAvailable: true,
      nextTargetBecameVisible: true,
    }),
    { completed: true, signal: "next_target_visible" },
  );
});

test("27/alreadyVisibleNextTargetRejected. a next target visible both before and after the click never completes via next_target_visible", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetAvailable: true,
      nextTargetBecameVisible: false,
      domMutation: false,
      loadingSettled: false,
      routeChanged: false,
    }),
    { completed: false },
  );
});

test("28/hiddenToVisibleCompletes. a target hidden/inert before the click and visible after is a causal visibility transition", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetAvailable: true,
      nextTargetBecameVisible: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: false,
    }),
    { completed: true, signal: "next_target_visible" },
  );
});

test("29/fieldScopedCertifiedTargetPropagates. a field-scoped certified next target (owner resolvable) reaches completion from the probe", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetAvailable: true,
      nextTargetBecameVisible: true,
      nextTargetKnown: true,
      nextTargetRequiresRuntimeResolution: true,
      nextTargetReady: true,
    }),
    { completed: true, signal: "next_target_visible" },
  );
});

test("30/noNavigationNetworkNewlyVisibleCompletes. no navigation/network at all, but the next target became visible, still completes", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      actionNetworkObserved: false,
      actionNetworkResponse: false,
      navigationMutation: false,
      domMutation: false,
      screenFingerprintChanged: false,
      nextTargetAvailable: true,
      nextTargetBecameVisible: true,
    }),
    { completed: true, signal: "next_target_visible" },
  );
});

test("31/noStateChangeStalls. no transition and no other signal stays pending (fail closed)", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      nextTargetAvailable: false,
      nextTargetBecameVisible: false,
      navigationMutation: false,
      domMutation: false,
      screenFingerprintChanged: false,
    }),
    { completed: false },
  );
});

test("32/focusOnlyMutationRejected. a focus-only (incidental) DOM mutation with the next target already visible never completes", () => {
  assert.deepEqual(
    resolvePostActionSynchronization({
      domMutation: true,
      loadingSettled: true,
      routeChanged: false,
      nextTargetKnown: true,
      nextTargetAvailable: false,
      nextTargetBecameVisible: false,
    }),
    { completed: false },
  );
});

