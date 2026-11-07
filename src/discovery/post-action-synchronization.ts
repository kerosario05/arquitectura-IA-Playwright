type ApplicationErrorElement = {
  visible?: boolean;
  role?: string;
  text?: string;
  label?: string;
  name?: string;
};

/** An unchanged error on the same surface is not evidence that the latest action failed. */
export function hasNewVisibleApplicationError(input: {
  before: readonly ApplicationErrorElement[];
  after: readonly ApplicationErrorElement[];
  sameSurface: boolean;
}, isCredentialRejection: (text: string) => boolean, nonBlockingTextFragments: readonly string[] = []): boolean {
  const normalize = (text: string): string => text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const normalizedNonBlockingFragments = nonBlockingTextFragments
    .map((fragment) => normalize(String(fragment ?? "")))
    .filter(Boolean);
  const errors = (elements: readonly ApplicationErrorElement[]) => elements.flatMap((element) => {
    if (element.visible === false) return [];
    const role = String(element.role ?? "").toLowerCase();
    const text = String(element.text ?? element.label ?? element.name ?? "");
    const credentialRejection = isCredentialRejection(text);
    const error = (["alert", "status", "dialog", "alertdialog"].includes(role)
      && /error|invalid|incorrect|failed|fall[oó]|inv[aá]lid/i.test(text)) || credentialRejection;
    if (!error) return [];
    const normalizedText = normalize(text);
    const configuredNonBlocking = !credentialRejection
      && normalizedNonBlockingFragments.some((fragment) => normalizedText.includes(fragment));
    return configuredNonBlocking ? [] : [`${role}|${normalizedText}`];
  });
  const baseline = new Set(input.sameSurface ? errors(input.before) : []);
  return errors(input.after).some((error) => !baseline.has(error));
}

/**
 * A recorded cross-field lookup is complete when the click produced an observable
 * response or a functional state change. `diffAssertionObservation` intentionally
 * tracks a narrower set of state transitions than `diffStateCandidates`, so callers
 * may pass the latter when it found a causal value/ARIA change in the existing UI.
 */
export function hasCrossFieldLookupRefreshEffect(input: {
  responseObserved?: boolean;
  nextTargetBecameVisible?: boolean;
  formStateChanged?: boolean;
  validationMutation?: boolean;
  navigationMutation?: boolean;
  structuredStateMutation?: boolean;
  stateCandidateMutations?: readonly { fingerprintBefore?: string }[];
  ownerSubtreeMutation?: boolean;
  targetSelectionStateChanged?: boolean;
  selectionApplied?: boolean;
}): boolean {
  return input.responseObserved === true
    || input.nextTargetBecameVisible === true
    || input.formStateChanged === true
    || input.validationMutation === true
    || input.navigationMutation === true
    || input.structuredStateMutation === true
    || (input.stateCandidateMutations ?? []).some((mutation) => Boolean(mutation.fingerprintBefore))
    || input.ownerSubtreeMutation === true
    || input.targetSelectionStateChanged === true
    || input.selectionApplied === true;
}

export type PostActionSynchronizationInput = {
  actionNetworkObserved?: boolean;
  actionNetworkResponse?: boolean;
  actionNetworkFailed?: boolean;
  /** A same-screen recording hint is actionable only after observers prove the click had no effect. */
  clickCausalEffectDetected?: boolean;
  applicationError?: boolean;
  authGateChanged?: boolean;
  /** The current authentication action has an observed request without a terminal response. */
  authenticationRequestPending?: boolean;
  /** A detected auth gate is still present after its submit action; generic progress is not completion. */
  authenticationBoundaryStillActive?: boolean;
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
  /** The already-observed mutation belongs to the current action's clicked owner. */
  causalClickEffect?: boolean;
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
   * The exact recorded next-action owner independently proves the successor UI is ready even
   * though this application kept the same URL. The caller must establish route-lineage,
   * same-page, before/after visibility, causal-effect, resolver, and stability evidence first.
   */
  recordedPostActionSuccessorConfirmed?: boolean;
  /** The source recording explicitly captured this action on the same non-empty screen before and after. */
  recordedSameSurfaceAction?: boolean;
  /**
   * A final, recording-owned click has settled and produced action-scoped terminal feedback
   * (a completed relevant response or a confirmed causal mutation). This can complete the
   * click when its recorded route is not reached; callers must keep it false for intermediate
   * actions, pending/failed requests, and explicitly-authored authentication flows.
   */
  recordedTerminalActionFeedback?: boolean;
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
   * The shared resolver already applied and verified the requested option before
   * the post-action observer was armed. This is direct outcome evidence from the
   * same structured selection action, so it must not wait for a second DOM/network
   * signal that can no longer observe the transition.
   */
  selectionApplied?: boolean;
  /** A recorded cross-field lookup produced a refresh and its recorded option owner is ready. */
  crossFieldLookupRefreshObserved?: boolean;
  /** A browser download event observed while a terminal recorded click was dispatched. */
  terminalDownloadObserved?: boolean;
  /**
   * A causal, same-surface structured-state mutation: exactly one redacted state candidate that
   * existed before the action changed a functional property (text/ARIA value/state) after it. This
   * is the completion authority for a control whose click mutates a related display/control without
   * navigation/network/a newly-visible next target. Already fail-closed upstream (ambiguity, focus,
   * and newly-appeared-only candidates never set it).
   */
  structuredStateMutation?: boolean;
  /**
   * A causal, owner-scoped childList mutation (a brand-new subtree, e.g. a modal, mounting under
   * the clicked owner) observed by the SAME scoped MutationObserver already installed for
   * `structuredStateMutation`/diagnostics -- never a new observer. Distinct from
   * `structuredStateMutation` (a property change on a pre-existing state candidate) and from
   * `domMutation` (`diffAssertionObservation`'s tracked-candidate diff, which cannot see an
   * entirely new subtree appear). Only meaningful, and only ever checked, for a terminal action
   * with no known next target -- a mid-flow action with a known next target already has stronger,
   * more specific signals (`nextTargetBecameVisible`/`nextTargetReady`) and must keep requiring
   * them, never falling back to a bare owner-subtree mutation.
   */
  ownerSubtreeMutation?: boolean;
};

/**
 * A URL transition is authoritative when the app exposes it, but some SPAs render the recorded
 * successor form without changing the address bar. In that case, allow the exact next recorded
 * owner to stand in for the route only when its route lineage matches and it became actionable
 * after this action. This does not accept text, network completion, or an unverified owner.
 */
export function hasRecordedSuccessorSurfaceProof(input: {
  recordedPostActionSurfaceRequired: boolean;
  recordedPostActionSurfaceReached: boolean;
  successorRouteMatchesNextAction: boolean;
  currentUrlStillOnRecordedPreActionSurface: boolean;
  sameRecordedPage: boolean;
  successorOwnerWasTextVisibleBefore: boolean;
  successorOwnerReadyNow: boolean;
  actionEffectObserved: boolean;
  actionSettled: boolean;
  applicationError: boolean;
  stableSuccessorProbes: number;
  requiredStableProbes: number;
}): boolean {
  return input.recordedPostActionSurfaceRequired
    && !input.recordedPostActionSurfaceReached
    && input.successorRouteMatchesNextAction
    && input.currentUrlStillOnRecordedPreActionSurface
    && input.sameRecordedPage
    && !input.successorOwnerWasTextVisibleBefore
    && input.successorOwnerReadyNow
    && input.actionEffectObserved
    && input.actionSettled
    && !input.applicationError
    && Number.isInteger(input.stableSuccessorProbes)
    && Number.isInteger(input.requiredStableProbes)
    && input.requiredStableProbes > 0
    && input.stableSuccessorProbes >= input.requiredStableProbes;
}

/**
 * A stalled loader can be ignored only after an independent observer proves that the
 * action completed. Keep this separate from the readiness probe so downloads and other
 * terminal actions cannot be mistaken for a loaded destination while pending requests or
 * an unmet recorded postcondition still block progression.
 */
export function canToleratePostActionLoadingTimeout(input: {
  stable: boolean;
  reason?: string;
  recordedPostActionPending: boolean;
  pendingRequests: boolean;
  cleanNetworkTransition: boolean;
  inPlaceCausalEffectConfirmed: boolean;
  routeActuallyChanged: boolean;
  terminalDownloadObserved: boolean;
}): boolean {
  return !input.stable
    && input.reason === "loading_timeout"
    && !input.recordedPostActionPending
    && !input.pendingRequests
    && (input.cleanNetworkTransition
      || input.inPlaceCausalEffectConfirmed
      || input.routeActuallyChanged
      || input.terminalDownloadObserved);
}

export type PostActionSynchronizationResult = {
  completed: boolean;
  signal?: "application_error" | "network_response" | "auth_gate_changed" | "next_target_visible" | "next_target_resolver_ready" | "dom_navigation_mutation" | "dom_validation_mutation" | "target_selection_state_changed" | "structured_state_mutation" | "click_effect_next_target_visible" | "owner_subtree_mutation" | "terminal_feedback" | "download" | "recorded_same_surface" | "recorded_successor_owner" | "cross_field_lookup_refresh";
};

/**
 * A recorded action may create an entity whose route contains a runtime-generated
 * identifier, making later recorded pre-routes stale. Keep accepting the exact
 * destination observed from that successful route transition while execution
 * remains on the same browser page and exact URL. This allows intervening
 * same-page actions (for example, toggling a checkbox) without guessing URL
 * segments or weakening target resolution for the next action.
 */
export function matchesObservedActionSurface(input: {
  previousActionSucceeded: boolean;
  sameBrowserPage: boolean;
  previousUrlBefore?: string;
  previousUrlAfter?: string;
  currentUrl: string;
  expectedRouteBefore?: string;
}): boolean {
  if (!input.previousActionSucceeded
    || !input.sameBrowserPage
    || !input.expectedRouteBefore?.trim()
    || !input.previousUrlBefore?.trim()
    || !input.previousUrlAfter?.trim()) return false;
  try {
    const before = new URL(input.previousUrlBefore);
    const after = new URL(input.previousUrlAfter, before);
    const current = new URL(input.currentUrl, after);
    const identity = (url: URL) => `${url.origin}${url.pathname}${url.search}${url.hash}`;
    return identity(before) !== identity(after) && identity(current) === identity(after);
  } catch {
    return false;
  }
}

/**
 * A successful recorded action can create an entity with a runtime-assigned URL. When the
 * immediately following recorded action expects the same captured destination, an observed
 * same-tab route change plus visibility of that next target is enough to bind this run to its
 * actual destination. This is execution-local evidence: it does not infer URL parameters or
 * add a learned route family, and the next action still resolves its own target before acting.
 */
export function matchesObservedRecordedDestination(input: {
  sameBrowserPage: boolean;
  routeChanged: boolean;
  applicationError: boolean;
  nextTargetVisible: boolean;
  previousUrl: string;
  currentUrl: string;
  expectedRouteAfter?: string;
  nextExpectedRouteBefore?: string;
}): boolean {
  if (!input.sameBrowserPage
    || !input.routeChanged
    || input.applicationError
    || !input.nextTargetVisible
    || !input.expectedRouteAfter?.trim()
    || !input.nextExpectedRouteBefore?.trim()
    || !input.previousUrl.trim()
    || !input.currentUrl.trim()) return false;
  try {
    const previous = new URL(input.previousUrl);
    const current = new URL(input.currentUrl, previous);
    const expectedAfter = new URL(input.expectedRouteAfter, previous);
    const nextExpectedBefore = new URL(input.nextExpectedRouteBefore, current);
    const identity = (url: URL) => `${url.origin}${url.pathname}${url.search}${url.hash}`;
    return previous.origin === current.origin
      && current.origin === expectedAfter.origin
      && expectedAfter.origin === nextExpectedBefore.origin
      && identity(previous) !== identity(current)
      && identity(expectedAfter) === identity(nextExpectedBefore);
  } catch {
    return false;
  }
}

/**
 * Selects a bounded post-action completion signal from observations owned by
 * the action. Unrelated network activity is deliberately ignored unless the
 * action observer also saw a terminal response.
 */
export function resolvePostActionSynchronization(
  input: PostActionSynchronizationInput,
): PostActionSynchronizationResult {
  if (input.applicationError) return { completed: true, signal: "application_error" };
  // A browser-confirmed terminal download is the outcome of the final recorded
  // action itself. It must not be held behind a recorded page-surface condition
  // or a spinner that can remain visible after the file has already arrived.
  if (input.terminalDownloadObserved) return { completed: true, signal: "download" };
  // A new authentication stage can appear before its request finishes. The stage change is
  // progress, not a timeout or a completed exchange; keep the existing observer active.
  if (input.authenticationRequestPending) return { completed: false };
  if (input.recordedPostActionSurfaceRequired && !input.recordedPostActionSurfaceReached && input.recordedTerminalActionFeedback) {
    return { completed: true, signal: "terminal_feedback" };
  }
  if (input.recordedPostActionSurfaceRequired && !input.recordedPostActionSurfaceReached && input.recordedPostActionSuccessorConfirmed) {
    return { completed: true, signal: "recorded_successor_owner" };
  }
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
  // A lookup click can populate a pre-existing dependent field without navigating or
  // changing the auth detector's stage. Once that field's recorded option owner is
  // resolver-ready and the action transport has settled, the observed refresh itself is
  // the completion signal; do not wait out a long stability timeout for another event.
  if (input.crossFieldLookupRefreshObserved && input.nextTargetReady && input.loadingSettled) {
    return { completed: true, signal: "cross_field_lookup_refresh" };
  }
  // A causal selection on the current resolved control is a valid outcome even when the same
  // authentication stage remains open (for example, choosing a delivery channel before entering
  // its code). Pending auth requests and recorded-route postconditions were checked above.
  if (input.targetSelectionStateChanged || input.selectionApplied) {
    return { completed: true, signal: "target_selection_state_changed" };
  }
  // A successful HTTP response can arrive while an SPA is still processing authentication.
  // Keep observing the same auth gate until it changes, the recorded next target appears, or
  // an application error is shown; the network response alone is only progress at this boundary.
  // A recorded next action may progress inside the same auth surface (for example a
  // portalized option whose dynamic name is withheld). Technical readiness from the
  // shared resolver is the same next-step evidence as visible text; it does not certify
  // authentication itself. Unscoped readiness and unresolved targets remain blocked.
  if (input.authenticationBoundaryStillActive
    && !(input.nextTargetRequiresRuntimeResolution && input.nextTargetReady)) return { completed: false };
  const recordedSurfaceConfirmed = Boolean(input.recordedPostActionSurfaceRequired
    && (input.recordedPostActionSurfaceReached || input.recordedPostActionSuccessorConfirmed));
  // FIRST_LOSS fix: a generic network_response/dom_validation_mutation was accepted as completion
  // even though the recording's next structured action (a selection owner/combobox with real
  // `associatedField` authority) had not actually materialized as an actionable owner -- only its
  // label text happened to render. A generic signal is progress, never readiness, until the SAME
  // shared resolver used for every other structured action confirms the owner is resolvable. An
  // already-confirmed recorded post-action surface is stronger authority and is never blocked by
  // this check.
  // Identical screenshots in the source recording do not prove the runtime UI has already
  // finished its same-route transition. If a known successor is still absent, keep observing
  // for it instead of letting an early resolver preflight (which can see a stale/hidden owner)
  // close the current action. This is limited to recorded same-surface clicks with an explicit
  // next action; ordinary structured-owner readiness and terminal actions retain their behavior.
  const recordedSameSurfaceAwaitingSuccessor = Boolean(input.recordedSameSurfaceAction
    && input.nextTargetKnown
    && !input.nextTargetAvailable
    && !recordedSurfaceConfirmed);
  const nextOwnerBlocking = (Boolean(input.nextTargetRequiresRuntimeResolution) && !input.nextTargetReady && !recordedSurfaceConfirmed)
    || recordedSameSurfaceAwaitingSuccessor;

  // A Recording contract can explicitly show that an action left the page on the same
  // captured screen. When that evidence is present, a stable, same-route replay with no
  // pending or failed action request is the recorded outcome; waiting for a newly-visible
  // target would deadlock when that target was already present before the click. Keep the
  // structured next-owner readiness guard and authentication boundary above intact.
  if (input.recordedSameSurfaceAction && input.clickCausalEffectDetected === false
    && !input.actionNetworkObserved && input.loadingSettled && !input.actionNetworkFailed
    && !input.routeChanged && !nextOwnerBlocking) {
    return { completed: true, signal: "recorded_same_surface" };
  }

  // FIRST_LOSS fix: a same-surface, structured selection/toggle action (e.g. a radio/checkbox-like
  // control with no network request, no route change, and no DOM signal the shared observers
  // track) had no way to ever complete -- network_response/dom_validation_mutation/
  // next_target_visible/auth_gate_changed all require signals this kind of action simply never
  // produces. This is about the CURRENT action's own target, never the next action's readiness,
  // so it is not subject to `nextOwnerBlocking` (an unrelated concern).
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
  // Some same-surface controls (tabs, disclosures) change their own DOM state while exposing a
  // next target whose label was already present elsewhere in the page. In that case the
  // visibility edge can be missed, but the current owner's scoped mutation plus the visible next
  // target proves this action advanced the interface. Require settled loading and preserve the
  // next-owner readiness guard; the next action still resolves its own target.
  if (!nextOwnerBlocking && input.causalClickEffect && input.nextTargetAvailable
    && !input.routeChanged && input.loadingSettled) {
    return { completed: true, signal: "click_effect_next_target_visible" };
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
  // FIRST_LOSS fix (task-20260927222226-69ef2ab2): a terminal action (no known next target) whose
  // only observable effect is a brand-new subtree mounting (e.g. a modal) had no completion
  // signal at all -- `domMutation` (tracked-candidate diff) cannot see a wholly new subtree,
  // `structuredStateMutation` requires a pre-existing candidate, and no next target exists to
  // become visible/ready. Gated strictly to `!nextTargetKnown` so a mid-flow action with a known
  // next target keeps requiring its own stronger signal, unaffected.
  if (!nextOwnerBlocking && input.ownerSubtreeMutation && !input.nextTargetKnown && !input.routeChanged && input.loadingSettled) {
    return { completed: true, signal: "owner_subtree_mutation" };
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
