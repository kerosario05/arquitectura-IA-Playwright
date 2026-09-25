export type PostActionSynchronizationInput = {
  actionNetworkObserved?: boolean;
  actionNetworkResponse?: boolean;
  applicationError?: boolean;
  authGateChanged?: boolean;
  domMutation?: boolean;
  loadingSettled?: boolean;
  navigationMutation?: boolean;
  nextTargetAvailable?: boolean;
  /**
   * `nextTargetAvailable` is a level check (was it visible in the post-click snapshot) with no
   * pre-click baseline -- a target already visible before the click proves nothing about this
   * action. Required specifically for the `next_target_visible` completion signal; the other
   * branches that also read `nextTargetAvailable` (auth_gate_changed) are unaffected.
   */
  nextTargetBecameVisible?: boolean;
  /**
   * A structured Recording next-action target exists for this step (regardless of whether it is
   * visible yet). Scopes the generic dom_validation_mutation signal: with a known next target,
   * an in-place DOM mutation alone is not sufficient completion evidence until that next target is
   * actually visible (or another authoritative signal fires) -- it never applies when no next
   * target is known, so non-Recording-Replay flows and terminal actions are unaffected.
   */
  nextTargetKnown?: boolean;
  /**
   * The recording's next canonical action target requires runtime resolution (it carries
   * `associatedField`/structured authority -- a selection owner, combobox, or similar actionable
   * field), as opposed to a plain label the app happens to render. When true, a generic
   * network_response or dom_validation_mutation signal is not sufficient completion evidence on
   * its own: `nextTargetReady` (below) must confirm the owner is actually resolvable, not merely
   * that its label text is visible. Scoped strictly to Recording Replay actions whose next step
   * has this authority; never applies otherwise.
   */
  nextTargetRequiresRuntimeResolution?: boolean;
  /**
   * The shared target resolver (the SAME one used to resolve every structured Recording action)
   * was asked, read-only, whether the next action's owner is currently resolvable
   * (visible+enabled+actionable+unambiguous) -- not just that its label text is present in the
   * DOM. Only meaningful when `nextTargetRequiresRuntimeResolution` is true.
   */
  nextTargetReady?: boolean;
  screenFingerprintChanged?: boolean;
  /** The page's route changed across the action — DOM-only signals are then progress, not readiness. */
  routeChanged?: boolean;
  /**
   * The action carries a recorded post-action surface (expectedRouteAfter). When set,
   * the recorded authority is a functional postcondition: DOM/network progress signals
   * are auxiliary and must not declare completion before the recorded surface is reached.
   */
  recordedPostActionSurfaceRequired?: boolean;
  /** The observed surface has reached the recorded post-action authority. */
  recordedPostActionSurfaceReached?: boolean;
  /**
   * A causal, structured selection-state transition (e.g. false->true) was observed on the
   * CURRENT action's own already-resolved technical target -- the SAME locator, re-read, never a
   * new resolver. Only meaningful for actions with recorded/structured select|check|uncheck|
   * radio|toggle authority (`recordingInteractionKind`), never inferred from target text. A
   * same-surface selection action with no network/DOM/next-target signal at all (e.g. toggling an
   * aria-pressed/aria-checked control) otherwise has no way to ever complete.
   */
  targetSelectionStateChanged?: boolean;
  /**
   * A causal, same-surface structured-state mutation: exactly one redacted state candidate that
   * existed before the action changed a functional property (text/ARIA value/state) after it. This
   * is the completion authority for a control whose click mutates a related display/control without
   * navigation/network/a newly-visible next target. Already fail-closed upstream (ambiguity, focus,
   * and newly-appeared-only candidates never set it).
   */
  structuredStateMutation?: boolean;
};

export type PostActionSynchronizationResult = {
  completed: boolean;
  signal?: "application_error" | "network_response" | "auth_gate_changed" | "next_target_visible" | "next_target_resolver_ready" | "dom_navigation_mutation" | "dom_validation_mutation" | "target_selection_state_changed" | "structured_state_mutation";
};

/**
 * Selects a bounded post-action completion signal from observations owned by
 * the action. Unrelated network activity is deliberately ignored unless the
 * action observer also saw a terminal response.
 */
export function resolvePostActionSynchronization(
  input: PostActionSynchronizationInput,
): PostActionSynchronizationResult {
  if (input.applicationError) return { completed: true, signal: "application_error" };
  // A recorded post-action surface is execution authority. Until the observed surface
  // reaches it, a DOM mutation, a 2xx response, an auth-gate flip, or a visible next target
  // are all progress signals — never the recorded functional outcome. No generic signal may
  // substitute for the recorded postcondition itself while it remains unmet: an authoritative
  // completionProbe can only be satisfied by demonstrating its own target condition. Once the
  // recorded surface IS reached, completion falls through to the normal signal checks below
  // (including auth_gate_changed), same as when no recorded surface is required at all.
  if (input.recordedPostActionSurfaceRequired && !input.recordedPostActionSurfaceReached) {
    return { completed: false };
  }
  const recordedSurfaceConfirmed = Boolean(input.recordedPostActionSurfaceRequired && input.recordedPostActionSurfaceReached);
  // FIRST_LOSS fix: a generic network_response/dom_validation_mutation was accepted as completion
  // even though the recording's next structured action (a selection owner/combobox with real
  // `associatedField` authority) had not actually materialized as an actionable owner -- only its
  // label text happened to render. A generic signal is progress, never readiness, until the SAME
  // shared resolver used for every other structured action confirms the owner is resolvable. An
  // already-confirmed recorded post-action surface is stronger authority and is never blocked by
  // this check.
  const nextOwnerBlocking = Boolean(input.nextTargetRequiresRuntimeResolution) && !input.nextTargetReady && !recordedSurfaceConfirmed;

  // FIRST_LOSS fix: a same-surface, structured selection/toggle action (e.g. a radio/checkbox-like
  // control with no network request, no route change, and no DOM signal the shared observers
  // track) had no way to ever complete -- network_response/dom_validation_mutation/
  // next_target_visible/auth_gate_changed all require signals this kind of action simply never
  // produces. This is about the CURRENT action's own target, never the next action's readiness,
  // so it is not subject to `nextOwnerBlocking` (an unrelated concern).
  if (input.targetSelectionStateChanged) {
    return { completed: true, signal: "target_selection_state_changed" };
  }

  if (!nextOwnerBlocking && input.actionNetworkObserved && input.actionNetworkResponse) {
    return { completed: true, signal: "network_response" };
  }
  // FIRST_LOSS fix: auth_gate_changed had the same completion authority gap as
  // network_response/dom_validation_mutation above -- it could close the action while the next
  // structured owner was known, required, and still not resolvable. Reuses the SAME
  // `nextOwnerBlocking` guard, never a new/parallel one. auth_gate_changed remains fully available
  // as before whenever no next structured runtime target exists, once it becomes ready, or once a
  // stronger recorded-surface authority is already satisfied (`recordedSurfaceConfirmed` is
  // already folded into `nextOwnerBlocking` above).
  if (!nextOwnerBlocking && input.authGateChanged && (input.nextTargetAvailable || input.loadingSettled || input.screenFingerprintChanged)) {
    return { completed: true, signal: "auth_gate_changed" };
  }
  // FIRST_LOSS fix: text/label visibility alone was accepted as completion authority even when
  // the SAME structured resolver already reported the next owner as not resolvable
  // (field_container_not_resolved) -- a label rendering is not proof its owner is ready. Reuses
  // the SAME `nextOwnerBlocking` guard as the other generic signals above; never a new resolver,
  // never a second opinion on top of the one that already ran.
  // FIRST_LOSS fix (jobId 6b17012d): a next target that genuinely passed `absent/hidden -> visible`
  // (`nextTargetBecameVisible`, computed from the hidden-filtered page snapshot, so a target merely
  // present-but-hidden before the click can never satisfy it) was STILL discarded because this
  // branch additionally required a co-occurring generic mutation (`navigationMutation || domMutation
  // || screenFingerprintChanged`). Those observers cannot see a pure visibility transition (a modal
  // mounting its controls hidden before the click leaves `controls` byte-identical in their diff),
  // so a real modal-open transition reported `domMutation=false` and a correct causal signal was
  // thrown away. Causality is the transition itself, never the incidental mutation: the branch now
  // completes on the causal false->true transition alone, still gated by `nextOwnerBlocking`. This
  // is NOT an after-visible-only relaxation -- a target already visible before the click keeps
  // `nextTargetBecameVisible=false` and still never completes here.
  if (!nextOwnerBlocking && input.nextTargetBecameVisible) {
    return { completed: true, signal: "next_target_visible" };
  }
  // FIRST_LOSS fix (jobId 95102491): `nextTargetReady` -- the SAME shared resolver used for every
  // other structured action, positively confirming the next owner is visible+enabled+actionable+
  // unambiguous right now -- was used ONLY to BLOCK weaker generic signals (`nextOwnerBlocking`
  // above); it never itself counted as completion evidence. A same-surface transition whose next
  // owner was already present in the DOM before the click (e.g. a kiosk numeric-keypad modal that
  // mounts pre-rendered, or reveals via a CSS transition the hidden-filtered visibility snapshot
  // does not register as a hidden->visible edge) could satisfy `nextTargetReady=true` on every
  // single poll -- confirmed against a real run where 18 consecutive probes all reported
  // nextTargetVisible=true/nextTargetReady=true/resolverStatus=resolved -- yet still fell through
  // every branch above to `completed=false`, because none of them accept a resolver-confirmed
  // owner on its own. This never weakens `nextTargetBecameVisible`'s strict causal-transition
  // check above (still evaluated first, unchanged) -- it only adds the missing affirmative branch
  // for the resolver's own positive confirmation, still fully gated by `nextOwnerBlocking` and
  // still requiring `nextTargetRequiresRuntimeResolution` (never fires for a target with no
  // structured runtime authority at all).
  if (!nextOwnerBlocking && input.nextTargetRequiresRuntimeResolution && input.nextTargetReady) {
    return { completed: true, signal: "next_target_resolver_ready" };
  }
  // FIRST_LOSS fix (jobId 085dc21f): a same-surface click that mutates a related display/control's
  // functional state (keypad, stepper, +/- counter, custom toggle, selection-updates-display) with
  // no navigation, no network, and no newly-visible next target had no completion signal at all --
  // the mutation lives on a DIFFERENT node than the clicked owner and no generic branch saw it.
  // `structuredStateMutation` is the causal before!=after on a single pre-existing state candidate
  // (redacted, structured), already fail-closed upstream for ambiguity/focus/newly-appeared-only.
  // Same-surface only (no route change) and settled loading only; `nextOwnerBlocking` is reused so a
  // known-not-ready next owner still blocks it, exactly like the other generic signals.
  if (!nextOwnerBlocking && input.structuredStateMutation && !input.routeChanged && input.loadingSettled) {
    return { completed: true, signal: "structured_state_mutation" };
  }
  // A navigation-shaped DOM mutation is a progress signal, never readiness. It can
  // fire before the new route's fetch is even registered, so it must not declare an
  // SPA transition stable: the next target resolver would re-observe a stale surface.
  if (!nextOwnerBlocking && input.domMutation && input.loadingSettled && !input.routeChanged) {
    // A generic in-place mutation (e.g. a validation/focus change) was accepted as completion
    // even when the recording's own next structured action target was known and still not
    // visible -- the real functional surface never arrived. Only gates when a next target is
    // actually known; unaffected when none is (e.g. the last action in a flow, or a
    // non-Recording-Replay run with no next-target authority at all).
    if (input.nextTargetKnown && !input.nextTargetAvailable && !recordedSurfaceConfirmed) return { completed: false };
    return { completed: true, signal: "dom_validation_mutation" };
  }
  return { completed: false };
}
