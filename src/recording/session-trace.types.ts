/**
 * Shared trace schema for recorded exploration sessions (web and Android).
 *
 * A recording captures what a human actually did in the app so scenarios can be derived
 * from a real walkthrough instead of a written story. Two streams feed it: the ACTIONS
 * (what was tapped/typed) and the SCREENS observed around each action. Frames are sampled
 * only to give the AI visual context during derivation and are deleted afterwards — the
 * trace and the distilled narrative are what persist, which is what makes a recording
 * re-derivable later without keeping a video of a banking app on disk.
 *
 * The schema is deliberately identical for both platforms: normalization, derivation and
 * scenario building are then one pure pipeline with no per-platform branches.
 */

import type { PlaywrightRecorderEvidence, SemanticRuntimeEvidence } from "./structural-owner-identity";

export type RecordingPlatform = "web" | "android";

export type RecordingStatus =
  | "starting"
  | "recording"
  | "stopping"
  | "stopped"
  | "derived"
  | "failed";

export type RecordingDataPolicy = {
  persistRecordedValues: boolean;
  persistQaCredentials: boolean;
  includeQaCredentialsInTestRail: boolean;
};

export type RecordingGoal = {
  declaredGoal?: string;
  normalizedGoal?: string;
  provenance: "USER_DECLARED" | "LEGACY_LABEL";
  needsReview: boolean;
};

/** Structured constraints observed or supplied for a runtime value. */
export type RecordedValueConstraint = {
  type: string;
  uniqueWithinCollection?: boolean;
  value?: string;
  evidenceRefs?: string[];
  source?: "recording" | "runtime" | "application" | "configuration";
};

/** A locator candidate for the element an event touched, strongest first. */
export type RecordedLocator = {
  strategy: string;
  value: string;
  /** 0..1 — how reliable this strategy is for re-finding the element. */
  confidence?: number;
  /**
   * The element's own identity did not single it out on the screen it was captured on, so
   * this locator is pinned to a position among its matches. Executable, but positional: it
   * breaks if the screen reorders, which is why it is surfaced to the reviewer.
   */
  ambiguous?: boolean;
  /** 0-based position among the elements the un-pinned identity matched. */
  matchIndex?: number;
};

/** A technical target candidate learned from one observed dynamic-component lifecycle. */
export type RecordedTechnicalTarget = {
  targetType: "editable" | "selection" | "structural" | "display";
  semanticRole?: "selection" | "amount_or_text" | "editable" | "combobox";
  locatorCandidates: RecordedLocator[];
  structuralContext?: {
    gridRef?: string;
    rowRef?: string;
    cellRef?: string;
    headerRef?: string;
    containerRef?: string;
    owner?: { tag: string; role?: string };
    stableDirectAttributes?: Record<string, string>;
    stableDescendants?: Array<{
      relation: "descendant";
      tag: string;
      role?: string;
      stableAttributes: Record<string, string>;
    }>;
    semanticShape?: string[];
    /** The nearest HTML5/ARIA landmark region (nav/main/aside/header/footer, or an equivalent
     * role) the owner sits inside -- distinguishes two otherwise structurally-identical owners
     * (e.g. a sidebar link and a content-card link with the same name/href) living in different
     * parts of the same page. Never app/business-specific. */
    landmarkAncestor?: { tag: string; role?: string };
    deterministicStructuralIdentity?: boolean;
    /** Unique only after bounded, content-blind topology tie-breaking; runtime evidence, not a locator. */
    topologyTieBreakUnique?: boolean;
    /** The exact bounded, content-blind topology signature (sorted tag counts) the tie-break matched
     * at capture. Deterministic, text-free; lets the runtime matcher compare each live candidate
     * against the recorded owner instead of trusting the `topologyTieBreakUnique` boolean alone. */
    topologySignature?: string;
    identityAmbiguous?: boolean;
    structuralIdentityMatchCount?: number;
    scopeIdentity?: { strategy: "id" | "data-testid" | "css"; value: string };
    targetFingerprint?: string;
    captureScopeUnique?: boolean;
    captureTargetMatchCount?: number;
  };
  stableAttributes?: Record<string, string>;
  interactionEvidence: string[];
  lifecycleRef?: string;
  confidence: number;
  validatedByInteraction: boolean;
};

export type RecordedBounds = { x: number; y: number; width: number; height: number };

export type RecordedStateSnapshot = {
  tag?: string;
  role?: string;
  id?: string;
  name?: string;
  label?: string;
  placeholder?: string;
  value?: string;
  inputValue?: string;
  committedValue?: string;
  displayValue?: string;
  text?: string;
  aria?: Record<string, string>;
  selected?: boolean;
  bounds?: RecordedBounds;
};

export type RecordedDynamicLifecycle = {
  triggerTechnicalTarget?: string;
  activatedTechnicalTarget?: string;
  optionSurface?: RecordedStateSnapshot;
  options?: string[];
  selectedOption?: string;
  committedState?: string;
  focusTransfer?: { from?: string; to?: string };
  mutationSummary?: string[];
  observationWindowMs?: number;
  /** Redacted structural identity of the clicked owner (related-state capture, never its label text). */
  relatedStateOwnerIdentity?: string;
  /** Redacted identity of the shared local container holding owner + changed node. */
  relatedStateContainerIdentity?: string;
  /** Redacted structural mutation records observed after the trusted action (identity + kind only). */
  relatedStateMutations?: Array<{ nodeIdentity?: string; kind?: string; attributeName?: string }>;
};

/** One human editing interaction, including its raw technical evidence. */
export type RecordedEditingSession = {
  editingSessionId: string;
  controlIdentity: string;
  screenIdentity: string;
  startedAt: number;
  endedAt: number;
  rawEventRefs: string[];
  initialValue?: string;
  intermediateValues: string[];
  finalValue?: string;
  inputValue?: string;
  committedValue?: string;
  displayValue?: string;
  /** Logical value reconstructed from user input events, before any display formatting. */
  rawTypedValue?: string;
  /** Generic beforeinput/input buffer; never derived from a parent display projection. */
  logicalBuffer?: string;
  inputEventData?: string[];
  inputTypes?: string[];
  eventTargetRef?: string;
  currentTargetRef?: string;
  composedPathRefs?: string[];
  deepestEditableTargetRef?: string;
  commitReason: "change" | "blur" | "focus_transfer" | "submit" | "navigation" | "stabilization_timeout" | "recording_stop" | "observed_final_value";
  semanticField?: string;
  technicalTargetRefs: string[];
  compoundRole?: "selection" | "amount_or_text";
  needsReview?: boolean;
  reviewReason?: string;
};

export type RecordedTarget = {
  label: string;
  role?: string;
  tag?: string;
  /** Native input type when the recorder could observe it (for example, password). */
  inputType?: string;
  placeholder?: string;
  /** Small, non-sensitive DOM identity/context set captured at interaction time. */
  attributes?: Record<string, string>;
  containerContext?: string;
  headerContext?: string;
  rowContext?: string;
  /** Ranked locator candidates. The first entry is what a generated step uses. */
  locators: RecordedLocator[];
  bounds?: RecordedBounds;
  /** From the platform's `enabled` attribute — a disabled control that was tapped is a gate. */
  enabled?: boolean;
  /** True when the control holds data that must never leave the environment verbatim. */
  sensitive?: boolean;
  /** Optional semantic context captured by richer recorders; absent in legacy traces. */
  entityScope?: string;
  rowIdentity?: string;
  columnIdentity?: string;
  associatedField?: string;
  beforeValue?: string;
  afterValue?: string;
  observedOptions?: string[];
  interactionType?: "click" | "select";
  compoundRole?: "selection" | "amount_or_text";
  gridRef?: string;
  rowRef?: string;
  cellRef?: string;
  headerRef?: string;
  containerIdentity?: string;
  beforeState?: RecordedStateSnapshot;
  afterState?: RecordedStateSnapshot;
  activeElementBefore?: RecordedStateSnapshot;
  activeElementAfter?: RecordedStateSnapshot;
  stateDelta?: Record<string, string | boolean | undefined>;
  dynamicLifecycle?: RecordedDynamicLifecycle;
  editingSessionRef?: string;
  inputValue?: string;
  committedValue?: string;
  displayValue?: string;
  /** Logical value typed by the user; never derive it by stripping display separators. */
  rawTypedValue?: string;
  inputEventData?: string[];
  inputTypes?: string[];
  beforeInputValue?: string;
  afterInputValue?: string;
  eventTargetRef?: string;
  currentTargetRef?: string;
  composedPathRefs?: string[];
  deepestEditableTargetRef?: string;
  actionability?: "NATIVE_ACTIONABLE" | "SEMANTIC_ACTIONABLE" | "FRAMEWORK_ACTIONABLE" | "NON_ACTIONABLE";
  actionOwner?: boolean;
  technicalTargetCandidates?: RecordedTechnicalTarget[];
  /**
   * LAST-RESORT, EXECUTION-ONLY authority for a click whose owner/structural/related-control
   * evidence all failed: the ORIGINAL clicked target's own captured, dynamic accessible
   * name/visible text, proven unique within one or more stable technical scopes at capture, and
   * re-proven at runtime before execution. Never a technicalTarget/certified owner/locator; never
   * raises `technicalReady`/`promotionReady`. See `SemanticRuntimeEvidence`'s own doc.
   */
  semanticRuntimeEvidence?: SemanticRuntimeEvidence;
  playwrightRecorderEvidence?: PlaywrightRecorderEvidence;
  /**
   * Temporary, diagnostic-only evidence of WHY `nearestFieldGroupLabel` did or didn't resolve a
   * field owner for this target. Structure/presence only, never a typed value. Never read by any
   * admission, readiness, or execution-authority logic — purely informational, persisted here
   * only because this is the existing interaction payload/trace mechanism, not a parallel channel.
   */
  fieldOwnerDiagnostic?: FieldOwnerDiagnostic;
  /**
   * True when a CaptureEngine V2 functional `select` projection summarized THIS technical click
   * (a combobox-open or option-choose click) into one derived selection step elsewhere in the
   * trace. The event itself, its target, and its locators are never removed or altered -- this
   * only tells downstream scenario/step derivation not to ALSO render it as its own independent
   * step, so a completed selection produces one "Seleccionar" step instead of two "Presionar"
   * steps, while replay authority (both raw clicks) stays fully intact.
   */
  coveredByFunctionalSelection?: boolean;
  /**
   * On a synthesized `compoundRole: "selection"` target only: the `RecordedEvent.seq` values of
   * the technical clicks (combobox + option) this derived step summarizes -- explicit lineage so
   * a later consumer (e.g. RecordingExecutionContract/promotion) can trace the display step back
   * to its real replay-authoritative technical actions. Never itself replay authority.
   */
  sourceTechnicalEventSeqs?: number[];
};

/** One candidate interactive descendant considered while resolving a field's group label. */
export type FieldOwnerDiagnosticCandidateField = {
  tagName: string;
  type?: string;
  role?: string;
  visible: boolean;
  disabled: boolean;
  idPresent: boolean;
  namePresent: boolean;
  ariaLabelPresent: boolean;
  placeholderPresent: boolean;
};

/** One candidate label-like element considered while resolving a field's group label. */
export type FieldOwnerDiagnosticCandidateLabel = {
  tagName: string;
  sourceType: "label" | "class-label";
  /** The label's own caption text, bounded to 80 chars — never the field's typed value. */
  textSummary: string;
};

/** One ancestor level inspected by `nearestFieldGroupLabel`. */
export type FieldOwnerDiagnosticAncestor = {
  ancestorLevel: number;
  tagName: string;
  role?: string;
  idPresent: boolean;
  classSummary: string;
  candidateFieldCount: number;
  candidateFields: FieldOwnerDiagnosticCandidateField[];
  /** Raw count, INCLUDING semantically-empty label-like elements — diagnosis only. */
  candidateLabelCount: number;
  candidateLabels: FieldOwnerDiagnosticCandidateLabel[];
  /** The count actually used for the ambiguity decision: candidates with a non-empty caption. */
  semanticCandidateLabelCount?: number;
  rejectionReason?: string;
};

/** Diagnostic-only trace of `nearestFieldGroupLabel`'s field-owner resolution attempt. */
export type FieldOwnerDiagnostic =
  | { result: "unresolved"; trace: FieldOwnerDiagnosticAncestor[] }
  | { result: "resolved"; chosenOwnerSource: string; chosenAncestorLevel: number };

export type RecordedEventKind =
  | "launch"
  | "tap"
  | "fill"
  | "navigate"
  | "back"
  | "swipe"
  | "screen_change"
  | "note"
  /** A discrete, non-textual command key (e.g. "Enter") -- its own technical action, never a click. */
  | "press";

export type RecordedEvent = {
  seq: number;
  interactionId?: string;
  /** Milliseconds since the recording started. */
  t: number;
  kind: RecordedEventKind;
  /** Screen the event happened ON (before any transition it caused). */
  screenKey: string;
  fingerprint?: string;
  target?: RecordedTarget;
  /** Typed text. Replaced by `redactedKey` when the field is sensitive. */
  value?: string;
  redactedKey?: string;
  /** Web only. */
  url?: string;
  /** For `screen_change`: where the app landed. */
  toScreenKey?: string;
  /** Ephemeral frame captured for this event. Cleared once derivation consumes it. */
  framePath?: string;
  note?: string;
  valueSource?: "user" | "application";
  dependsOnEventRef?: string;
  observationType?: "focus" | "dom_mutation" | "post_action" | "before_input" | "pointer" | "technical_noise";
};

export type RecordedControl = {
  label: string;
  role?: string;
  tag?: string;
  placeholder?: string;
  attributes?: Record<string, string>;
  containerContext?: string;
  headerContext?: string;
  rowContext?: string;
  rowIdentity?: string;
  columnIdentity?: string;
  associatedField?: string;
  locators: RecordedLocator[];
  enabled?: boolean;
  bounds?: RecordedBounds;
  gridRef?: string;
  rowRef?: string;
  cellRef?: string;
  headerRef?: string;
  containerIdentity?: string;
  inputValue?: string;
  committedValue?: string;
  displayValue?: string;
};

export type RecordedScreen = {
  screenKey: string;
  title: string;
  fingerprint: string;
  url?: string;
  /** Milliseconds since recording start. */
  firstSeenAt: number;
  controls: RecordedControl[];
  /** Visible non-interactive text — the raw material for assertions. */
  texts: string[];
  headerRelationships?: Array<{ header: string; field: string }>;
  gridMetadata?: {
    detected: boolean;
    grids?: number;
    rows: number;
    cells: number;
    headers: string[];
    headerRelationships: Array<{ header: string; field: string }>;
  };
};

/** A contiguous run of events on one screen, after normalization. */
export type TraceSegment = {
  index: number;
  screenKey: string;
  title: string;
  events: RecordedEvent[];
  /** Screen the segment exits to, when it transitions. */
  exitsTo?: string;
};

export type SessionTrace = {
  recordingId: string;
  /** Project the recording belongs to — the app under test comes from its configuration. */
  projectSlug: string;
  appSlug: string;
  platform: RecordingPlatform;
  appPackage?: string;
  baseUrl?: string;
  label?: string;
  recordingGoal?: RecordingGoal;
  recordingDataPolicy?: RecordingDataPolicy;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  status: RecordingStatus;
  events: RecordedEvent[];
  screens: RecordedScreen[];
  /** Step-by-step distilled from frames + events. Survives frame deletion. */
  narrative?: string;
  /** Set when the recording ended abnormally. */
  errorMessage?: string;
  /**
   * Which capture engine actually produced this recording's events -- an explicit property of
   * THIS session, requested at start time, never inferred from project/app/environment.
   * Diagnostic only: absent (legacy recordings) is equivalent to `"legacy"`.
   */
  captureAuthority?: "legacy" | "v2";
};

/** Summary shape returned by list/status endpoints — never carries the full event array. */
export type RecordingSummary = {
  recordingId: string;
  projectSlug: string;
  appSlug: string;
  platform: RecordingPlatform;
  label?: string;
  status: RecordingStatus;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  eventCount: number;
  screenCount: number;
  actionCount: number;
  hasNarrative: boolean;
  scenarioCount: number;
  recordingGoal?: string;
  errorMessage?: string;
};
