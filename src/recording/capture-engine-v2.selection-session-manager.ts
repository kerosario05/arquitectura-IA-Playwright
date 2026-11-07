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
  /**
   * The opener is a combobox whose text box is editable. Typing into it is an edit, not a selection, so a session
   * opened this way is dropped as soon as an edit is recorded (see cancelIfOpenedFromEditableControl).
   */
  fromEditableControl?: boolean;
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
  fromEditableControl?: boolean;
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

function isExplicitAriaPopupOwner(owner: CaptureOwner): boolean {
  return owner.selectionTriggerEvidence === "aria_popup"
    && owner.classification === "actionable"
    && Boolean(owner.associatedField?.trim());
}

function isOptionOwner(owner: CaptureOwner): boolean {
  return owner.tag === "option" || owner.role === "option";
}

/**
 * A custom dropdown's trigger is often a plain `div`/`span` with no ARIA role (the click landed on
 * its wrapper rather than the inner combobox). It is still a selection opener when field-owner
 * resolution already tied it to a named field and it is an actionable control: the session only
 * projects if the VERY NEXT click is an option, and any other click cancels it, so a non-dropdown
 * container cannot be mistaken for one. Buttons/links/inputs never qualify here.
 */
function isFieldOwnedContainerTrigger(owner: CaptureOwner): boolean {
  const tag = owner.tag?.toLowerCase();
  return (tag === "div" || tag === "span")
    && owner.classification === "actionable"
    && !owner.role
    && Boolean(owner.associatedField?.trim());
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

/**
 * A click that resolved to no owner at all (the arrow icon of a custom dropdown has no role, no cursor
 * pointer and no name) but sits inside a wrapper the field-owner resolution already tied to a named field.
 * Only ever used when the VERY NEXT resolved click is an option: that pairing is what proves it was the opener.
 */
export type UnresolvedOpenerHint = {
  documentContext: CaptureDocumentContext;
  associatedField: string;
  technicalActionSeq: number;
  identity?: CaptureActionIdentity;
  sourceRefs?: CaptureSourceRefs;
};

export class SelectionSessionManager {
  private pending: PendingSelection | null = null;
  private unresolvedOpener: UnresolvedOpenerHint | null = null;

  /** Remembers the latest unresolved click (or forgets it when that click names no field). */
  noteUnresolvedClick(hint: UnresolvedOpenerHint | null): void {
    this.unresolvedOpener = hint;
  }

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
    // Any resolved click uses up the unresolved-opener hint: it only ever bridges to the very next click.
    const unresolvedOpener = this.unresolvedOpener;
    this.unresolvedOpener = null;

    if (isComboboxOwner(owner) || isExplicitAriaPopupOwner(owner) || isFieldOwnedContainerTrigger(owner)) {
      const reopened = this.pending !== null;
      this.pending = {
        documentContext,
        owner,
        identity: event.identity ?? {},
        sourceRefs: event.sourceRefs,
        technicalActionSeq: event.technicalActionSeq,
        ...(event.fromEditableControl ? { fromEditableControl: true } : {}),
      };
      return { outcome: reopened ? "reopened" : "opened" };
    }

    if (isOptionOwner(owner)) {
      if (!this.pending && unresolvedOpener && unresolvedOpener.documentContext.documentId === documentContext.documentId) {
        // The opener click had no owner of its own, but it sat inside a named field and an option came next:
        // the field is the owner. Only the field name is claimed; no technical identity is invented for it.
        this.pending = {
          documentContext: unresolvedOpener.documentContext,
          owner: { tag: "div", classification: "actionable", associatedField: unresolvedOpener.associatedField },
          identity: unresolvedOpener.identity ?? {},
          sourceRefs: unresolvedOpener.sourceRefs,
          technicalActionSeq: unresolvedOpener.technicalActionSeq,
        };
      }
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

  /** An edit was recorded: a list opened from an editable combobox was an autocomplete, not a plain selection. */
  cancelIfOpenedFromEditableControl(): void {
    if (this.pending?.fromEditableControl) this.pending = null;
  }

  cancelSelectionSession(): void {
    this.pending = null;
    this.unresolvedOpener = null;
  }
}
