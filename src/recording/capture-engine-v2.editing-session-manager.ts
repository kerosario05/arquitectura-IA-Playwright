import type {
  CaptureAction,
  CaptureActionIdentity,
  CaptureContextEvidence,
  CaptureDocumentContext,
  CaptureOwner,
  CaptureSemanticEvidence,
  CaptureSourceRefs,
  CaptureTechnicalEvidence,
  CaptureValueState,
} from "./capture-engine-v2.types";
import type { PlaywrightRecorderEvidence } from "./structural-owner-identity";

/**
 * CaptureEngine V2 -- coalesces a whole user editing sequence (OPEN -> EDITING ->
 * COMMIT_PENDING -> COMMITTED) into exactly ONE `CaptureAction(actionType="edit")`, instead of
 * one action per keystroke/DOM event. Pure, in-memory, no DOM/Playwright/timers -- NOT wired
 * into `web-session-recorder.ts`, CaptureEngine V2 stays fully disconnected.
 *
 * Mirrors the concept `web-session-recorder.ts` already tracks with
 * `openEditingSessionFor`/`flushEditingSession`, generalized so a future capture source can
 * drive the same lifecycle from normalized evidence instead of raw DOM events.
 */

/**
 * Evidence kinds the manager accepts as proof a real user edited something. Deliberately plural
 * and pre-normalized: the manager never inspects `Event.isTrusted` or any DOM event itself --
 * the caller (whatever eventually replaces today's capture listeners) normalizes raw signals
 * into one of these before calling `recordEditingEvidence`.
 */
export type UserEditEvidenceKind =
  | "beforeinput"
  | "input"
  | "change"
  | "paste"
  | "keyboard_edit_intent"
  | "trusted_editable_interaction"
  | "explicit_value_transition";

export type UserEditEvidence = {
  kind: UserEditEvidenceKind;
};

export type OpenEditingSessionInput = {
  sessionId: string;
  owner: CaptureOwner;
  documentContext: CaptureDocumentContext;
  identity: CaptureActionIdentity;
  initialValue?: CaptureValueState;
  sensitive?: boolean;
  sourceRefs?: CaptureSourceRefs;
  technicalEvidence?: CaptureTechnicalEvidence;
  semanticEvidence?: CaptureSemanticEvidence;
  contextEvidence?: CaptureContextEvidence;
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
};

export type EditingSessionStatus = "open" | "editing" | "committed" | "cancelled";

export type EditingSessionCommitResult =
  | { status: "committed"; action: CaptureAction }
  | { status: "no_user_edit_evidence" }
  | { status: "no_change" }
  | { status: "already_committed" }
  | { status: "cancelled" }
  | { status: "document_changed" }
  | { status: "unknown_session" };

type InternalSession = {
  status: EditingSessionStatus;
  input: OpenEditingSessionInput;
  evidence: UserEditEvidence[];
  finalValue?: CaptureValueState;
};

function normalizeLiteral(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/**
 * Separates "did the user edit this" (evidence) from "what is the value now" (state): a real
 * change is either an explicit `changed` signal on the final value state (the ONLY way a
 * sensitive field with no literal can ever report a change) or a literal comparison when both
 * initial and final literals are actually present. Presence alone -- with no literal and no
 * explicit `changed` flag -- is never treated as a change.
 */
function computeChanged(initial: CaptureValueState | undefined, final: CaptureValueState | undefined): boolean {
  if (!final) return false;
  if (final.changed !== undefined) return final.changed;
  return normalizeLiteral(initial?.literal) !== normalizeLiteral(final.literal);
}

/**
 * Structural, field-name-independent identity for an owner: prefers stable technical references
 * over tag/role, and NEVER derives from a human label/accessible name.
 */
function deriveOwnerIdentity(owner: CaptureOwner): string {
  if (owner.technicalRefs && owner.technicalRefs.length > 0) return owner.technicalRefs.join("|");
  return `${owner.tag ?? "unknown"}:${owner.role ?? ""}`;
}

function buildEditAction(session: InternalSession): CaptureAction {
  const { input, finalValue } = session;
  const value = finalValue ?? input.initialValue;
  return {
    actionType: "edit",
    identity: input.identity,
    owner: input.owner,
    documentContext: input.documentContext,
    contextEvidence: input.contextEvidence,
    technicalEvidence: input.technicalEvidence,
    semanticEvidence: input.semanticEvidence,
    playwrightRecorderEvidence: input.playwrightRecorderEvidence,
    sensitive: input.sensitive,
    value,
    sourceRefs: input.sourceRefs,
    editingSession: {
      sessionId: input.sessionId,
      ownerIdentity: deriveOwnerIdentity(input.owner),
      initialState: input.initialValue ? { present: input.initialValue.present, length: input.initialValue.literal?.length } : undefined,
      changed: true,
      sensitive: input.sensitive ?? false,
      finalSemanticState: value?.present ? "present" : "empty",
    },
  };
}

export class EditingSessionManager {
  private readonly sessions = new Map<string, InternalSession>();

  openEditingSession(input: OpenEditingSessionInput): void {
    this.sessions.set(input.sessionId, { status: "open", input, evidence: [] });
  }

  /**
   * Records one piece of normalized evidence (and, optionally, the value state observed at that
   * moment). Multiple calls for the same logical edit (beforeinput, input, change, ...) coalesce
   * into the SAME session -- they never open a new one and never emit an action by themselves.
   */
  recordEditingEvidence(sessionId: string, evidence: UserEditEvidence, valueState?: CaptureValueState): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.status === "committed" || session.status === "cancelled") return;
    session.status = "editing";
    session.evidence.push(evidence);
    if (valueState) session.finalValue = valueState;
  }

  /**
   * Produces the single `CaptureAction(actionType="edit")` for this session, or an explicit
   * non-committed status -- never throws, never silently no-ops without saying why.
   *
   * `currentDocumentContext` is the document the caller believes it is in RIGHT NOW; if it
   * disagrees with the document the session was opened in, the session is cancelled and no
   * action is produced -- a session never merges across a navigation/document replacement.
   */
  commitEditingSession(sessionId: string, currentDocumentContext: CaptureDocumentContext): EditingSessionCommitResult {
    const session = this.sessions.get(sessionId);
    if (!session) return { status: "unknown_session" };
    if (session.status === "committed") return { status: "already_committed" };
    if (session.status === "cancelled") return { status: "cancelled" };

    if (session.input.documentContext.documentId !== currentDocumentContext.documentId) {
      session.status = "cancelled";
      return { status: "document_changed" };
    }

    if (session.evidence.length === 0) return { status: "no_user_edit_evidence" };
    if (!computeChanged(session.input.initialValue, session.finalValue)) return { status: "no_change" };

    const action = buildEditAction(session);
    session.status = "committed";
    return { status: "committed", action };
  }

  cancelEditingSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.status !== "committed") session.status = "cancelled";
  }
}
