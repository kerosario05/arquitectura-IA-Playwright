import type { CaptureAction, CaptureActionIdentity, CaptureFunctionalAction, CaptureOwnerCandidate, CaptureSourceRefs, CaptureValueState } from "./capture-engine-v2.types";
import { DocumentLifecycle } from "./capture-engine-v2.document-lifecycle";
import { buildOwnerTechnicalEvidence, buildScopedStructuralRuntimeEvidence, resolveCaptureOwner } from "./capture-engine-v2.action-owner-resolver";
import { recorderEvidenceFromSemanticRuntime } from "./structural-owner-identity";
import { EditingSessionManager, type UserEditEvidenceKind } from "./capture-engine-v2.editing-session-manager";
import { SelectionSessionManager } from "./capture-engine-v2.selection-session-manager";

/**
 * CaptureEngine V2 -- Node-side SHADOW receiver for real browser events.
 *
 * Wires the four already-tested pure modules (`DocumentLifecycle`, `resolveCaptureOwner`,
 * `EditingSessionManager`, `SelectionSessionManager`) together to turn normalized browser
 * messages into a TECHNICAL, Playwright-like `CaptureAction` stream (`technicalActions`), for
 * diagnostic/comparison purposes ONLY. It NEVER calls `adaptCaptureActionToRawInteraction`,
 * `onInteraction`, `pushEvent`, or touches `SessionTrace` in any way -- the legacy recorder
 * remains the sole productive authority. `v2Authority` is not a concept this class has any
 * notion of; there is no switch here, on purpose.
 *
 * `functionalActions` is a SEPARATE, derived store: a semantic projection (currently just
 * combobox+option -> one logical selection) over `technicalActions`, never a replacement for it.
 * Every physical click still lands in `technicalActions` first, unconditionally -- a functional
 * projection can be produced, ignored, or diagnosed afterward, but it can never cause a
 * technical action to be dropped, altered, or left out of the replayable stream.
 *
 * Every `handleMessage` call is wrapped so a bug in V2 can never throw into (or otherwise
 * disturb) whatever caller drives the legacy capture path.
 */

export type ShadowOwnerCandidate = CaptureOwnerCandidate;

type ShadowDocumentEnvelope = { captureInstanceId: string; documentId: string; frameId?: string };
type CaptureTraceStage =
  | "instrumentation_revision"
  | "listener_installed"
  | "pointer_observed"
  | "click_handler_entered"
  | "post_action_getter_read"
  | "post_action_scheduled"
  | "post_action_fired"
  | "post_action_send"
  | "owner_candidate_diagnostic"
  | "owner_candidate_nearest_diagnostic";

export type ShadowBrowserMessage =
  | (ShadowDocumentEnvelope & { type: "document_ready"; navigationVersion?: number })
  | (ShadowDocumentEnvelope & { type: "capture_trace"; stage: CaptureTraceStage; trusted?: boolean; diagnostic?: Record<string, unknown> })
  | (ShadowDocumentEnvelope & { type: "structural_identity_diagnostic"; diagnosticKind: "summary" | "candidate"; payload: Record<string, unknown> })
  | (ShadowDocumentEnvelope & { type: "document_retire" })
  | {
      type: "focus";
      captureInstanceId: string;
      documentId: string;
      frameId?: string;
      sessionId: string;
      composedPath: ShadowOwnerCandidate[];
      identity?: CaptureActionIdentity;
      initialValue?: CaptureValueState;
      sensitive?: boolean;
      sourceRefs?: CaptureSourceRefs;
    }
  | { type: "edit_evidence"; sessionId: string; kind: UserEditEvidenceKind; valueState?: CaptureValueState }
  | (ShadowDocumentEnvelope & { type: "blur"; sessionId: string })
  | (ShadowDocumentEnvelope & { type: "submit"; sessionId?: string })
  | {
      type: "keypress";
      captureInstanceId: string;
      documentId: string;
      frameId?: string;
      key: string;
      composedPath: ShadowOwnerCandidate[];
      identity?: CaptureActionIdentity;
      sourceRefs?: CaptureSourceRefs;
    }
  | {
      type: "click";
      captureInstanceId: string;
      documentId: string;
      frameId?: string;
      composedPath: ShadowOwnerCandidate[];
      identity?: CaptureActionIdentity;
      interactionId?: string;
      /**
       * True when the browser's own `MouseEvent.detail === 0` -- the standard, spec-defined
       * signal that this click had no genuine pointer provenance (keyboard-activated or
       * programmatic `.click()`), never a timing heuristic.
       */
      syntheticProvenance?: boolean;
    }
  | (ShadowDocumentEnvelope & { type: "pointer"; composedPath: ShadowOwnerCandidate[]; identity?: CaptureActionIdentity; sourceRefs?: CaptureSourceRefs; interactionId?: string; trusted?: boolean });

export type ShadowDiagnostic = {
  seq: number;
  reason: string;
  messageType: ShadowBrowserMessage["type"];
};

export type ShadowActionRecord = {
  /** V2's own monotonic sequence -- never replaces or feeds `SessionTrace.seq`. */
  seq: number;
  action: CaptureAction;
};

export type ShadowFunctionalActionRecord = {
  /** V2's own monotonic sequence -- shares the same counter as technicalActions/diagnostics, never SessionTrace.seq. */
  seq: number;
  action: CaptureFunctionalAction;
};

/** In-memory-only counters, computed on demand -- never persisted, never fed to SessionTrace. */
export type ShadowSummary = {
  messages: number;
  /** = technicalActions.length -- kept under this name for the existing stop()-time summary log. */
  actions: number;
  technicalActions: number;
  functionalActions: number;
  diagnostics: number;
  documents: number;
  /** Technical action type counts (edit/click/submit/observation/diagnostic). */
  actionTypeCounts: Record<string, number>;
  functionalActionTypeCounts: Record<string, number>;
};

function documentHandleOf(message: { captureInstanceId: string; documentId: string; frameId?: string }) {
  return { captureInstanceId: message.captureInstanceId, documentId: message.documentId, frameId: message.frameId };
}

export class CaptureEngineV2ShadowBridge {
  private readonly lifecycle = new DocumentLifecycle();

  private readonly editingSessions = new EditingSessionManager();

  private readonly selectionSessions = new SelectionSessionManager();

  /**
   * The sessionId of the editing session currently open, if any -- tracked here (not just in the
   * browser) so a click on a DIFFERENT, non-editable owner can commit it Playwright-like, BEFORE
   * the click's own technical action, rather than waiting for a blur/submit message that a real
   * page can fire AFTER the click (physical evidence: a login click landed before the password
   * field's blur/submit ever reached Node, producing `edit, click, edit` instead of `edit, edit,
   * click`). `null` whenever no session is open or the last one was already committed/cancelled.
   */
  private activeEditingSessionId: string | null = null;

  /**
   * One-shot correlation token: set right after a `keypress` technical action is pushed, and
   * ALWAYS consumed (cleared) by the very next `click` message, whether or not it actually
   * correlates. A click is treated as the DERIVED side effect of that key -- diagnosed, never
   * pushed as its own technical action -- only when this token is set AND the click itself
   * carries `syntheticProvenance: true` (no genuine pointer activation). A genuine mouse click
   * right after a keypress (token set, `syntheticProvenance` false/absent) is still recorded
   * normally; the token is consumed regardless, since the correlation window is exactly "the one
   * click that immediately follows this key", never a time-based guess.
   */
  private pendingKeyPress: { key: string } | null = null;

  private seq = 0;

  private messageCount = 0;

  private readonly seenDocumentIds = new Set<string>();

  /** TECHNICAL, Playwright-like stream -- every physical click/edit/submit, preserved one-to-one, replayable. */
  readonly technicalActions: ShadowActionRecord[] = [];

  /** Derived semantic projections over `technicalActions` (currently: selections). Never authoritative for replay. */
  readonly functionalActions: ShadowFunctionalActionRecord[] = [];

  readonly shadowDiagnostics: ShadowDiagnostic[] = [];

  /**
   * Fired synchronously, in the exact order each technical action is appended, right after it
   * lands in `technicalActions` -- never for a `functionalActions` entry. This is how a caller
   * (the controlled authority switch) observes the technical stream WITHOUT polling the array;
   * `technicalActions` itself remains the single source of truth, this is purely a notification.
   */
  constructor(
    private readonly log?: (line: string) => void,
    private readonly onTechnicalAction?: (record: ShadowActionRecord) => void,
    /**
     * Fired synchronously, right after a functional projection lands in `functionalActions` --
     * never for a technical action. This is how a caller (the QA Lab scenario/display path)
     * learns a `select` projection exists, WITHOUT it ever becoming replay authority: the two
     * technical clicks it summarizes still went through `onTechnicalAction` first, unchanged.
     */
    private readonly onFunctionalAction?: (record: ShadowFunctionalActionRecord) => void,
    private readonly onPointerObservation?: (record: ShadowActionRecord) => void,
  ) {}

  private nextSeq(): number {
    this.seq += 1;
    return this.seq;
  }

  /**
   * Every V2 diagnostic line goes to `console.log` directly, in addition to the optional
   * `log` callback: these lines are shadow-diagnostic-only (never production authority), and
   * whatever `onLog` a caller wires up may route only to a UI/job-log channel rather than the
   * process's own stdout -- the exact gap a real recording surfaced (no `[capture-v2]` lines
   * were visible in backend stdout even though the bridge was working). `console.log` alone
   * guarantees these are always observable regardless of that wiring.
   */
  private emit(line: string): void {
    console.log(line);
    this.log?.(line);
  }

  private diagnose(messageType: ShadowBrowserMessage["type"], reason: string): void {
    this.shadowDiagnostics.push({ seq: this.nextSeq(), reason, messageType });
    this.emit(`[capture-v2] unresolved reason=${reason}`);
  }

  /**
   * Emits the bounded, already-normalized evidence that the pure owner resolver used for an
   * unresolved click. This is diagnostic-only: no candidate is promoted and no locator/value is
   * reconstructed here. Keeping it at the reject boundary makes a physical recording sufficient
   * to distinguish a visual descendant from a genuinely ownerless click.
   */
  private diagnoseUnresolvedClickOwner(composedPath: ShadowOwnerCandidate[]): void {
    const candidates = composedPath
      .slice()
      .sort((a, b) => a.pathDepth - b.pathDepth)
      .map((candidate) => ({
        depth: candidate.pathDepth,
        tag: candidate.tag,
        role: candidate.role ?? "",
        actionable: candidate.actionable === true,
        editable: candidate.editable === true,
        visible: candidate.visible === true,
        hasTechnicalRef: (candidate.technicalRefs?.length ?? 0) > 0,
        hasAssociatedField: Boolean(candidate.associatedField),
        hasStructuralIdentity: Boolean(candidate.structuralIdentity),
        hasAccessibleName: Boolean(candidate.accessibleName),
        trustedClick: candidate.trustedClick === true,
        frameworkActionable: candidate.frameworkActionable === true,
        frameworkIdentitySufficient: candidate.frameworkIdentitySufficient === true,
      }));
    this.emit(`[capture-v2-owner-resolution] status=unresolved rule=unresolved_no_actionable_semantics candidates=${JSON.stringify(candidates)}`);
  }

  /** Appends to the TECHNICAL stream. Returns the assigned seq so a functional projection can reference it back. */
  private pushAction(action: CaptureAction): number {
    const seq = this.nextSeq();
    const record: ShadowActionRecord = { seq, action };
    this.technicalActions.push(record);
    this.emit(`[capture-v2] action seq=${seq} type=${action.actionType} ownerTag=${action.owner?.tag ?? "unknown"} ownerRole=${action.owner?.role ?? "unknown"}`);
    // Fired AFTER the push, so a caller reading technicalActions from inside the callback sees
    // this record already present -- never a race between "notified" and "actually stored".
    this.onTechnicalAction?.(record);
    return seq;
  }

  /** Appends a DERIVED functional projection. Never removes or alters anything in technicalActions. */
  private pushFunctionalAction(action: CaptureFunctionalAction): void {
    const seq = this.nextSeq();
    const record: ShadowFunctionalActionRecord = { seq, action };
    this.functionalActions.push(record);
    this.emit(
      `[capture-v2] functional seq=${seq} type=${action.functionalActionType} ownerTag=${action.owner?.tag ?? "unknown"} ownerRole=${action.owner?.role ?? "unknown"} sourceTechnicalSeqs=${action.sourceTechnicalActionSeqs.join(",")}`,
    );
    this.onFunctionalAction?.(record);
  }

  /** In-memory-only, bounded to counts -- test-only/diagnostic inspection, never a persistence path. */
  getShadowSummary(): ShadowSummary {
    const actionTypeCounts: Record<string, number> = {};
    for (const { action } of this.technicalActions) {
      actionTypeCounts[action.actionType] = (actionTypeCounts[action.actionType] ?? 0) + 1;
    }
    const functionalActionTypeCounts: Record<string, number> = {};
    for (const { action } of this.functionalActions) {
      functionalActionTypeCounts[action.functionalActionType] = (functionalActionTypeCounts[action.functionalActionType] ?? 0) + 1;
    }
    return {
      messages: this.messageCount,
      actions: this.technicalActions.length,
      technicalActions: this.technicalActions.length,
      functionalActions: this.functionalActions.length,
      diagnostics: this.shadowDiagnostics.length,
      documents: this.seenDocumentIds.size,
      actionTypeCounts,
      functionalActionTypeCounts,
    };
  }

  /**
   * Entry point for every normalized V2 browser message. Never throws: a failure anywhere in
   * this shadow pipeline is caught, recorded as a diagnostic, and swallowed -- legacy capture
   * must keep running regardless of what V2 does.
   */
  handleMessage(message: ShadowBrowserMessage): void {
    this.messageCount += 1;
    if ("documentId" in message && message.documentId) this.seenDocumentIds.add(message.documentId);
    this.emit(`[capture-v2] message type=${message.type}`);
    try {
      this.dispatch(message);
    } catch (err) {
      this.shadowDiagnostics.push({
        seq: this.nextSeq(),
        reason: `v2_internal_error:${err instanceof Error ? err.message : String(err)}`,
        messageType: message.type,
      });
    }
  }

  private dispatch(message: ShadowBrowserMessage): void {
    switch (message.type) {
      case "document_ready": {
        const record = this.lifecycle.registerDocument({
          captureInstanceId: message.captureInstanceId,
          documentId: message.documentId,
          frameId: message.frameId,
          navigationVersion: message.navigationVersion,
        });
        this.lifecycle.markDocumentReady(documentHandleOf(message));
        this.emit(`[capture-v2] document_ready document=${message.documentId} generation=${record.generation}`);
        return;
      }

      case "capture_trace":
        this.emit(`[capture-v2] trace stage=${message.stage} trusted=${message.trusted === true}${message.diagnostic ? ` diagnostic=${JSON.stringify(message.diagnostic)}` : ""}`);
        return;

      case "structural_identity_diagnostic":
        this.emit(`[structural-identity-${message.diagnosticKind === "summary" ? "candidates" : "candidate"}] ${JSON.stringify(message.payload)}`);
        return;

      case "document_retire":
        this.lifecycle.retireDocument(documentHandleOf(message));
        // A retired document can never keep a pending selection alive for whatever replaces it.
        this.selectionSessions.cancelSelectionSession();
        return;

      case "focus":
        this.onFocus(message);
        return;

      case "edit_evidence":
        this.editingSessions.recordEditingEvidence(message.sessionId, { kind: message.kind }, message.valueState);
        return;

      case "blur":
      case "submit":
        if (message.sessionId) this.commitEditingSession(message.sessionId, documentHandleOf(message), message.type);
        return;

      case "keypress":
        this.onKeyPress(message);
        return;

      case "click":
        this.onClick(message);
        return;

      case "pointer":
        this.onPointer(message);
        return;
    }
  }

  private onFocus(message: Extract<ShadowBrowserMessage, { type: "focus" }>): void {
    if (this.lifecycle.validateEventDocument(documentHandleOf(message)) !== "active_ready") {
      this.diagnose("focus", "event_document_not_ready");
      return;
    }
    // Playwright-like ordering, owner transition: focus moving to a DIFFERENT editable commits
    // whatever session was still open first, so its edit's technical action lands before
    // anything the new session eventually produces -- never mixing values/evidence between
    // owners. A focus back into the SAME session (same sessionId) is left untouched.
    if (this.activeEditingSessionId && this.activeEditingSessionId !== message.sessionId) {
      this.commitEditingSession(this.activeEditingSessionId, documentHandleOf(message), "focus");
    }
    const resolution = resolveCaptureOwner({ composedPath: message.composedPath });
    if (resolution.status !== "resolved" || resolution.owner.classification !== "editable") {
      this.diagnose("focus", "focus_owner_not_editable");
      return;
    }
    // FIRST_LOSS fix: unlike onClick (which already falls back to the resolved owner's
    // accessibleName/role), this used to forward `message.identity` verbatim -- and the browser
    // instrumentation's own `focus` message never includes any label/accessibleName field at
    // all, so every edit's identity.label was always undefined regardless of what the real
    // element's accessible name was. Owner-derived fields go first so any field the browser DID
    // send (tagName/inputType/domId) still wins by being spread on top.
    this.editingSessions.openEditingSession({
      sessionId: message.sessionId,
      owner: resolution.owner,
      documentContext: documentHandleOf(message),
      identity: { label: resolution.owner.accessibleName, role: resolution.owner.role, ...message.identity },
      initialValue: message.initialValue,
      sensitive: message.sensitive,
      sourceRefs: message.sourceRefs,
      playwrightRecorderEvidence: resolution.owner.playwrightRecorderEvidence,
    });
    this.activeEditingSessionId = message.sessionId;
  }

  private onPointer(message: Extract<ShadowBrowserMessage, { type: "pointer" }>): void {
    if (message.trusted !== true || this.lifecycle.validateEventDocument(documentHandleOf(message)) !== "active_ready") {
      this.diagnose("pointer", message.trusted === true ? "event_document_not_ready" : "pointer_not_trusted");
      return;
    }
    const resolution = resolveCaptureOwner({ composedPath: message.composedPath });
    if (resolution.status !== "resolved") {
      this.diagnose("pointer", "pointer_owner_unresolved");
      return;
    }
    this.onPointerObservation?.({
      seq: this.nextSeq(),
      action: {
        actionType: "observation",
        observationType: "pointer",
        interactionId: message.interactionId,
        identity: message.identity ?? { label: resolution.owner.accessibleName, tagName: resolution.owner.tag, role: resolution.owner.role },
        owner: resolution.owner,
        documentContext: documentHandleOf(message),
        sourceRefs: message.sourceRefs,
      },
    });
  }

  /**
   * The single place that ever calls `editingSessions.commitEditingSession`. Reused by the
   * pre-click/pre-focus commit (Playwright-like ordering), by `blur`/`submit` (the existing
   * safety net for whichever session, if any, is still open), and by the owner-transition commit
   * in `onFocus` -- `EditingSessionManager`'s own `already_committed`/`cancelled` outcomes are
   * what make a later, redundant call from any of these paths a no-op diagnostic, never a
   * duplicate action (no separate dedup logic is added here).
   */
  private commitEditingSession(sessionId: string, handle: { captureInstanceId: string; documentId: string }, messageType: ShadowBrowserMessage["type"]): void {
    if (this.activeEditingSessionId === sessionId) this.activeEditingSessionId = null;
    const result = this.editingSessions.commitEditingSession(sessionId, handle);
    if (result.status === "committed") {
      this.pushAction(result.action);
      return;
    }
    this.diagnose(messageType, `commit_${result.status}`);
  }

  /**
   * A discrete, non-textual command key (Enter/Escape/...) on its own editable/actionable owner
   * -- a TECHNICAL `"press"` action, never a click, even though the browser/framework may go on
   * to fire a synthetic click as a side effect of this same key (a form's Enter-triggered
   * submit). Playwright-like ordering applies here too: any pending editing session is committed
   * FIRST, so `edit` lands before `press` (e.g. a still-open password field committed before its
   * own Enter keypress), exactly like the pre-click commit.
   */
  private onKeyPress(message: Extract<ShadowBrowserMessage, { type: "keypress" }>): void {
    if (this.lifecycle.validateEventDocument(documentHandleOf(message)) !== "active_ready") {
      this.diagnose("keypress", "event_document_not_ready");
      return;
    }
    const resolution = resolveCaptureOwner({ composedPath: message.composedPath });
    if (resolution.status !== "resolved") {
      this.diagnose("keypress", "keypress_owner_unresolved");
      return;
    }

    const documentContext = documentHandleOf(message);

    // Playwright-like ordering: commit any pending edit on THIS owner (or any other) before the
    // press, never after -- same principle as the pre-click commit, reusing the same helper.
    if (this.activeEditingSessionId) {
      this.commitEditingSession(this.activeEditingSessionId, documentContext, "keypress");
    }

    this.pushAction({
      actionType: "press",
      key: message.key,
      identity: message.identity ?? { label: resolution.owner.accessibleName, tagName: resolution.owner.tag, role: resolution.owner.role },
      owner: resolution.owner,
      documentContext,
      sourceRefs: message.sourceRefs,
    });

    // One-shot: the very next click (correlated or not) consumes this token.
    this.pendingKeyPress = { key: message.key };
  }

  private onClick(message: Extract<ShadowBrowserMessage, { type: "click" }>): void {
    if (this.lifecycle.validateEventDocument(documentHandleOf(message)) !== "active_ready") {
      this.diagnose("click", "event_document_not_ready");
      return;
    }
    // One-shot consumption: whatever happens with this click, the token is used up now -- the
    // correlation window is exactly "the one click immediately following the key", never a
    // time-based guess.
    const pendingKeyPress = this.pendingKeyPress;
    this.pendingKeyPress = null;
    if (pendingKeyPress && message.syntheticProvenance === true) {
      // This click has no genuine pointer provenance (MouseEvent.detail === 0) and immediately
      // follows a press -- it is the browser/framework's own synthetic side effect of that key,
      // never a second, independent click authority.
      this.diagnose("click", `click_derived_from_keypress:${pendingKeyPress.key}`);
      return;
    }

    const resolution = resolveCaptureOwner({ composedPath: message.composedPath });
    if (resolution.status !== "resolved") {
      this.diagnoseUnresolvedClickOwner(message.composedPath);
      this.diagnose("click", "click_owner_unresolved");
      // Preserve a trusted physical click as an explicitly unresolved technical action when
      // V2's browser-side pointer lifecycle supplied an interactionId. The raw event target is
      // observation metadata only: no owner, locator, or technical authority is fabricated.
      // Without the trusted pointer identity (synthetic/untrusted click), keep the existing
      // fail-closed drop path.
      if (message.interactionId) {
        const rawTarget = [...message.composedPath].sort((a, b) => a.pathDepth - b.pathDepth)[0];
        const documentContext = documentHandleOf(message);
        const rawIdentity = rawTarget?.structuralIdentity;
        const scopeCandidate = message.composedPath.find((candidate) => {
          const identity = candidate.structuralIdentity;
          return Boolean(identity?.scopeIdentity && identity.captureScopeUnique === true);
        });
        const scopeIdentity = scopeCandidate?.structuralIdentity;
        // FIRST_LOSS fix (recordingId=842325b2-...): PAGE-WIDE target uniqueness -> SCOPE-RELATIVE
        // target uniqueness. `rawIdentity.captureTargetMatchCount`/`structuralIdentityMatchCount`
        // are only ever meaningful relative to WHATEVER scope THEY were computed against (the
        // browser scopes each candidate's own match count to whichever nearest ancestor ITS OWN
        // walk found -- never necessarily the same element `scopeCandidate` represents). Pairing
        // `scopeCandidate`'s verified-unique scope with `rawIdentity`'s counts unconditionally
        // silently assumed those counts were already relative to THAT exact scope, which is only
        // actually true in two cases:
        //   (a) rawIdentity found and self-verified its OWN scope (captureScopeUnique===true on
        //       the SAME identity) -- its counts are then guaranteed relative to that same scope;
        //   (b) rawIdentity found NO scope at all, so its counts are the GLOBAL (page-wide) ones --
        //       a globally-unique target (count===1) is trivially unique within ANY subset of the
        //       page by simple set containment, so pairing it with a DIFFERENT, independently
        //       verified scope is still sound.
        // Any other shape (a scope found, but not self-verified as unique) never proves the
        // count is scope-relative to `scopeCandidate` specifically -- fail closed, never guess.
        const rawScopeSelfVerified = Boolean(rawIdentity?.scopeIdentity) && rawIdentity?.captureScopeUnique === true;
        const rawGloballyUnique = !rawIdentity?.scopeIdentity && rawIdentity?.structuralIdentityMatchCount === 1;
        const inferredPairedIdentity = rawScopeSelfVerified
          ? {
              ...rawIdentity!,
              deterministicStructuralIdentity: rawIdentity!.captureTargetMatchCount === 1
                && rawIdentity!.structuralIdentityMatchCount === 1,
            }
          : rawGloballyUnique && scopeIdentity?.scopeIdentity
            ? {
                ...rawIdentity!,
                scopeIdentity: scopeIdentity.scopeIdentity,
                captureScopeUnique: scopeIdentity.captureScopeUnique,
                deterministicStructuralIdentity: rawIdentity!.captureTargetMatchCount === 1
                  && rawIdentity!.structuralIdentityMatchCount === 1,
              }
            : undefined;
        // Prefer pre-correlated evidence: each candidate that carries `scopeBoundOriginalTargetIdentity`
        // already proved the ORIGINAL target's fingerprint/match count against ITS OWN element as scope
        // root -- scope and target proof come from the exact same boundary, never combined post-hoc.
        // Never recompute/mix counts across candidates. Exactly one valid scope-bound candidate is used;
        // more than one is ambiguous scope selection and fails closed (no ordinal authority), mirroring
        // the existing `frameworkOwners.length > 1 -> unresolved` policy. Falls back to the raw-target
        // inference above only when no candidate offers this pre-correlated evidence at all.
        const scopeBoundCandidates = message.composedPath.filter(
          (candidate) => Boolean(candidate.scopeBoundOriginalTargetIdentity),
        );
        const scopeBoundValidCandidates = scopeBoundCandidates.filter(
          (candidate) => Boolean(buildScopedStructuralRuntimeEvidence(candidate.scopeBoundOriginalTargetIdentity)),
        );
        const scopeBoundFallbackAttempted = scopeBoundValidCandidates.length === 0;
        const pairedIdentity = scopeBoundValidCandidates.length === 1
          ? scopeBoundValidCandidates[0].scopeBoundOriginalTargetIdentity
          : scopeBoundValidCandidates.length > 1
            ? undefined
            : inferredPairedIdentity;
        const scopedEvidence = buildScopedStructuralRuntimeEvidence(pairedIdentity);
        // DIAGNOSE-ONLY (recordingId=9db2d5ff-...): distinguish WHERE in the scope-bound pipeline
        // a click loses evidence -- zero/one/multiple valid candidates vs. a fallback that itself
        // returned nothing -- without changing selection/attachment behavior. Per-candidate reasons
        // are redacted booleans/count-classes only, never raw ids/attributes/text.
        const matchCountClass = (n: number | undefined): "zero" | "one" | "many" | "unknown" =>
          n === undefined ? "unknown" : n === 0 ? "zero" : n === 1 ? "one" : "many";
        const scopeBoundCandidateDiagnostics = scopeBoundCandidates.map((candidate) => {
          const identity = candidate.scopeBoundOriginalTargetIdentity;
          return {
            scopeIdentityPresent: Boolean(identity?.scopeIdentity),
            targetFingerprintPresent: Boolean(identity?.targetFingerprint),
            deterministicStructuralIdentity: identity?.deterministicStructuralIdentity === true,
            captureScopeUnique: identity?.captureScopeUnique === true,
            captureTargetMatchCountClass: matchCountClass(identity?.captureTargetMatchCount),
            structuralIdentityMatchCountClass: matchCountClass(identity?.structuralIdentityMatchCount),
            builderAccepted: Boolean(buildScopedStructuralRuntimeEvidence(identity)),
          };
        });
        // DIAGNOSTIC-ONLY additions (physical-owner-loss investigation, recordingId=842325b2-...):
        // same message, same channel -- no new authority, no behavior change. `scopeAvailable`/
        // `fingerprintAvailable` report RAW presence (was there ANY scope/fingerprint data at
        // all), deliberately independent of `pairedIdentity` -- so a rejected-but-present pairing
        // (scope-relative uniqueness not provable) stays distinguishable from truly absent
        // capture evidence, exactly the distinction that originally surfaced this first-loss.
        this.emit(`[capture-v2] trace stage=structural_runtime_evidence_attachment trusted=true diagnostic=${JSON.stringify({
          scopeAvailable: Boolean(scopeIdentity?.scopeIdentity),
          fingerprintAvailable: Boolean(rawIdentity?.targetFingerprint),
          scopeAttachedToClick: Boolean(scopedEvidence && pairedIdentity?.scopeIdentity),
          fingerprintAttachedToClick: Boolean(scopedEvidence && pairedIdentity?.targetFingerprint),
          runtimeEvidenceEligibleAtBrowser: Boolean(scopedEvidence),
          attachmentRejectedReason: scopedEvidence
            ? "none"
            : !pairedIdentity
              ? "scope_relative_uniqueness_not_provable"
              : "insufficient_capture_evidence",
          bridgeRevision: "scoped-attachment-v1",
          selectedScopePresent: Boolean(scopeCandidate),
          selectedFingerprintPresent: Boolean(rawIdentity?.targetFingerprint),
          builderCalled: true,
          builderReturnedEvidence: Boolean(scopedEvidence),
          rawClickStructuralEvidencePresent: Boolean(rawIdentity),
          scopeBoundCandidateCount: scopeBoundCandidates.length,
          scopeBoundEvidencePresentCount: scopeBoundCandidates.length,
          scopeBoundBuilderAcceptedCount: scopeBoundValidCandidates.length,
          scopeBoundBuilderRejectedCount: scopeBoundCandidates.length - scopeBoundValidCandidates.length,
          selectionCardinality: scopeBoundValidCandidates.length === 0
            ? "zero"
            : scopeBoundValidCandidates.length === 1
              ? "one"
              : "multiple",
          fallbackAttempted: scopeBoundFallbackAttempted,
          fallbackReturnedEvidence: scopeBoundFallbackAttempted ? Boolean(scopedEvidence) : false,
          finalScopedEvidencePresent: Boolean(scopedEvidence),
          scopeBoundCandidateDiagnostics,
        })}`);
        // LAST-RESORT, EXECUTION-ONLY: only attempted when structural runtime evidence produced
        // nothing (`scopedEvidence` undefined) -- certified target, then structural runtime
        // evidence, then semantic runtime evidence, then fail closed. Never recomputed/validated
        // again here: the browser already proved capture-time uniqueness; passed through as-is,
        // never merged into `technicalEvidence`/certified owner.
        const semanticRuntimeEvidence = !scopedEvidence ? rawTarget?.semanticRuntimeEvidence : undefined;
        const semanticDerivedRecorderEvidence = recorderEvidenceFromSemanticRuntime(
          semanticRuntimeEvidence,
          rawTarget?.role,
        );
        // FALLBACK, EXECUTION-ONLY (recordingId=b9981890-...): the browser's own last-resort
        // fallback (no unique semantic scope alternative, so no `semanticRuntimeEvidence` --
        // still recorded a stable recorder intent directly on the raw target) was previously
        // dropped here because this branch only ever consulted `semanticRuntimeEvidence`.
        // Passed through AS-IS, never recomputed/merged -- only used when the existing
        // semantic-derived path produced nothing, so it never overrides that authority.
        const playwrightRecorderEvidence = semanticDerivedRecorderEvidence
          ?? (!scopedEvidence ? rawTarget?.playwrightRecorderEvidence : undefined);
        this.emit(`[capture-v2] trace stage=semantic_runtime_evidence_attachment trusted=true diagnostic=${JSON.stringify({
          semanticRuntimeEvidencePresent: Boolean(semanticRuntimeEvidence),
          semanticScopeAlternativeCount: semanticRuntimeEvidence?.scopeAlternatives.length ?? 0,
          browserRecorderFallbackUsed: !semanticDerivedRecorderEvidence && Boolean(playwrightRecorderEvidence),
        })}`);
        this.pushAction({
          actionType: "click",
          interactionId: message.interactionId,
          identity: message.identity ?? {
            label: rawTarget?.accessibleName,
            tagName: rawTarget?.tag,
            role: rawTarget?.role,
          },
          documentContext,
          ...(scopedEvidence ? { technicalEvidence: scopedEvidence } : {}),
          ...(semanticRuntimeEvidence ? { semanticRuntimeEvidence } : {}),
          ...(playwrightRecorderEvidence ? { playwrightRecorderEvidence } : {}),
        });
      }
      return;
    }
    if (resolution.owner.classification === "editable") {
      // A click that resolves to an editable owner is an edit interaction, not a click action --
      // the editing-session flow (focus/edit_evidence/blur) is what represents it. Still the
      // same field being edited, so no commit is forced here -- forcing one would just split one
      // edit into two for no reason.
      this.diagnose("click", "click_target_is_editable_owner");
      return;
    }

    const documentContext = documentHandleOf(message);

    // Playwright-like ordering: a click on a DIFFERENT, non-editable owner commits any pending
    // editing session FIRST, so the edit's technical action lands before the click's -- never
    // waiting for blur/submit, which a real page can fire only AFTER the click already ran
    // (physical evidence: a login click landed before the password field's own blur/submit
    // reached Node at all). A later blur/submit for the same session is then a safe no-op via
    // EditingSessionManager's own already-committed guard -- no separate dedup added here.
    if (this.activeEditingSessionId) {
      this.commitEditingSession(this.activeEditingSessionId, documentContext, "click");
    }

    // Every resolved click ALWAYS becomes its own technical CaptureAction, unconditionally -- a
    // combobox click and an option click are each preserved exactly as physically performed,
    // Playwright-like and replayable. SelectionSessionManager only OBSERVES this technical
    // action afterward to decide whether it ALSO warrants a separate, derived functional
    // projection; it never gets a say in whether the technical action itself is recorded.
    // FIRST_LOSS fix: a resolved click's technical/structural evidence (locator refs +
    // structuralContext/landmarkAncestor, when the browser instrumentation computed them for
    // this owner) previously never reached the CaptureAction at all -- `technicalEvidence` was
    // only ever populated on the EDIT path. Built from the SAME `resolution.owner` this click
    // already resolved, never re-derived from a display label or runtime clustering.
    const technicalEvidence = buildOwnerTechnicalEvidence(resolution.owner, resolution.reason);
    // LAST-RESORT, EXECUTION-ONLY (recordingId=5514cd5b-...): a click whose owner classification
    // succeeded (Priority 2-4) but whose OWN structural identity failed to certify
    // (ambiguous/insufficient -- technicalEvidence undefined) previously had NO fallback at all,
    // unlike the unresolved-owner branch above -- semantic runtime evidence was architecturally
    // walled off behind `resolution.status !== "resolved"` even though the browser already
    // computes it for the ORIGINAL clicked target unconditionally. Reuses the SAME
    // rawTarget.semanticRuntimeEvidence, never recomputed/re-validated here, never merged into
    // `technicalEvidence`/`owner` (which stay exactly as `resolveCaptureOwner` produced them).
    const rawTargetForSemanticFallback = !technicalEvidence
      ? [...message.composedPath].sort((a, b) => a.pathDepth - b.pathDepth)[0]
      : undefined;
    const semanticRuntimeEvidence = rawTargetForSemanticFallback?.semanticRuntimeEvidence;
    const playwrightRecorderEvidence = recorderEvidenceFromSemanticRuntime(semanticRuntimeEvidence, rawTargetForSemanticFallback?.role);
    if (rawTargetForSemanticFallback) {
      this.emit(`[capture-v2] trace stage=semantic_runtime_evidence_attachment_resolved_owner trusted=true diagnostic=${JSON.stringify({
        recorderCandidateAttempted: true,
        semanticValueObserved: Boolean(semanticRuntimeEvidence),
        candidateCreated: Boolean(playwrightRecorderEvidence),
        candidateKind: playwrightRecorderEvidence?.kind ?? "none",
        scopePresent: Boolean(semanticRuntimeEvidence?.scopeAlternatives?.length),
        captureMatchCountClass: semanticRuntimeEvidence
          ? (semanticRuntimeEvidence.scopeAlternatives.length === 0 ? "zero" : semanticRuntimeEvidence.scopeAlternatives.length === 1 ? "one" : "many")
          : "unknown",
        candidateAttachedToRaw: Boolean(playwrightRecorderEvidence),
      })}`);
    }
    const technicalSeq = this.pushAction({
      actionType: "click",
      interactionId: message.interactionId,
      identity: message.identity ?? { label: resolution.owner.accessibleName, tagName: resolution.owner.tag, role: resolution.owner.role },
      owner: resolution.owner,
      documentContext,
      ...(technicalEvidence ? { technicalEvidence } : {}),
      ...(semanticRuntimeEvidence ? { semanticRuntimeEvidence } : {}),
      ...(playwrightRecorderEvidence ? { playwrightRecorderEvidence } : {}),
    });

    const observation = this.selectionSessions.observeTechnicalClick({
      owner: resolution.owner,
      documentContext,
      technicalActionSeq: technicalSeq,
      identity: message.identity,
      selectedDisplay: resolution.owner.accessibleName,
    });

    switch (observation.outcome) {
      case "opened":
      case "reopened":
        this.emit(`[capture-v2] selection_open ownerTag=${resolution.owner.tag ?? "unknown"} ownerRole=${resolution.owner.role ?? "unknown"}`);
        return;
      case "projected":
        this.pushFunctionalAction(observation.action);
        return;
      case "orphan_option":
        this.diagnose("click", "selection_orphan_option");
        return;
      case "unrelated_cancelled":
        this.diagnose("click", "selection_cancelled_unrelated_owner");
        return;
      case "ignored":
        return;
    }
  }
}
