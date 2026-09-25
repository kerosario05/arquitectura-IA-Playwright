import type { CaptureDocumentRecord, DocumentLifecycleState } from "./capture-engine-v2.types";

/**
 * CaptureEngine V2 -- models one document's lifecycle (install -> ready handshake -> active ->
 * retired-on-navigation) independently of any DOM/Playwright event, so a future capture source
 * can drive it from whatever signals it has (e.g. an init-script guard, a `framenavigated`
 * event) without re-deriving these rules per listener. Pure, in-memory, no timers -- NOT wired
 * into `web-session-recorder.ts`, CaptureEngine V2 stays fully disconnected.
 *
 * Mirrors, in spirit, the guard `web-session-recorder.ts`'s CAPTURE_SCRIPT already uses
 * (`window.__qaRecorderInstalledV1`) plus the `framenavigated` handler that reinstalls it --
 * generalized into an explicit state machine: a document is never capturable just because it was
 * registered, only once it has completed its own ready handshake.
 */

export type RegisterDocumentInput = {
  captureInstanceId: string;
  documentId: string;
  frameId?: string;
  /** Present on a same-document (SPA) navigation being reported for an already-known document. */
  navigationVersion?: number;
};

export type DocumentHandle = { captureInstanceId: string; documentId: string; frameId?: string };

export type EventDocumentValidation =
  | "active_ready"
  | "installing"
  | "retired"
  | "failed"
  | "unknown_document"
  | "wrong_capture_instance";

export class DocumentLifecycle {
  private readonly documents = new Map<string, CaptureDocumentRecord>();

  private readonly activeDocumentIdByFrame = new Map<string, string>();

  private generationCounter = 0;

  /**
   * Registers a document as `"installing"`.
   *
   * Duplicate register of an already-known `documentId` is idempotent and never creates a
   * second record. If it also carries a `navigationVersion`, that is treated as a same-document
   * (SPA) navigation report: the version advances in place and the document's current state
   * (e.g. `"ready"`) is left untouched -- no new document is fabricated for it.
   *
   * A genuinely NEW `documentId` retires only the document previously active in the SAME frame
   * (full navigation / document replacement), then becomes that frame's active document,
   * `"installing"` until its own ready handshake completes. Documents in sibling frames remain
   * ready concurrently.
   */
  registerDocument(input: RegisterDocumentInput): CaptureDocumentRecord {
    const existing = this.documents.get(input.documentId);
    if (existing) {
      if (input.navigationVersion !== undefined && input.navigationVersion !== existing.navigationVersion) {
        existing.navigationVersion = input.navigationVersion;
      }
      return existing;
    }

    const frameKey = input.frameId ?? "default-frame";
    const activeDocumentId = this.activeDocumentIdByFrame.get(frameKey);
    if (activeDocumentId && activeDocumentId !== input.documentId) {
      this.retireDocument({ captureInstanceId: input.captureInstanceId, documentId: activeDocumentId, frameId: input.frameId });
    }

    this.generationCounter += 1;
    const record: CaptureDocumentRecord = {
      captureInstanceId: input.captureInstanceId,
      documentId: input.documentId,
      frameId: input.frameId,
      navigationVersion: input.navigationVersion ?? 0,
      generation: this.generationCounter,
      state: "installing",
    };
    this.documents.set(input.documentId, record);
    this.activeDocumentIdByFrame.set(frameKey, input.documentId);
    return record;
  }

  /**
   * Completes the ready handshake. A retired or failed document can never be resurrected into
   * `"ready"` -- the call is a safe no-op, returning the record in its current (unchanged) state.
   * Repeating the call on an already-`"ready"` document is likewise a no-op, never a duplicate
   * transition.
   */
  markDocumentReady(handle: DocumentHandle): CaptureDocumentRecord | undefined {
    const record = this.documents.get(handle.documentId);
    if (!record || record.captureInstanceId !== handle.captureInstanceId) return record;
    if (record.state === "retired" || record.state === "failed") return record;
    record.state = "ready";
    return record;
  }

  retireDocument(handle: DocumentHandle): CaptureDocumentRecord | undefined {
    const record = this.documents.get(handle.documentId);
    if (!record || record.captureInstanceId !== handle.captureInstanceId) return record;
    record.state = "retired";
    const frameKey = record.frameId ?? "default-frame";
    if (this.activeDocumentIdByFrame.get(frameKey) === handle.documentId) this.activeDocumentIdByFrame.delete(frameKey);
    return record;
  }

  markDocumentFailed(handle: DocumentHandle, reason?: string): CaptureDocumentRecord | undefined {
    const record = this.documents.get(handle.documentId);
    if (!record || record.captureInstanceId !== handle.captureInstanceId) return record;
    record.state = "failed";
    record.failureReason = reason;
    const frameKey = record.frameId ?? "default-frame";
    if (this.activeDocumentIdByFrame.get(frameKey) === handle.documentId) this.activeDocumentIdByFrame.delete(frameKey);
    return record;
  }

  /** The active document for a frame, whatever its current state. Deterministic. */
  getActiveDocument(frameId?: string): CaptureDocumentRecord | undefined {
    return this.documents.get(this.activeDocumentIdByFrame.get(frameId ?? "default-frame") ?? "");
  }

  isDocumentReady(documentId: string): boolean {
    return this.documents.get(documentId)?.state === "ready";
  }

  /**
   * Classifies whether an incoming event's document may become a functional `CaptureAction`.
   * Only `"active_ready"` may; every other outcome is a rejection reason, and NONE of them is
   * ever silently converted into an action by the caller.
   */
  validateEventDocument(handle: DocumentHandle): EventDocumentValidation {
    const record = this.documents.get(handle.documentId);
    if (!record) return "unknown_document";
    if (record.captureInstanceId !== handle.captureInstanceId) return "wrong_capture_instance";
    if ((record.frameId ?? "default-frame") !== (handle.frameId ?? "default-frame")) return "unknown_document";
    if (record.state === "ready") return "active_ready";
    return record.state satisfies DocumentLifecycleState;
  }
}
