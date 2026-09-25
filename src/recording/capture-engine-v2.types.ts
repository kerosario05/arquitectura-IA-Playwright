import type { FieldOwnerDiagnostic, RecordedTechnicalTarget } from "./session-trace.types";
import type { StructuralOwnerIdentity, SemanticRuntimeEvidence, PlaywrightRecorderEvidence } from "./structural-owner-identity";

/**
 * CaptureEngine V2 -- internal model only, NOT wired into `WebSessionRecorder` yet.
 *
 * Goal: represent a captured interaction independently of how it was captured (DOM listeners
 * today, something else tomorrow), then adapt it DOWN into the CURRENT, locked
 * `RawInteraction` shape (see `raw-interaction-adapter.ts`) so everything from `onInteraction`
 * downward (trace, canonical interactions, runtime dataset, execution contract, resolver, spec
 * generation, TestRail) keeps working completely unchanged.
 *
 * `"diagnostic"` is intentionally its own `CaptureActionType`, distinct from `"click"`/`"edit"`/
 * `"submit"`: a diagnostic/control message must never be silently promoted into a functional
 * action by the adapter, even if it happens to carry click- or edit-shaped fields.
 *
 * `CaptureAction` is the TECHNICAL, Playwright-like stream: every physical click/edit/submit the
 * user actually performed, preserved one-to-one, replayable, and never collapsed for semantic
 * convenience. A custom combobox's two clicks (owner, then option) are both `"click"`
 * `CaptureAction`s -- there is no `"select"` here. Semantic grouping (e.g. "Seleccionar X en
 * Y") lives one layer up, in `CaptureFunctionalAction`, which is derived FROM this stream and
 * never replaces or removes any of it. See `capture-engine-v2.selection-session-manager.ts`.
 *
 * `"press"` is also a TECHNICAL action, not semantic: a discrete, non-textual command key (e.g.
 * "Enter") the user pressed on its own editable/actionable owner. It exists precisely so a
 * synthetic click a browser/framework fires as a SIDE EFFECT of that key (e.g. Enter submitting
 * a form) is never mistaken for -- or recorded as -- a second, independent click authority.
 */
export type CaptureActionType = "edit" | "click" | "submit" | "observation" | "diagnostic" | "press";

/** Identity fields an action carries for locator-building -- mirrors what `RawInteraction` accepts. */
export type CaptureActionIdentity = {
  label?: string;
  tagName?: string;
  role?: string;
  inputType?: string;
  domId?: string;
  testId?: string;
  ariaLabel?: string;
  name?: string;
  text?: string;
  placeholder?: string;
};

/** Structural/container evidence already representable on the current contract (containerContext etc). */
export type CaptureContextEvidence = {
  containerContext?: string;
  headerContext?: string;
  rowContext?: string;
};

export type CaptureOwnerClassification = "actionable" | "editable" | "non_actionable";

/** The element judged responsible for an action -- distinct from whatever raw pointer/DOM node dispatched it. */
export type CaptureOwner = {
  tag?: string;
  role?: string;
  classification?: CaptureOwnerClassification;
  /** Stable technical references to the owner (ids, structural refs) -- not locator strategies themselves. */
  technicalRefs?: string[];
  /** The field/group this owner was resolved to belong to, when field-owner resolution ran. */
  associatedField?: string;
  /** Free-form evidence of the group/container the owner resolution considered, diagnostic only. */
  groupEvidence?: string;
  /** From the platform's `disabled` attribute. Never used to decide execution readiness here. */
  disabled?: boolean;
  accessibleName?: string;
  /** A role-name authority only when Capture V2 proved it is safe for exact Playwright role replay. */
  technicalRoleName?: string;
  /** Explicit false prevents a functional label from being promoted into a role locator. */
  roleTechnicalIdentityEligible?: boolean;
  /**
   * Structural/container evidence (stable attributes, descendants, semantic shape, landmark
   * ancestor, cross-page match count) captured at the SAME moment the owner was resolved --
   * never reconstructed later from a display label or runtime clustering. Absent when the
   * browser instrumentation did not compute it (e.g. a non-actionable/non-editable candidate).
   */
  structuralIdentity?: StructuralOwnerIdentity;
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
};

/**
 * One node along the raw pointer/event target's ancestor chain (its "composed path"), already
 * reduced to the structural facts `resolveCaptureOwner` needs -- never a live DOM/Playwright
 * handle. `pathDepth` is the node's position in that ancestor chain: 0 is the raw event target
 * itself, increasing values walk outward toward the document root.
 */
export type CaptureOwnerCandidate = {
  tag: string;
  role?: string;
  /** input/textarea/select/contenteditable/role=textbox/editable combobox. */
  editable: boolean;
  /** button/link/checkbox/radio/option/menuitem/role=button-like, or an equivalent framework control. */
  actionable: boolean;
  disabled?: boolean;
  visible?: boolean;
  technicalRefs?: string[];
  accessibleName?: string;
  technicalRoleName?: string;
  roleTechnicalIdentityEligible?: boolean;
  associatedField?: string;
  groupEvidence?: string;
  /** Whether this candidate came from a browser event with trusted physical provenance. */
  trustedClick?: boolean;
  /** Diagnostic-only result of the shared framework-actionability contract for this exact node. */
  frameworkActionable?: boolean;
  /** Whether this same node has a durable identity that could support a future framework owner decision. */
  frameworkIdentitySufficient?: boolean;
  /** Same structural evidence as `CaptureOwner.structuralIdentity`, computed for THIS candidate
   * specifically -- carried through untouched by `resolveCaptureOwner` onto whichever candidate
   * it picks as the owner. */
  structuralIdentity?: StructuralOwnerIdentity;
  /**
   * Present ONLY when THIS candidate itself carries a durable, page-wide-checkable identity
   * (its own id/data-testid) usable as a scope boundary. Unlike `structuralIdentity` (which
   * describes THIS candidate's own fingerprint), this describes the ORIGINAL, raw clicked
   * event target's fingerprint/match count, computed with THIS candidate's own element as the
   * scope root -- scope and target proof are therefore guaranteed to come from the exact same
   * boundary, never combined post-hoc from two different candidates' independently-scoped
   * identities. `scopeIdentity`/`captureScopeUnique` here describe THIS candidate's own
   * identity (never an ancestor further up); `targetFingerprint`/`*MatchCount`/
   * `deterministicStructuralIdentity` always describe the ORIGINAL clicked target, never this
   * candidate itself.
   */
  scopeBoundOriginalTargetIdentity?: StructuralOwnerIdentity;
  /**
   * LAST-RESORT, EXECUTION-ONLY: present only on the ORIGINAL clicked target's own candidate
   * (pathDepth 0), aggregated from every scope-bound ancestor that independently proved the
   * target's own accessible name/visible text uniquely matches it within that ancestor's scope.
   * See `SemanticRuntimeEvidence`'s own doc for the full contract and its constraints.
   */
  semanticRuntimeEvidence?: SemanticRuntimeEvidence;
  /** Structured recorder intent; execution-only and always runtime-revalidated. */
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
  pathDepth: number;
};

/** A capture-time identity for the document/navigation instance an action happened in. */
export type CaptureDocumentContext = {
  /** Identifies one `WebSessionRecorder`/CaptureEngine run, independent of any single document. */
  captureInstanceId: string;
  /** Identifies the specific document (pre/post navigation) the action was observed in. */
  documentId: string;
  /** Stable identity of the Playwright Frame that owns this document for this capture run. */
  frameId?: string;
  /** Monotonic count of navigations/document-replacements observed so far in this capture instance. */
  navigationVersion?: number;
};

/** Lifecycle stage of one captured document. Only `"ready"` may accept functional CaptureActions. */
export type DocumentLifecycleState = "installing" | "ready" | "retired" | "failed";

/** A tracked document, as `DocumentLifecycle` sees it -- `CaptureDocumentContext` plus lifecycle bookkeeping. */
export type CaptureDocumentRecord = CaptureDocumentContext & {
  navigationVersion: number;
  /** Monotonically increasing across the whole capture instance -- never reused, never app-derived. */
  generation: number;
  state: DocumentLifecycleState;
  failureReason?: string;
};

export type CaptureTechnicalEvidence = {
  candidates?: RecordedTechnicalTarget[];
};

export type CaptureSemanticEvidence = {
  fieldOwnerDiagnostic?: FieldOwnerDiagnostic;
};

/**
 * Whether a value is present/changed, WITHOUT requiring the literal.
 *
 * `literal` stays optional on purpose: a sensitive edit can be fully represented as
 * `{ present: true, changed: true }` with no `literal` at all. Whether the literal ever reaches
 * the persisted trace remains entirely the current, unchanged `onInteraction`/`valueOf` policy --
 * V2 never mandates it.
 */
export type CaptureValueState = {
  present: boolean;
  changed?: boolean;
  literal?: string;
};

export type CaptureSourceRefs = {
  eventTargetRef?: string;
  currentTargetRef?: string;
  composedPathRefs?: string[];
  deepestEditableTargetRef?: string;
};

/**
 * An open/closed editing session, tracked independently of whether native `input`/`change`
 * events were observed. Mirrors the concept `web-session-recorder.ts` already tracks internally
 * (`openEditingSessionFor`/`flushEditingSession`), generalized so a future capture engine can
 * represent the same lifecycle without being DOM-event-shaped.
 *
 * GAP (documented, not fixed here): the current `RawInteraction` contract has no field to carry
 * `sessionId` across to `RecordedTarget.editingSessionRef` -- the adapter omits it, per this
 * ticket's own "no ampliar RawInteraction todavía" instruction. See `raw-interaction-adapter.ts`.
 */
export type CaptureEditingSession = {
  sessionId: string;
  ownerIdentity: string;
  initialState?: { present: boolean; length?: number };
  changed: boolean;
  sensitive: boolean;
  finalSemanticState?: "empty" | "present" | "unchanged";
};

/** One TECHNICAL interaction, exactly as physically performed -- the Playwright-like, replayable stream. */
export type CaptureAction = {
  actionType: CaptureActionType;
  interactionId?: string;
  observationType?: "pointer";
  identity: CaptureActionIdentity;
  owner?: CaptureOwner;
  documentContext?: CaptureDocumentContext;
  contextEvidence?: CaptureContextEvidence;
  technicalEvidence?: CaptureTechnicalEvidence;
  semanticEvidence?: CaptureSemanticEvidence;
  /**
   * LAST-RESORT, EXECUTION-ONLY authority (never a certified owner/technicalEvidence/locator) --
   * present only when the click's owner/structural/related-control authorities all failed and a
   * `SemanticRuntimeEvidence` was captured for the raw, still-unresolved target. See its own doc.
   */
  semanticRuntimeEvidence?: SemanticRuntimeEvidence;
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
  sensitive?: boolean;
  value?: CaptureValueState;
  sourceRefs?: CaptureSourceRefs;
  editingSession?: CaptureEditingSession;
  /** Only present when `actionType === "press"` -- the discrete command key (e.g. "Enter"). */
  key?: string;
};

/**
 * Evidence a selected OPTION contributes to a logical selection -- never the authority for
 * owner identity. The functional owner of a `"select"` `CaptureFunctionalAction` is always the
 * combobox that opened the session (`CaptureFunctionalAction.owner`), never the option.
 */
export type CaptureSelectionEvidence = {
  selectedValue?: string;
  selectedDisplay?: string;
  /** The option's own owner (tag/role/technicalRefs), preserved separately -- never merged into `owner`. */
  optionOwner?: CaptureOwner;
  optionTechnicalEvidence?: CaptureTechnicalEvidence;
};

/**
 * Semantic/functional grouping types. Distinct from `CaptureActionType` on purpose: a
 * functional projection is DERIVED from the technical `CaptureAction` stream and must never be
 * mistaken for -- or replace -- technical capture authority.
 */
export type CaptureFunctionalActionType = "select";

/**
 * A semantic projection over one or more technical `CaptureAction`s (e.g. two clicks -- a
 * combobox owner and an option -- collapsed into one logical selection for presentation). Always
 * derived, never authoritative for replay: `sourceTechnicalActionSeqs` is what lets it be traced
 * back to the exact technical actions it summarizes, so producing/dropping a functional
 * projection can never affect what the technical stream itself preserves.
 */
export type CaptureFunctionalAction = {
  functionalActionType: CaptureFunctionalActionType;
  identity: CaptureActionIdentity;
  owner?: CaptureOwner;
  documentContext?: CaptureDocumentContext;
  sourceRefs?: CaptureSourceRefs;
  /** The technical CaptureAction seq(s) (from the bridge's technicalActions store) this projection summarizes. */
  sourceTechnicalActionSeqs: number[];
  selectionEvidence: CaptureSelectionEvidence;
};
