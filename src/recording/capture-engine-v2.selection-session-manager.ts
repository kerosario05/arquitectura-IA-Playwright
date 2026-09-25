import type {
  CaptureActionIdentity,
  CaptureDocumentContext,
  CaptureFunctionalAction,
  CaptureOwner,
  CaptureSourceRefs,
  CaptureTechnicalEvidence,
} from "./capture-engine-v2.types";

/**
 * CaptureEngine V2 -- OBSERVES the technical (Playwright-like) click stream and, when a
 * combobox-owner click is later followed by a compatible option click, PROJECTS one logical
 * `CaptureFunctionalAction(functionalActionType="select")` -- without ever removing, replacing,
 * or otherwise mutating the two technical `CaptureAction`s that produced it. Pure, in-memory, no
 * DOM/Playwright/timers -- used ONLY by the SHADOW bridge; `v2Authority` stays false and this
 * module has no dependency on, or awareness of, the legacy recording pipeline.
 *
 * Architecture correction: an earlier version of this manager CONSUMED owner/option clicks and
 * replaced them with a single action, which silently dropped two physical, replayable actions
 * from the technical stream. That was wrong -- MCP/Playwright-style replay needs BOTH raw clicks
 * to exist. This manager now only OBSERVES already-recorded technical actions and produces a
 * SEPARATE, derived functional projection; the technical stream is never its business to alter.
 */

export type TechnicalClickObservation = {
  owner: CaptureOwner;
  documentContext: CaptureDocumentContext;
  /** The seq the bridge's technicalActions store already assigned to this click's CaptureAction. */
  technicalActionSeq: number;
  identity?: CaptureActionIdentity;
  sourceRefs?: CaptureSourceRefs;
  /** Present only for an option-owner observation. */
  selectedValue?: string;
  selectedDisplay?: string;
  optionTechnicalEvidence?: CaptureTechnicalEvidence;
};

export type SelectionObservationOutcome =
  | { outcome: "opened" }
  | { outcome: "reopened" }
  | { outcome: "projected"; action: CaptureFunctionalAction }
  | { outcome: "orphan_option" }
  | { outcome: "unrelated_cancelled" }
  | { outcome: "ignored" };

type PendingSelection = {
  documentContext: CaptureDocumentContext;
  owner: CaptureOwner;
  identity: CaptureActionIdentity;
  sourceRefs?: CaptureSourceRefs;
  technicalActionSeq: number;
};

/**
 * Combobox identity: an actual `<select>`, or anything the resolver classified with
 * `role="combobox"`. Never opened from text content or a generic container -- `resolveCaptureOwner`
 * already refuses those a genuine actionable identity, so by the time an owner reaches here it is
 * already a real, structurally-justified control.
 */
function isComboboxOwner(owner: CaptureOwner): boolean {
  return owner.tag === "select" || owner.role === "combobox";
}

function isOptionOwner(owner: CaptureOwner): boolean {
  return owner.tag === "option" || owner.role === "option";
}

function buildFunctionalSelect(pending: PendingSelection, optionEvent: TechnicalClickObservation): CaptureFunctionalAction {
  return {
    functionalActionType: "select",
    identity: pending.identity,
    // The COMBOBOX remains the owner -- the option only contributes selection evidence, never
    // owner identity, associatedField, or technical refs.
    owner: pending.owner,
    documentContext: pending.documentContext,
    sourceRefs: pending.sourceRefs,
    sourceTechnicalActionSeqs: [pending.technicalActionSeq, optionEvent.technicalActionSeq],
    selectionEvidence: {
      selectedValue: optionEvent.selectedValue,
      selectedDisplay: optionEvent.selectedDisplay,
      optionOwner: optionEvent.owner,
      optionTechnicalEvidence: optionEvent.optionTechnicalEvidence,
    },
  };
}

export class SelectionSessionManager {
  private pending: PendingSelection | null = null;

  /**
   * The single entry point: called by the bridge AFTER it has already appended the technical
   * click's `CaptureAction` to `technicalActions` -- this method's return value never influences
   * whether that append happened, only whether a SEPARATE functional projection is also
   * produced. The bridge never calls this for an unresolved click (no owner was resolved at
   * all), which is what makes an unresolved intermediate event -- overlay/backdrop/framework
   * noise -- harmless: no call means no change to whatever session is already pending.
   */
  observeTechnicalClick(event: TechnicalClickObservation): SelectionObservationOutcome {
    const { owner, documentContext } = event;

    if (isComboboxOwner(owner)) {
      const reopened = this.pending !== null;
      this.pending = {
        documentContext,
        owner,
        identity: event.identity ?? {},
        sourceRefs: event.sourceRefs,
        technicalActionSeq: event.technicalActionSeq,
      };
      return { outcome: reopened ? "reopened" : "opened" };
    }

    if (isOptionOwner(owner)) {
      if (!this.pending) return { outcome: "orphan_option" };
      if (this.pending.documentContext.documentId !== documentContext.documentId) {
        // Never merge a selection across documents -- the stale pending session is discarded,
        // and the option arriving in a different document is treated as ownerless. The technical
        // click that triggered this was already recorded regardless.
        this.pending = null;
        return { outcome: "orphan_option" };
      }
      const action = buildFunctionalSelect(this.pending, event);
      this.pending = null; // projecting clears the session -- a duplicate option event afterward is a fresh orphan_option, never a second projection.
      return { outcome: "projected", action };
    }

    // Any other resolved, unrelated actionable owner invalidates a pending selection -- a stale
    // combobox must never be resurrected as the owner of some later, unrelated click (e.g. a
    // "Iniciar sesión" button click arriving after an abandoned combobox open). The button's own
    // technical click was already recorded regardless of this outcome.
    if (this.pending) {
      this.pending = null;
      return { outcome: "unrelated_cancelled" };
    }
    return { outcome: "ignored" };
  }

  cancelSelectionSession(): void {
    this.pending = null;
  }
}
