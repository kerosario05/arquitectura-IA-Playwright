import type { RecordedEvent, RecordedTarget, RecordedEditingSession, RecordedValueConstraint } from "./session-trace.types";
import type {
  RecordedDataField,
  RecordedScenario,
  RecordedScenarioStep,
  RecordedWebStep,
} from "./trace-to-scenario";
import type { SemanticRecordingModel } from "./semantic-recording";
import type { McpScenario, RecordingExecutionAction, RecordingExecutionContract } from "../scenarios/scenario-types";
import { confirmedCompoundSelectionBefore, logicalCompoundChildValue } from "./compound-value";
import { renderHumanStepValue } from "./human-step-renderer";
import { preserveCapturedTechnicalTargetLocators } from "./technical-target-transport";
import { isTechnicalIdentityAdmissible, isGenericUnresolvedLabel } from "./trace-normalizer";
import { semanticIdentityFromFrameworkOwnerEvidence } from "./framework-owner-semantic-identity";

export type CanonicalInteractionAction =
  | "fill"
  | "select"
  | "click"
  | "check"
  | "uncheck"
  | "press"
  | "navigation"
  | "system_observation";

/** Evidence-backed ownership of the application state in which an interaction is valid. */
export type InteractionStateOwnership = {
  screenBeforeRef?: string;
  screenAfterRef?: string;
  routeBefore?: string;
  routeAfter?: string;
  containerRef?: string;
  gridRef?: string;
  stateScope?: string;
  transitionObserved?: boolean;
  causedTransition?: boolean;
  terminalForContext?: boolean;
  /** A state may end without ending the recording. This flag is never inferred from a state change. */
  terminalForScenario?: boolean;
  goalRelevant?: boolean;
  postGoalObservation?: boolean;
  postTerminalAction?: boolean;
  technicalOnly?: boolean;
  /**
   * Overrides the default "technicalOnly means excluded from execution too" assumption.
   * `technicalOnly` alone means "hidden from the human-facing FUNCTIONAL step list" (consumed by
   * trace-to-scenario.ts) -- it never, on its own, meant "not real replay authority". Most
   * technicalOnly interactions (navigation reachability bridges, a derived/synthetic display
   * click) genuinely are not independent executable actions, so the default (this field absent)
   * still excludes them from `executableInteractions`/`RecordingExecutionContract`, unchanged.
   * `true` force-includes a technicalOnly interaction in execution anyway -- for a technical click
   * that IS real, independently replayable authority merely hidden from display (e.g. the raw
   * combobox/option clicks a functional `select` projection summarizes for presentation only).
   * `false` force-EXCLUDES a NON-technicalOnly interaction from execution -- for a display-only
   * projection (identified generically by carrying `target.sourceTechnicalEventSeqs`, never a
   * selection-specific check) that must still be visible as its own human step but must never
   * itself become "the" executable action, since it was never captured against a real DOM target.
   */
  executionAuthority?: boolean;
  /**
   * True when this interaction is the first action on a new surface (its screenKey differs
   * from the previous interaction's) and its field/owner identity could not be corroborated by
   * structural evidence captured on ITS OWN target — only by an ancestor-walk-derived
   * header/label, the signal vulnerable to still reflecting the previous surface's DOM for a
   * brief window after a transition. semanticField/description are withheld rather than
   * trusted in this case; the raw target/label evidence is still preserved for diagnosis.
   */
  ownerRecertificationRequired?: boolean;
  /**
   * The admission gate's structured outcome. Absent (or "accepted") means the interaction's
   * technical identity is trusted as executable authority. "unresolved" means it is not —
   * semanticField/description are withheld and the interaction must never be presented
   * downstream as a valid target, though its raw target/label evidence is preserved for
   * diagnosis. Single source of truth: see `isTechnicalIdentityAdmissible`/
   * `isGenericUnresolvedLabel` in trace-normalizer.ts, also consumed by semantic field
   * resolution (semantic-recording.ts) and trace normalization/rendering.
   */
  admissionStatus?: "accepted" | "unresolved";
  admissionReason?: string;
  /**
   * Recording Replay's runtime-resolution admission state — never execution authority on its
   * own. "certified" mirrors admissionStatus="accepted". "runtime_resolution_required" means
   * admission rejected the recorded field/owner identity, but real structured evidence (a
   * recorded value plus its own technical target evidence, a genuine structural field name, or
   * a captured field-owner diagnostic attempt) exists, so the EXISTING runtime/MCP resolver
   * (resolveActionTarget) may still attempt to re-locate and verify the target live rather than
   * the scenario being blocked outright. "unresolved_unrecoverable" means no such evidence
   * exists (e.g. a bare structural fallback or generic label alone) and the interaction must
   * stay blocked. Absent means the same as "certified" for any pre-existing interaction that
   * predates this field.
   */
  resolutionState?: "certified" | "runtime_resolution_required" | "unresolved_unrecoverable";
};

export type CanonicalInteraction = InteractionStateOwnership & {
  id: string;
  controlIdentity: string;
  semanticField?: string;
  entityScope?: string;
  rowRelation?: "next" | "added";
  action: CanonicalInteractionAction;
  valueKey?: string;
  recordedValue?: string;
  /** The discrete command key a `"press"` action sends (e.g. "Enter"). Absent for every other action type. */
  key?: string;
  rawTypedValue?: string;
  committedValue?: string;
  displayValue?: string;
  selectorControlId?: string;
  optionSurfaceId?: string;
  observedOptions?: string[];
  technicalTargetCandidates?: import("./session-trace.types").RecordedTechnicalTarget[];
  /** LAST-RESORT, EXECUTION-ONLY authority; never a technicalTarget/certified owner. See its own doc. */
  semanticRuntimeEvidence?: import("./structural-owner-identity").SemanticRuntimeEvidence;
  playwrightRecorderEvidence?: import("./structural-owner-identity").PlaywrightRecorderEvidence;
  validatedByInteraction?: boolean;
  sourceEventRefs: string[];
  technicalTargetRefs: string[];
  editingSessionRef?: string;
  description?: string;
  /**
   * Diagnostic/state-observation ONLY (never execution/field/readiness/promotion authority). A
   * redacted, structurally-identified surface that was CAUSALLY mutated by this trusted action,
   * separate from `associatedField` (which remains field-relation authority). Captured at recording
   * time from the existing mutation observation; never carries a value.
   */
  relatedStateSurfaceEvidence?: RelatedStateSurfaceEvidence;
  confidence: number;
};

/**
 * A related state-bearing surface, observed DURING recording as causally changed by a trusted
 * click (a keypad/stepper display, a counter, a selection-updated display). This is intentionally
 * NOT `associatedField`: it has no field/execution/readiness/promotion authority and only names a
 * structural relation between the clicked owner and a distinct, locally-related node that mutated.
 * Fields are redacted (identity + kind only, never the value).
 */
export type RelatedStateSurfaceEvidence = {
  /** The trusted source interaction this evidence belongs to. */
  sourceInteractionId: string;
  /** Redacted structural identity of the clicked owner (never the owner's label text). */
  sourceOwnerIdentity: string;
  /** How the changed node relates to the clicked owner. */
  relationKind: "local_container" | "accepted_field_scope" | "aria_ownership" | "common_control_group";
  /** Redacted structural identity of the mutated node (never its text/value). */
  changedNodeIdentity: string;
  /** Structural mutation kinds observed (attribute/characterData/childList), never values. */
  changeKinds: string[];
  /** Redacted identity of the shared local container that holds both owner and changed node. */
  containerIdentity?: string;
  certificationKind: "causal_local_mutation";
};

/** One redacted mutation record the recorder already observed (identity + kind, never the value). */
export type RelatedStateMutationRecord = {
  nodeIdentity: string;
  kind: string;
  attributeName?: string;
};

/**
 * CORE, fail-closed derivation of a related state surface from the recorder's existing mutation
 * observation. A surface is certified ONLY when exactly one distinct node (never the clicked owner,
 * never a document-level node) changed. Zero changes -> undefined; multiple distinct changed nodes
 * -> undefined (ambiguous, never first/nth/order). Never consults text, position, or values.
 */
export function deriveRelatedStateSurfaceEvidence(
  input: {
    sourceInteractionId: string;
    sourceOwnerIdentity: string;
    relationKind: RelatedStateSurfaceEvidence["relationKind"];
    containerIdentity?: string;
    mutations: readonly RelatedStateMutationRecord[];
  },
): RelatedStateSurfaceEvidence | undefined {
  const related = input.mutations.filter((mutation) => mutation.nodeIdentity && mutation.nodeIdentity !== input.sourceOwnerIdentity);
  const changedNodes = new Set<string>();
  const changeKinds = new Set<string>();
  for (const mutation of related) {
    if (mutation.nodeIdentity === "document" || mutation.nodeIdentity === "body" || mutation.nodeIdentity === "html") continue;
    changedNodes.add(mutation.nodeIdentity);
    changeKinds.add(mutation.kind);
  }
  if (changedNodes.size !== 1) return undefined;
  const changedNodeIdentity = [...changedNodes][0];
  return {
    sourceInteractionId: input.sourceInteractionId,
    sourceOwnerIdentity: input.sourceOwnerIdentity,
    relationKind: input.relationKind,
    changedNodeIdentity,
    changeKinds: [...changeKinds],
    ...(input.containerIdentity ? { containerIdentity: input.containerIdentity } : {}),
    certificationKind: "causal_local_mutation",
  };
}

export type RuntimeInputRequirement = {
  valueKey: string;
  semanticField: string | null;
  entityScope?: string;
  valueRole: "action_input" | "secure_input" | "runtime_derived_oracle";
  required: boolean;
  value: string | null;
  source:
    | "RECORDED_CONFIRMED"
    | "CURRENT_QA_EDIT"
    /** Legacy persisted spelling; new writes use CURRENT_QA_EDIT. */
    | "QA_EDIT"
    | "secure"
    | "confirmed_dataset"
    | "project_config"
    | "unresolved";
  resolved: boolean;
  sensitive?: boolean;
  stepIndex?: number;
  controlType?: string;
  constraints?: RecordedValueConstraint[];
  allowedValues?: string[];
  technicalTargetRefs?: string[];
  sourceEventRefs?: string[];
  validatedByInteraction?: boolean;
  readOnly?: boolean;
  /** Explicit renderer metadata. Presence of a value must never imply read-only. */
  computed?: boolean;
  systemGenerated?: boolean;
  /** Sensitive business inputs remain editable but are rendered masked. */
  masked?: boolean;
  /** A required unresolved runtime value may be supplied by the QA runtime editor. */
  editable?: boolean;
  /** Authority selected while materializing the runtime dataset. */
  authority?: "explicit_qa_edit" | "canonical_logical" | "canonical_committed" | "recorded_confirmed" | "unresolved";
  /** Canonical value retained for a generic dataset-authority compatibility gate. */
  authorityValue?: string | null;
  datasetAuthorityMismatch?: boolean;
  /** Lineage retained when a derived scenario receives a value from its primary entity. */
  sourceValueKey?: string;
  sourceAuthority?: "CLONED_CONFIRMED_VALUE" | "EXPLICIT_MUTATION" | "SYSTEM_GENERATED" | "UNRESOLVED";
  repeatCloneDisposition?: RepeatFieldCloneDisposition;
};

export type ScenarioRuntimeDataset = {
  scenarioId: string;
  requirements: RuntimeInputRequirement[];
  resolvedValues: Record<string, string>;
  missingValues: RuntimeInputRequirement[];
};

export function isQaOverridableRuntimeInput(
  requirement: Pick<RuntimeInputRequirement, "valueRole" | "readOnly" | "computed" | "systemGenerated" | "sourceAuthority" | "repeatCloneDisposition">,
): boolean {
  return requirement.valueRole !== "runtime_derived_oracle"
    && requirement.readOnly !== true
    && requirement.computed !== true
    && requirement.systemGenerated !== true
    && requirement.sourceAuthority !== "SYSTEM_GENERATED"
    && requirement.repeatCloneDisposition !== "SYSTEM_GENERATED";
}

function isQaEditSource(source: RuntimeInputRequirement["source"] | undefined): boolean {
  return source === "CURRENT_QA_EDIT" || source === "QA_EDIT";
}

export type RecordingReadiness = {
  functionalReadiness: boolean;
  dataReadiness: boolean;
  technicalReadiness: boolean;
  oracleReadiness: boolean;
  reviewReadiness: boolean;
  publicationContentReadiness: boolean;
  executionReadiness: boolean;
  publicationReadiness: boolean;
  missingInputs: RuntimeInputRequirement[];
  datasetAuthorityMismatches: RuntimeInputRequirement[];
  dataReadinessReasons: string[];
};

export type EntityActionBlock = {
  entityType?: string;
  entityScope: string;
  semanticActions: CanonicalInteraction[];
  dataRequirements: RuntimeInputRequirement[];
  runtimeDerivedOracles: RuntimeInputRequirement[];
  technicalKnowledgeRefs: string[];
};

/** Assigns runtime ordering at the structured-contract boundary. */
export function normalizeRecordingExecutionActionIndices(
  actions: readonly RecordingExecutionAction[],
): RecordingExecutionAction[] {
  return actions.map((action, index) => ({ ...action, stepIndex: index + 1 }));
}

export type MutationType =
  | "REPEAT_ENTITY"
  | "ZERO_ENTITY"
  | "FIELD_OMISSION"
  | "ALTERNATIVE_SELECTION"
  | "VALUE_VARIANT"
  | "BOUNDARY"
  | "CONSTRAINT_VALIDATION";

export type MutationOperation =
  | { type: "insert_action"; action: CanonicalInteraction; afterInteractionId?: string }
  | { type: "clone_entity"; sourceEntityScope: string; targetEntityScope: string }
  | { type: "remove_entity"; entityScope: string }
  | { type: "remove_action"; interactionId: string }
  | { type: "replace_selection"; interactionId: string; value: string };

export type MutationEffectDiagnostics = {
  materializedSemanticSignature: string;
  primarySemanticSignature: string;
  stepsAdded: number;
  stepsRemoved: number;
  stepsReplaced: number;
  entityScopesAdded: string[];
  valueKeysAdded: string[];
  valueKeysRemoved: string[];
  rejectionReason?: "MUTATION_NO_EFFECT" | "MUTATION_PRECONDITION_INVALID" | "MUTATION_PRECONDITION_UNKNOWN" | "RUNTIME_DATA_CONSTRAINT_VIOLATION";
  mutationPreconditionValidity?: MutationPreconditionValidity;
};

export type MutationPreconditionValidity = {
  status: "valid" | "invalid" | "unknown";
  checkedValueKeys: string[];
  invalidValueKeys: string[];
  reasons: string[];
};

export type NegativeScenarioOracle = {
  kind: "negative";
  source: "mutation_precondition_graph" | "runtime_observation";
  expectedState: {
    entityCount: number;
    canSubmit: boolean;
  };
  terminalActionApplicable: boolean;
};

export type ConstraintResolution = {
  valueKey: string;
  constraintType: string;
  activeValueCount: number;
  candidateCount: number;
  distinctCandidateCount: number;
  resolutionSource: "allowed_values" | "runtime_dataset" | "recorded_confirmed" | "none";
  resolved: boolean;
};

export function evaluateNegativeScenarioOracle(
  oracle: NegativeScenarioOracle,
  observation: { entityCount?: number; canSubmit?: boolean; terminalActionApplicable?: boolean },
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (observation.entityCount !== undefined && observation.entityCount !== oracle.expectedState.entityCount) {
    reasons.push("entity_count_mismatch");
  }
  if (observation.canSubmit !== undefined && observation.canSubmit !== oracle.expectedState.canSubmit) {
    reasons.push("submit_capability_mismatch");
  }
  if (observation.terminalActionApplicable !== undefined
    && observation.terminalActionApplicable !== oracle.terminalActionApplicable) {
    reasons.push("terminal_action_applicability_mismatch");
  }
  return { valid: reasons.length === 0, reasons };
}

export type ScenarioMutationProposal = {
  opportunityId?: string;
  title: string;
  mutationType: MutationType;
  basePrimaryScenarioId: string;
  operations: MutationOperation[];
  evidenceRefs: string[];
  rationale: string;
  oracleAuthority: "OBSERVED" | "MISSING" | "CONSTRAINT_BACKED";
  expectedResultCandidate?: string;
  confidence: number;
  needsReview: boolean;
};

export type MutationOpportunity = ScenarioMutationProposal & { opportunityId: string };

export type RepeatFieldCloneDisposition =
  | "CLONE_SAME_VALUE"
  | "REQUIRE_NEW_VALUE"
  | "DERIVE_FROM_ALLOWED_SOURCE"
  | "SYSTEM_GENERATED"
  | "NOT_APPLICABLE";

export type RecordedScenarioContract = {
  canonicalInteractions: CanonicalInteraction[];
  entityActionBlocks: EntityActionBlock[];
  runtimeInputRequirements: RuntimeInputRequirement[];
  readiness: RecordingReadiness;
  technicalKnowledgeRefs: string[];
  mutationOpportunities: MutationOpportunity[];
};

/**
 * Rehydrates persisted canonical interactions with the semantic editing session that owns
 * their final value. This is a read-model migration: the trace and its capture events are
 * untouched, while old scenario JSON can still consume the same canonical authority as a
 * newly-derived scenario.
 */
export function hydrateCanonicalInteractionsFromSemanticModel(
  scenario: RecordedScenario,
  model: Pick<SemanticRecordingModel, "editingSessions" | "canonicalInteractions">,
): RecordedScenario {
  const persistedInteractions = scenario.canonicalInteractions;
  if (!persistedInteractions?.length) return scenario;
  const canonicalInteractions = persistedInteractions.map((interaction) => {
    if (interaction.action !== "fill") return interaction;
    const session = model.editingSessions.find((candidate) => candidate.editingSessionId === interaction.editingSessionRef)
      ?? model.editingSessions.find((candidate) => candidate.semanticField === interaction.semanticField
        && candidate.compoundRole === "amount_or_text")
      ?? model.editingSessions.find((candidate) => interaction.sourceEventRefs.some((ref) => candidate.rawEventRefs.includes(ref)));
    const value = clean(session?.finalValue) ?? clean(session?.committedValue);
    const selection = persistedInteractions.find((candidate) => candidate.action === "select"
      && candidate.entityScope === interaction.entityScope
      && candidate.semanticField === interaction.semanticField
      && clean(candidate.recordedValue));
    const logicalValue = logicalCompoundChildValue(value, selection?.recordedValue)
      ?? (value === clean(selection?.recordedValue) ? undefined : value);
    return logicalValue === undefined ? interaction : { ...interaction, recordedValue: logicalValue };
  });
  // Older persisted projections could retain the trigger click while losing a
  // portalized option note during materialization. Rehydrate only the missing
  // canonical selection from the current semantic model; mutation-specific
  // interactions and their original IDs remain untouched.
  const missingSelections = scenario.mutation?.mutationType === "ALTERNATIVE_SELECTION"
    ? []
    : (model.canonicalInteractions ?? []).filter((candidate) =>
    candidate.action === "select"
      && typeof candidate.recordedValue === "string"
      && !canonicalInteractions.some((existing) => existing.action === "select"
        && existing.entityScope === candidate.entityScope
        && existing.semanticField === candidate.semanticField
        && existing.recordedValue === candidate.recordedValue),
    );
  for (const selection of missingSelections) {
    const triggerIndex = canonicalInteractions.findIndex((interaction) =>
      interaction.entityScope === selection.entityScope
        && interaction.semanticField === selection.semanticField
        && ["click", "check", "uncheck"].includes(interaction.action),
    );
    const nextInteractionIndex = canonicalInteractions.findIndex((interaction) =>
      interaction.entityScope === selection.entityScope
        && triggerIndex >= 0
        && canonicalInteractions.indexOf(interaction) > triggerIndex
        && (interaction.action === "fill" || interaction.action === "select"),
    );
    const insertionIndex = nextInteractionIndex >= 0 ? nextInteractionIndex : triggerIndex >= 0 ? triggerIndex + 1 : canonicalInteractions.length;
    const existingIds = new Set(canonicalInteractions.map((interaction) => interaction.id));
    const id = existingIds.has(selection.id) ? `${selection.id}:rehydrated` : selection.id;
    canonicalInteractions.splice(insertionIndex, 0, { ...selection, id });
  }
  const requiredData = [...scenario.requiredData];
  for (const selection of missingSelections) {
    if (!selection.valueKey || requiredData.some((field) => field.key === selection.valueKey)) continue;
    requiredData.push({
      key: selection.valueKey,
      label: selection.semanticField ?? selection.valueKey,
      ...(selection.entityScope ? { entityScope: selection.entityScope } : {}),
      stepIndex: Math.max(0, scenario.testRailSteps.length - 1),
      technicalTargetRefs: [...selection.technicalTargetRefs],
      sourceEventRefs: [...selection.sourceEventRefs],
      exampleValue: selection.recordedValue,
      sensitive: false,
      valueRole: "action_input",
      source: "RECORDED_CONFIRMED",
      ...(selection.technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction) ? { validatedByInteraction: true } : {}),
    });
  }
  return { ...scenario, canonicalInteractions, requiredData };
}

export function buildScenarioRuntimeDataset(scenario: Pick<RecordedScenario, "scenarioId" | "requiredData" | "runtimeInputRequirements"> & { canonicalInteractions?: CanonicalInteraction[] }): ScenarioRuntimeDataset {
  const requirements = scenario.runtimeInputRequirements?.length
    ? scenario.runtimeInputRequirements
    : materializeRuntimeInputRequirements(scenario);
  return {
    scenarioId: scenario.scenarioId,
    requirements,
    resolvedValues: Object.fromEntries(requirements.filter((requirement) => requirement.resolved && typeof requirement.value === "string").map((requirement) => [requirement.valueKey, requirement.value!])),
    missingValues: requirements.filter((requirement) => requirement.required && !requirement.resolved),
  };
}

export type StateSequenceValidation = {
  stateSequenceValid: boolean;
  stateSequenceIssues: string[];
};

export type RecordedActionReadiness = {
  actionId: string;
  actionType: CanonicalInteractionAction;
  semanticField?: string;
  valueKey?: string;
  runtimeValueResolved: boolean;
  technicalTargetCount: number;
  reResolutionPossible: boolean;
  stateCompatible: boolean;
  ready: boolean;
  blockReasons: string[];
  /**
   * True when this action's own field/owner identity was never admitted, but it is still
   * `ready` because sufficient recorded evidence exists for the EXISTING runtime/MCP resolver to
   * attempt live re-resolution (Recording Replay only). Never execution authority by itself —
   * `resolveActionTarget` still independently verifies/rejects it at runtime (resolved / ambiguous
   * / not_found / structurally incompatible).
   */
  runtimeResolutionRequired?: boolean;
};

export type RecordedScenarioExecutionReadiness = {
  functionalReady: boolean;
  dataReady: boolean;
  technicalReady: boolean;
  stateReady: boolean;
  compoundReady: boolean;
  mutationReady: boolean;
  executionReady: boolean;
  /**
   * false while ANY action is `runtimeResolutionRequired` (or otherwise not executionReady) —
   * a Recording Replay execution attempt is allowed before full certification, but promotion
   * (spec generation, promoted-spec reuse, publication) is not.
   */
  promotionReady: boolean;
  technicalCoveragePercent: number;
  actions: RecordedActionReadiness[];
  blockReasons: string[];
};

/**
 * Whether an interaction is real replay authority -- distinct from whether it is shown as its
 * own human-facing step (`technicalOnly`). By default these track together (a technicalOnly
 * interaction is also excluded from execution: a navigation reachability bridge or a derived
 * display click is not an independent action to perform). `executionAuthority` overrides that
 * default in either direction when the two concerns diverge -- see its own doc comment on
 * `InteractionStateOwnership` for the two cases this exists for.
 */
export function hasExecutionAuthority(interaction: Pick<CanonicalInteraction, "technicalOnly" | "executionAuthority">): boolean {
  return interaction.executionAuthority ?? !interaction.technicalOnly;
}

/**
 * Authoritative execution audit for recorded scenarios. TestRail publication deliberately
 * does not use this result; the replay/spec entry point does.
 */
export function evaluateRecordedScenarioExecutionReadiness(
  scenario: Pick<RecordedScenario, "canonicalInteractions" | "runtimeInputRequirements" | "testRailSteps" | "stateSequenceValid" | "mutationDiagnostics" | "readiness">,
): RecordedScenarioExecutionReadiness {
  const interactions = (scenario.canonicalInteractions ?? []).filter((interaction) =>
    hasExecutionAuthority(interaction)
    && interaction.action !== "system_observation"
    && interaction.action !== "navigation",
  );
  const requirements = new Map((scenario.runtimeInputRequirements ?? []).map((requirement) => [requirement.valueKey, requirement]));
  // `readiness` is a persisted projection and may be stale after a materialization repair.
  // The state timeline is the authority for this auditor; do not let an old technical flag
  // turn a valid state sequence into a blocker.
  const stateReady = scenario.stateSequenceValid !== false;
  const requirementForInteraction = (interaction: CanonicalInteraction): RuntimeInputRequirement | undefined => {
    if (!interaction.valueKey) return undefined;
    const exact = requirements.get(interaction.valueKey);
    if (exact) return exact;
    const comparable = comparableValueKey(interaction.valueKey);
    return [...requirements.values()].find((requirement) => comparableValueKey(requirement.valueKey) === comparable);
  };
  const actions = interactions.map((interaction): RecordedActionReadiness => {
    const targetCount = (interaction.technicalTargetCandidates?.length ?? 0) || interaction.technicalTargetRefs.length;
    const reResolutionPossible = (interaction.technicalTargetCandidates ?? []).some((candidate) =>
      candidate.locatorCandidates.length > 0
      && Boolean(candidate.structuralContext || candidate.stableAttributes),
    ) || interaction.technicalTargetRefs.length > 0;
    const requirement = requirementForInteraction(interaction);
    const requiresRuntimeValue = interaction.action === "fill" || interaction.action === "select";
    const runtimeValueResolved = !requiresRuntimeValue
      || !interaction.valueKey
      || Boolean(requirement?.resolved && requirement.value !== null)
      || typeof interaction.recordedValue === "string";
    // Two independent upstream cases both land on `resolutionState === "runtime_resolution_required"`:
    // (1) admission REJECTED the identity but real structured evidence makes it recoverable, or
    // (2) admission ACCEPTED a real, non-generic field/owner identity that simply never had any
    // technical locator captured for it, and the live field-scoped structural resolver supports
    // this action type. Either way, this interaction is not yet certified but is worth handing to
    // the EXISTING runtime/MCP resolver rather than being blocked outright.
    const runtimeResolutionRequired = interaction.resolutionState === "runtime_resolution_required";
    const blockReasons: string[] = [];
    // Missing target / no re-resolution strategy are the exact conditions a runtime-resolution
    // attempt exists to work around -- never block on them while that carve-out applies. Every
    // other gate below (unresolved value, state sequence, required-but-rejected identity) still
    // applies independently; a runtime-resolution attempt is never a promise of success, only
    // permission to try (see `promotionReady`, which still excludes every such action).
    if (targetCount === 0 && !runtimeResolutionRequired) blockReasons.push("missing_technical_target");
    if (!reResolutionPossible && !runtimeResolutionRequired) blockReasons.push("no_structural_reresolution_strategy");
    if (!runtimeValueResolved) blockReasons.push(`unresolved_runtime_value:${interaction.valueKey}`);
    if (!stateReady) blockReasons.push("state_sequence_invalid");
    // Unresolved is never optional BY DEFAULT: a required action whose technical/owner identity
    // admission gate rejected it must never be treated as ready just because SOME
    // target/candidate happens to be present (e.g. a last-resort structural fallback) — that
    // would let a "control"/"Campo pendiente de identificar" action reach the browser runtime as
    // if resolved.
    if (interaction.admissionStatus === "unresolved" && !runtimeResolutionRequired) blockReasons.push("required_interaction_unresolved");
    // TEMPORARY DIAGNOSTIC (this ticket only): no recordedValue/dataset literal/secret is logged --
    // only ids, action/role metadata, counts, and decision state, matching the ticket's redaction
    // requirement.
    console.info("[recording-readiness-action-result]", {
      interactionId: interaction.id,
      action: interaction.action,
      semanticField: interaction.semanticField ?? null,
      technicalTargetCount: targetCount,
      technicalTargetRefsCount: interaction.technicalTargetRefs.length,
      admissionStatus: interaction.admissionStatus,
      resolutionState: interaction.resolutionState,
      runtimeResolutionRequired,
      ready: blockReasons.length === 0,
      blockReasons,
    });
    return {
      actionId: interaction.id,
      actionType: interaction.action,
      ...(interaction.semanticField ? { semanticField: interaction.semanticField } : {}),
      ...(interaction.valueKey ? { valueKey: interaction.valueKey } : {}),
      runtimeValueResolved,
      technicalTargetCount: targetCount,
      reResolutionPossible,
      stateCompatible: stateReady,
      ready: blockReasons.length === 0,
      blockReasons,
      ...(runtimeResolutionRequired ? { runtimeResolutionRequired: true } : {}),
    };
  });
  const readyActions = actions.filter((action) => action.ready).length;
  const compoundReady = !scenario.mutationDiagnostics?.rejectionReason;
  const mutationReady = !scenario.mutationDiagnostics?.rejectionReason;
  const functionalReady = scenario.testRailSteps.length > 0;
  const dataReady = scenario.readiness?.dataReadiness !== false && actions.every((action) => action.runtimeValueResolved);
  const technicalReady = actions.every((action) => action.technicalTargetCount > 0 && action.reResolutionPossible);
  const blockReasons = [...new Set([
    ...actions.flatMap((action) => action.blockReasons),
    ...(!compoundReady ? [scenario.mutationDiagnostics?.rejectionReason ?? "mutation_contract_invalid"] : []),
    ...(!mutationReady ? [scenario.mutationDiagnostics?.rejectionReason ?? "mutation_contract_invalid"] : []),
  ])];
  // Every other readiness axis above already mirrors a specific per-action blockReason
  // (unresolved_runtime_value -> dataReady, state_sequence_invalid -> stateReady) — this is the
  // one axis (required_interaction_unresolved) with no dedicated boolean, so it is checked
  // directly against each action's own readiness rather than duplicating another named flag.
  const allActionsReady = actions.every((action) => action.ready);
  // `technicalReady` deliberately stays OUT of this AND-chain: it is the honest, unconditional
  // "does every action already carry a certified technical target" signal (never true for a
  // runtime-resolution-eligible action, by design — see its own field doc). `allActionsReady`
  // is the real per-action gate, and already accounts for the runtime-resolution carve-out
  // (missing_technical_target/no_structural_reresolution_strategy do not block a
  // runtime-resolution-required action there). Recording Replay may attempt execution on that
  // basis even while technical coverage is honestly reported as incomplete/deferred.
  const executionReady = functionalReady && dataReady && stateReady && compoundReady && mutationReady && allActionsReady;
  // Recording Replay may attempt execution once every action is `ready` even if some are only
  // runtime-resolution-required, but promotion (spec generation/reuse/publication) demands full
  // certification: no action may still be pending live re-verification by the runtime resolver.
  const promotionReady = executionReady && actions.every((action) => !action.runtimeResolutionRequired);
  // TEMPORARY DIAGNOSTIC (this ticket only): aggregate decision state only, no values.
  console.info("[recording-readiness-summary]", {
    executionReady,
    technicalReady,
    promotionReady,
    blockingInteractionIds: actions.filter((action) => !action.ready).map((action) => action.actionId),
  });
  return {
    functionalReady,
    dataReady,
    technicalReady,
    stateReady,
    compoundReady,
    mutationReady,
    executionReady,
    promotionReady,
    technicalCoveragePercent: actions.length === 0 ? 100 : Math.round((readyActions / actions.length) * 100),
    actions,
    blockReasons,
  };
}

export type RecordedScenarioMcpContract = McpScenario & {
  recordingId: string;
  recordedScenarioId: string;
  basePrimaryScenarioId?: string;
  canonicalInteractions: CanonicalInteraction[];
  entityActionBlocks: EntityActionBlock[];
  runtimeInputRequirements: RuntimeInputRequirement[];
  datasetBindings: Record<string, string | null>;
  technicalKnowledgeRefs: string[];
  stateSequenceValid: boolean;
  stateSequenceIssues: string[];
  oracleAuthority: RecordingReadiness["oracleReadiness"] extends boolean ? "OBSERVED" | "MISSING" : never;
  executionReadinessAudit?: RecordedScenarioExecutionReadiness;
};

function entityScopeOfTarget(target: RecordedTarget | undefined): string | undefined {
  if (target?.entityScope?.trim()) return target.entityScope.trim();
  if (target?.gridRef && (target.rowIdentity || target.rowRef)) return "entity_1";
  return undefined;
}

function clean(value: string | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function keyPart(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "campo";
}

function scopeOf(target: RecordedTarget | undefined): string | undefined {
  return entityScopeOfTarget(target);
}

function fieldOf(target: RecordedTarget | undefined): string | undefined {
  const frameworkOwner = semanticIdentityFromFrameworkOwnerEvidence(target);
  if (frameworkOwner.isFrameworkOwner) {
    const ownerIdentity = clean(target?.label);
    return ownerIdentity && !isGenericUnresolvedLabel(ownerIdentity)
      ? ownerIdentity
      : frameworkOwner.semanticIdentity;
  }
  return clean(target?.associatedField ?? target?.headerContext ?? target?.label);
}

/**
 * Delegates to the single shared admission authority (trace-normalizer.ts) so post-transition
 * owner recertification, semantic field admission, and trace normalization never independently
 * decide "this target has technical identity" differently. Never textual: only a stable
 * attribute or a non-positional, non-text-only locator counts — never label/header content, and
 * never a comparison against a previous owner.
 */
function hasStructuralIdentityCorroboration(target: RecordedTarget | undefined): boolean {
  return isTechnicalIdentityAdmissible(target);
}

function stableControlOf(event: RecordedEvent): string {
  const target = event.target;
  return [event.screenKey, target?.gridRef, scopeOf(target), target?.cellRef, fieldOf(target), target?.locators?.[0]?.strategy, target?.locators?.[0]?.value]
    .filter(Boolean)
    .join("|") || `event-${event.seq + 1}`;
}

function selectorControlOf(event: RecordedEvent, target: RecordedTarget | undefined): string | undefined {
  if (!target || target.compoundRole !== "selection") return undefined;
  return target.eventTargetRef
    ?? target.cellRef
    ?? target.currentTargetRef
    ?? `${event.screenKey}|${target.gridRef ?? ""}|${scopeOf(target) ?? ""}|${fieldOf(target) ?? target.label}`;
}

// The forward-transition boundary `transitionAfter` stops at: without `press` here, an event's
// own causal-transition scan could reach PAST an intervening press and misattribute a
// transition that actually belongs to the press (the next real action) to itself instead --
// producing a route/screen mismatch between the two that looks like a genuine incompatible
// sequence but is really a mis-owned transition upstream.
function actionEvent(event: RecordedEvent): boolean {
  return ["tap", "fill", "navigate", "back", "press"].includes(event.kind);
}

function stateScopeOf(event: RecordedEvent, target: RecordedTarget | undefined): string | undefined {
  const parts = [
    event.screenKey,
    target?.containerIdentity,
    target?.gridRef,
    target?.rowIdentity ?? target?.rowRef,
    target?.cellRef,
    entityScopeOfTarget(target),
  ].filter((part): part is string => Boolean(part?.trim()));
  return parts.length > 0 ? parts.join("|") : undefined;
}

function transitionAfter(events: readonly RecordedEvent[], index: number, excludeSeqs?: ReadonlySet<number>): { event?: RecordedEvent; nextActionIndex?: number } {
  for (let cursor = index + 1; cursor < events.length; cursor += 1) {
    const candidate = events[cursor];
    if (typeof candidate.seq === "number" && excludeSeqs?.has(candidate.seq)) continue;
    if (candidate.kind === "screen_change" && candidate.toScreenKey && candidate.toScreenKey !== candidate.screenKey) {
      return { event: candidate };
    }
    if (candidate.kind === "navigate" && candidate.url && events[index].url && candidate.url !== events[index].url) {
      return { event: candidate };
    }
    // A pointer note marks the start of a new interaction: any navigation after it belongs to
    // that interaction, not to the preceding action. Mirrors the `press` boundary semantics.
    if (candidate.kind === "note" && candidate.observationType === "pointer") return { nextActionIndex: cursor };
    if (actionEvent(candidate)) return { nextActionIndex: cursor };
  }
  return {};
}

/**
 * The trusted pointerdown observation that immediately precedes an action is the causal
 * anchor for that action. Web recordings emit pointerdown before the navigation it
 * produces and confirm the tap after it, so ordering by tap alone mis-binds a transition
 * to the previous action. This is structural (kind/observationType/screen), never textual.
 *
 * Explicit interactionId (Capture V2) is the sole authority over the naive event-kind stop
 * below, same principle as `nextPointerBoundaryT`: when this action carries an interactionId,
 * an intervening fill/tap/back with no interactionId of its own (or the SAME one) is never this
 * action's actual boundary -- it is scanned past, not treated as a cut -- because it cannot
 * contradict an identity this action does not share. An intervening fill/tap/back that carries
 * a DIFFERENT explicit interactionId is a genuine boundary and still stops the scan (fail
 * closed). A pointer note that itself carries an interactionId is only accepted when it matches
 * this action's own id -- it is never handed to an action with no id or a conflicting one (a
 * fill with no interactionId can never claim a pointer that explicitly belongs to another
 * action). Legacy recordings with no interactionId anywhere keep the exact prior behavior.
 */
function actionablePointerAnchor(events: readonly RecordedEvent[], index: number): RecordedEvent | undefined {
  const event = events[index];
  for (let cursor = index - 1; cursor >= 0 && index - cursor <= 40; cursor -= 1) {
    const candidate = events[cursor];
    if (candidate.kind === "note" && candidate.observationType === "pointer" && candidate.screenKey === event.screenKey) {
      if (candidate.interactionId && candidate.interactionId !== event.interactionId) return undefined;
      return candidate;
    }
    // A navigation is part of the transition, not a user-action boundary: keep scanning
    // past it so a pointerdown that precedes the navigation still anchors its action.
    if (candidate.kind === "tap" || candidate.kind === "fill" || candidate.kind === "back") {
      if (event.interactionId && (!candidate.interactionId || candidate.interactionId === event.interactionId)) continue;
      return undefined;
    }
  }
  return undefined;
}

/**
 * The next distinct-gesture pointerdown after a timestamp bounds an action's causal window.
 * Pointerdown events that share the anchor's screen and control identity belong to the same
 * physical gesture and must not close the window (structural grouping, no time threshold).
 * When both events carry an explicit interactionId (Capture V2), that is the sole gesture
 * authority: same id = same gesture, different id = distinct boundary. Legacy recordings
 * without interactionId fall back to the existing stableControlOf structural comparison.
 */
function nextPointerBoundaryT(events: readonly RecordedEvent[], fromT: number, anchor?: RecordedEvent): number | undefined {
  let boundary: number | undefined;
  for (const event of events) {
    if (event.kind !== "note" || event.observationType !== "pointer") continue;
    if (event.t <= fromT) continue;
    if (anchor?.interactionId && event.interactionId) {
      if (event.interactionId === anchor.interactionId) continue;
    } else if (anchor && event.screenKey === anchor.screenKey && stableControlOf(event) === stableControlOf(anchor)) {
      continue;
    }
    boundary = boundary === undefined ? event.t : Math.min(boundary, event.t);
  }
  return boundary;
}

/**
 * A route transition belongs to the action whose pointer lifecycle caused it: the last
 * navigation that fired between this action's pointerdown and the next pointerdown. When
 * no pointer anchor exists (legacy/other platforms) the forward-looking transition is used.
 */
function causalTransition(events: readonly RecordedEvent[], index: number, excludeSeqs?: ReadonlySet<number>): { event?: RecordedEvent } {
  const anchor = actionablePointerAnchor(events, index);
  if (!anchor || !anchor.url) return transitionAfter(events, index, excludeSeqs);
  const end = nextPointerBoundaryT(events, anchor.t, anchor) ?? Number.POSITIVE_INFINITY;
  let bound: RecordedEvent | undefined;
  for (const candidate of events) {
    if (candidate.kind !== "navigate" || !candidate.url) continue;
    if (typeof candidate.seq === "number" && excludeSeqs?.has(candidate.seq)) continue;
    if (candidate.t < anchor.t || candidate.t > end) continue;
    if (candidate.url === anchor.url) continue;
    bound = candidate;
  }
  return bound ? { event: bound } : transitionAfter(events, index, excludeSeqs);
}

function ownershipForEvent(events: readonly RecordedEvent[], index: number, excludeSeqs?: ReadonlySet<number>): InteractionStateOwnership {
  const event = events[index];
  const target = event.target;
  const anchor = actionablePointerAnchor(events, index);
  const transition = causalTransition(events, index, excludeSeqs);
  const transitionEvent = transition.event;
  const screenAfterRef = transitionEvent?.toScreenKey
    ?? (transitionEvent?.kind === "navigate" ? transitionEvent.screenKey : undefined);
  const routeAfter = transitionEvent?.url;
  // The route at the action's pointerdown is the pre-action surface; the tap URL is
  // post-navigation for actions whose navigation precedes the tap confirmation.
  const routeBefore = anchor?.url ?? event.url;
  const changed = Boolean(screenAfterRef && screenAfterRef !== event.screenKey)
    || Boolean(routeAfter && routeBefore && routeAfter !== routeBefore);
  return {
    screenBeforeRef: event.screenKey,
    ...(changed && screenAfterRef ? { screenAfterRef } : { screenAfterRef: event.screenKey }),
    ...(routeBefore ? { routeBefore } : {}),
    ...(changed && routeAfter ? { routeAfter } : {}),
    ...(target?.containerIdentity ? { containerRef: target.containerIdentity } : {}),
    ...(target?.gridRef ? { gridRef: target.gridRef } : {}),
    ...(stateScopeOf(event, target) ? { stateScope: stateScopeOf(event, target) } : {}),
    ...(changed ? { transitionObserved: true, causedTransition: true, terminalForContext: true } : {}),
  };
}

function isDerivedDisplayClick(events: readonly RecordedEvent[], index: number): boolean {
  const event = events[index];
  if (event.kind !== "tap" || event.target?.interactionType === "select" || event.target?.afterValue !== undefined) return false;
  // A V2 pointer interaction is a physical action, even when its owner is unresolved and
  // the rendered label is aggregate text.  Keep it in the observed functional projection;
  // technical readiness remains fail-closed because it still has no certified target.
  if (event.interactionId) return false;
  const target = event.target;
  if (!target) return false;
  const priorInput = [...events.slice(Math.max(0, index - 25), index)].reverse()
    .find((candidate) => candidate.kind === "fill" && candidate.screenKey === event.screenKey && candidate.target?.associatedField && event.t - candidate.t <= 15_000);
  const noDelta = !target.stateDelta || Object.values(target.stateDelta).every((value) => value === undefined || value === false || value === "");
  const noMeaningfulAfterState = !target.afterState || (!target.afterState.value && !target.afterState.committedValue && target.afterState.selected !== true);
  const targetLooksLikeUserControl = target.role?.toLowerCase() === "button"
    || target.role?.toLowerCase() === "a"
    || target.role?.toLowerCase() === "link"
    || target.role?.toLowerCase() === "checkbox"
    || target.interactionType === "select";
  const targetLooksDerived = event.valueSource === "application"
    || (!targetLooksLikeUserControl && priorInput && target.label && target.label !== priorInput.target?.label && target.label.length > 20 && !target.locators.some((locator) => locator.strategy === "label"));
  return Boolean(priorInput && targetLooksDerived && noDelta && noMeaningfulAfterState);
}

export function isMaskActivation(events: readonly RecordedEvent[], index: number): boolean {
  const event = events[index];
  if (event.kind !== "tap" || isSelection(event) || !event.target) return false;
  const mask = event.target.placeholder ?? event.target.label;
  if (!mask || !/^[0-9x#*a]+(?:[\s./_:-][0-9x#*a]+)+$/i.test(mask)) return false;
  const field = fieldOf(event.target);
  const scope = scopeOf(event.target);
  const nextFill = events.slice(index + 1, index + 20).find((candidate) => candidate.kind === "fill"
    && candidate.screenKey === event.screenKey
    && fieldOf(candidate.target) === field
    && scopeOf(candidate.target) === scope);
  const hasDelta = Object.values(event.target.stateDelta ?? {}).some((value) => value !== undefined && value !== false && value !== "");
  return Boolean(nextFill && !hasDelta && !event.target.afterValue);
}

function isSelection(event: RecordedEvent): boolean {
  return event.kind === "tap"
    && (event.target?.interactionType === "select"
      || event.target?.compoundRole === "selection"
      || event.target?.afterValue !== undefined
      || event.target?.dynamicLifecycle?.selectedOption !== undefined);
}

function checkboxAction(target: RecordedEvent["target"]): "check" | "uncheck" {
  const ariaChecked = target?.afterState?.aria?.["aria-checked"];
  if (target?.afterState?.selected === false || ariaChecked === "false" || target?.stateDelta?.checked === false) return "uncheck";
  return "check";
}

function logicalValue(
  event: RecordedEvent,
  editingSessions: readonly RecordedEditingSession[] = [],
  compoundSelectionValue?: string,
): string | undefined {
  const target = event.target;
  const eventRef = `event-${event.seq + 1}`;
  const editingSession = editingSessions.find((session) => session.editingSessionId === target?.editingSessionRef)
    ?? editingSessions.find((session) => session.semanticField === fieldOf(target)
      && session.compoundRole === target?.compoundRole)
    ?? editingSessions.find((session) => session.rawEventRefs.includes(eventRef));
  if (editingSession?.finalValue !== undefined) {
    return logicalCompoundChildValue(editingSession.finalValue, compoundSelectionValue)
      ?? (target?.compoundRole === "amount_or_text" && compoundSelectionValue ? undefined : clean(editingSession.finalValue));
  }
  // Amount editors expose a logical child value separately from the formatted compound
  // display. The recorder's rawTypedValue is already the child session value; using the
  // parent display here would reintroduce the currency prefix into the amount dataset.
  if (target?.compoundRole === "amount_or_text"
    && /^(?:[A-Z]{3})\s+\d/.test(target.rawTypedValue ?? target.committedValue ?? target.afterValue ?? "")) return undefined;
  if (target?.compoundRole === "amount_or_text" && clean(target.rawTypedValue)) {
    return logicalCompoundChildValue(target.rawTypedValue, compoundSelectionValue)
      ?? (compoundSelectionValue ? undefined : clean(target.rawTypedValue));
  }
  return clean(target?.committedValue)
    ?? clean(target?.afterState?.committedValue)
    ?? clean(target?.rawTypedValue)
    ?? clean(target?.inputValue)
    ?? clean(event.value);
}

/** Converts normalized events to the stable interaction vocabulary used by all downstream consumers. */
export function buildCanonicalInteractions(
  events: readonly RecordedEvent[],
  editingSessions: readonly RecordedEditingSession[] = [],
): CanonicalInteraction[] {
  const result: CanonicalInteraction[] = [];
  // A navigation causally produced by an executable action is already represented by that
  // action's recorded routeAfter. Re-emitting it as a standalone technical navigation would
  // duplicate the transition and corrupt the state timeline (a bridge whose origin repeats
  // the previous action's destination looks like an incompatible sequence). Navigations with
  // no owning executable action are retained as reachability bridges.
  //
  // `press` is a legitimate transition cause too (e.g. Enter submitting a form) -- it never has
  // a pointer anchor (no mouse gesture precedes a keyboard command), so it always takes the
  // `!anchor` branch below and claims its transition via the same forward-looking
  // `causalTransition` tap/fill already use. Before this, a navigation a press alone caused was
  // never marked owned, so it doubled up as its own standalone `navigation` interaction whose
  // screenBeforeRef never lined up with the press's own screenAfterRef -- exactly the "secuencia
  // de estados incompatible" false negative this fixes.
  const ownedTransitionSeqs = new Set<number>();
  for (let candidateIndex = 0; candidateIndex < events.length; candidateIndex += 1) {
    const candidate = events[candidateIndex];
    if (candidate.kind !== "tap" && candidate.kind !== "fill" && candidate.kind !== "press") continue;
    const anchor = actionablePointerAnchor(events, candidateIndex);
    if (!anchor || !anchor.url) {
      const transition = causalTransition(events, candidateIndex).event;
      if (transition && typeof transition.seq === "number") ownedTransitionSeqs.add(transition.seq);
      continue;
    }
    const end = nextPointerBoundaryT(events, anchor.t, anchor) ?? Number.POSITIVE_INFINITY;
    for (const navigateEvent of events) {
      if (navigateEvent.kind !== "navigate" || typeof navigateEvent.seq !== "number") continue;
      if (navigateEvent.t < anchor.t || navigateEvent.t > end) continue;
      ownedTransitionSeqs.add(navigateEvent.seq);
    }
  }
  // Tracks the screen of the last emitted functional (tap/fill) interaction, so the very next
  // interaction on a DIFFERENT screen can be recognized as needing recertification before its
  // field/owner identity is trusted — never by comparing label text against the previous owner.
  let lastFunctionalScreenKey: string | undefined;
  // Tracks which screens have already produced at least one fill/select interaction, so a click
  // that lands on a screen with NO prior fill/select can be recognized as potentially missing a
  // required input the capture script never emitted an event for (see
  // `missingRequiredFillPrecondition` below) — purely structural (per-screen action-kind
  // presence), never a field name/label comparison.
  const screensWithFillOrSelect = new Set<string>();
  // Related state surface evidence is captured on the post_action OBSERVATION (emitted ~180ms after
  // the trusted click, once its causal mutations have settled) and keyed by the click's own
  // `targetRef` (the observation's `triggerTechnicalTarget`). Pre-build the lookup so the tap/fill
  // interaction can attach it in the SAME pass without a second scan of the trace.
  const relatedStateByTrigger = new Map<string, { ownerIdentity?: string; containerIdentity?: string; mutations: RelatedStateMutationRecord[] }>();
  for (const event of events) {
    if (event.kind !== "note" || event.observationType !== "post_action") continue;
    const lifecycle = event.target?.dynamicLifecycle as { triggerTechnicalTarget?: string; relatedStateOwnerIdentity?: string; relatedStateContainerIdentity?: string; relatedStateMutations?: Array<{ nodeIdentity?: string; kind?: string; attributeName?: string }> } | undefined;
    const trigger = lifecycle?.triggerTechnicalTarget;
    if (!trigger) continue;
    relatedStateByTrigger.set(trigger, {
      ownerIdentity: lifecycle?.relatedStateOwnerIdentity,
      containerIdentity: lifecycle?.relatedStateContainerIdentity,
      mutations: (lifecycle?.relatedStateMutations ?? [])
        .filter((mutation) => mutation && typeof mutation.nodeIdentity === "string" && mutation.nodeIdentity.length > 0)
        .map((mutation) => ({ nodeIdentity: mutation.nodeIdentity!, kind: mutation.kind ?? "unknown", ...(mutation.attributeName ? { attributeName: mutation.attributeName } : {}) })),
    });
  }
  for (const [index, event] of events.entries()) {
    const target = event.target;
    if (event.kind === "note" || event.kind === "launch" || event.kind === "screen_change") continue;
    if (event.kind === "navigate" || event.kind === "back") {
      if (typeof event.seq === "number" && ownedTransitionSeqs.has(event.seq)) continue;
      const ownership = ownershipForEvent(events, index, ownedTransitionSeqs);
      result.push({
        id: `interaction-${index + 1}`,
        controlIdentity: stableControlOf(event),
        action: "navigation",
        sourceEventRefs: [`event-${index + 1}`],
        technicalTargetRefs: target?.locators?.map((locator) => `${locator.strategy}:${locator.value}`) ?? [],
        description: target?.label ? `Presionar "${target.label}"` : undefined,
        ...ownership,
        technicalOnly: true,
        confidence: 0.9,
      });
      continue;
    }
    if (event.kind !== "tap" && event.kind !== "fill" && event.kind !== "press") continue;
    if (isMaskActivation(events, index)) continue;
    const selection = isSelection(event);
    const derivedDisplayClick = isDerivedDisplayClick(events, index);
    // CaptureEngine V2's functional `select` projection (SelectionSessionManager) already
    // produced ONE combined selection event elsewhere in this trace summarizing this exact
    // technical click (a combobox-open or option-choose click) -- the click itself, its target,
    // and its locators stay fully intact for replay authority, but it must not ALSO surface as
    // its own independent step (that would double-count one physical selection as two).
    const selectionCovered = Boolean(target?.coveredByFunctionalSelection);
    // Generic signal (not selection-specific) for "this event is itself a DISPLAY PROJECTION over
    // other technical actions, never captured against a real DOM target" -- any producer that
    // stamps `sourceTechnicalEventSeqs` on a synthesized event opts into this, so it must never
    // become the sole executable action even though it IS shown as its own human step. Checked by
    // FIELD PRESENCE, not by a non-empty array: a projection whose lineage seqs happened not to
    // match any real event (a broken/missing source reference) is still a projection with no real
    // target of its own -- it must stay excluded from execution, never silently readmitted just
    // because its lineage came up empty.
    const isDisplayProjection = target?.sourceTechnicalEventSeqs !== undefined;
    const action: CanonicalInteractionAction = event.kind === "press"
      ? "press"
      : selection
        ? "select"
        : event.kind === "fill"
          ? "fill"
          : target?.role?.toLowerCase() === "checkbox"
            ? checkboxAction(target)
            : "click";
    const value = event.kind === "press"
      ? undefined
      : selection
        ? clean(target?.afterValue ?? target?.dynamicLifecycle?.selectedOption)
        : logicalValue(event, editingSessions, confirmedCompoundSelectionBefore(events, index, target));
    // The discrete command key ("Enter", "Escape", ...) a press action sends -- a literal action
    // parameter, never a dataset-bound/runtime-resolved value like `value` above, and never
    // sensitive/redactable the way a fill's value can be.
    const key = event.kind === "press" ? clean(event.note ?? "") : undefined;
    // A field/owner identity resolved purely from an ancestor-walk label/header (fieldOf) is
    // never trusted for the first interaction on a new screen unless corroborated by structural
    // evidence captured on THIS interaction's own target — the previous screen's owner is never
    // reused, and the check itself never compares label text.
    const isPostTransition = lastFunctionalScreenKey !== undefined && lastFunctionalScreenKey !== event.screenKey;
    const structurallyCorroborated = hasStructuralIdentityCorroboration(target);
    const ownerRecertificationRequired = isPostTransition && !structurallyCorroborated;
    // Independent of transitions: a generic fallback label ("control", "campo", ...) with no
    // technical identity of its own is never admitted as executable authority either — this is
    // the same admission decision "control"/"Campo pendiente de identificar" must fail.
    const genericWithoutIdentity = !structurallyCorroborated
      && isGenericUnresolvedLabel(target?.associatedField ?? target?.headerContext ?? target?.label);
    // A submit-shaped click can survive capture perfectly (real technical identity, real label)
    // while the fill(s) it depends on were never captured as their own events at all -- observed
    // physically as a login click whose OWN `activeElementBefore` snapshot shows a real,
    // non-empty editable field (structural: input/textarea/select tag or textbox/combobox role,
    // never a field name/label match) with no fill/select interaction preceding it anywhere on
    // this screen. This is a missing PRECONDITION, not an identity problem, and is never
    // recoverable by re-resolving a target at runtime -- the value was simply never recorded.
    const activeBefore = target?.activeElementBefore;
    const activeBeforeTag = (activeBefore?.tag ?? "").toLowerCase();
    const activeBeforeRole = (activeBefore?.role ?? "").toLowerCase();
    const activeBeforeWasEditableWithContent = Boolean(activeBefore)
      && (["input", "textarea", "select"].includes(activeBeforeTag) || ["textbox", "combobox"].includes(activeBeforeRole))
      && Boolean(clean(activeBefore?.value ?? activeBefore?.inputValue ?? activeBefore?.committedValue ?? ""));
    const missingRequiredFillPrecondition = action === "click"
      && activeBeforeWasEditableWithContent
      && !screensWithFillOrSelect.has(event.screenKey);
    // A press with no captured key is never executable authority -- there is no key to send, and
    // no runtime re-verification can recover one that was simply never recorded.
    const missingPressKey = action === "press" && !key;
    const admissionRejected = ownerRecertificationRequired || genericWithoutIdentity || missingRequiredFillPrecondition || missingPressKey;
    const admissionReason = missingPressKey
      ? "missing_press_key"
      : missingRequiredFillPrecondition
      ? "missing_required_credential_fill"
      : ownerRecertificationRequired
        ? "post_transition_owner_not_recertified"
          : genericWithoutIdentity
          ? "generic_label_without_technical_identity"
          : undefined;
    lastFunctionalScreenKey = event.screenKey;
    // Any fill/select EVENT at all proves the capture listener fired on this screen, regardless
    // of whether ITS OWN identity was separately admitted — that is an independent, already
    // handled concern (required_interaction_unresolved). This tracker exists only to catch the
    // "zero fill events were ever captured here" case.
    if (action === "fill" || action === "select") screensWithFillOrSelect.add(event.screenKey);
    const technicalTargetRefsForEvent = target?.locators?.map((locator) => `${locator.strategy}:${locator.value}`) ?? [];
    // A real structural label source (associatedField/headerContext/columnIdentity), never the raw
    // ancestor-walk label fallback fieldOf(target) also accepts — that fallback is exactly the
    // "control"/generic-label surface the admission gate exists to reject, so it must never be
    // resurrected here even for a runtime-resolution attempt. `columnIdentity` (a grid cell's
    // stable data-column/data-field/aria-colindex identity, see runtime-knowledge-extractor.ts)
    // is included because a virtualized/grid-owned field can carry a real column identity while
    // headerContext never resolved (header row scrolled out/not captured) -- omitting it here was
    // a false negative: the exact same target already carries enough real structural evidence for
    // the live field-scoped resolver, it was just never offered as a candidate field name. Two
    // more exclusions, both required to avoid reopening bugs earlier tickets fixed: (1) a
    // post-transition uncorroborated owner (ownerRecertificationRequired) never contributes a
    // field name here, however real-looking — that data is exactly what is untrustworthy right
    // after a surface change, independent of this ticket's runtime-resolution evidence question;
    // (2) a generic-shaped associatedField/headerContext/columnIdentity value ("control", "campo",
    // ...) is never treated as a real field name either.
    const rawStructuralFieldCandidate = clean(target?.associatedField ?? target?.headerContext ?? target?.columnIdentity ?? "") || undefined;
    const structuralFieldName = !ownerRecertificationRequired && rawStructuralFieldCandidate && !isGenericUnresolvedLabel(rawStructuralFieldCandidate)
      ? rawStructuralFieldCandidate
      : undefined;
    // Recording Replay admission (this is NOT execution authority): a required interaction whose
    // field/owner identity the admission gate rejected can still be worth handing to the EXISTING
    // runtime/MCP resolver (resolveActionTarget) rather than being blocked outright, but only when
    // there is real, structured, non-textual evidence beyond the rejected label/bare fallback
    // itself: the user actually recorded a value AND at least one independent structural signal
    // (its own technical/locator evidence, a real structural field name, or a captured
    // field-owner diagnostic attempt) backs it. A bare structural locator alone, or a generic
    // label alone, never qualifies on its own.
    // A post-transition, uncorroborated owner (ownerRecertificationRequired) never contributes
    // its structural field name (already excluded above) NOR any label/display-text-shaped
    // technical evidence ("text" strategy locators literally embed display text as their
    // value) — that is exactly the stale-previous-screen risk this rejection reason exists to
    // guard against, and this ticket must never reopen it. A genuinely non-textual technical
    // signal (a structural/data-testid/aria-label locator, or a captured field-owner diagnostic
    // attempt) carries no such risk even post-transition, because the EXISTING runtime resolver
    // independently re-verifies route/surface compatibility live before trusting it.
    const nonTextualTechnicalEvidencePresent = technicalTargetRefsForEvent.some((ref) => !ref.startsWith("text:"));
    // A missing required fill is a PRECONDITION gap, never an identity-resolution one: no
    // technical target evidence on the click itself can substitute for a value that was simply
    // never recorded, so it is never eligible for runtime resolution either.
    // A recorded VALUE is only meaningful evidence for an action that actually carries one
    // (fill/select) -- a click or press never has one BY DESIGN (its own occurrence is the
    // evidence, not a typed value), so requiring `Boolean(value)` unconditionally permanently
    // excluded every rejected click/press from this carve-out regardless of how much real
    // structural evidence (technicalTargetRefs/structuralFieldName/fieldOwnerDiagnostic) backed
    // it -- exactly the loss an icon-only button click (real recorded technical action, no
    // accessible name) hit. RAW TECHNICAL ACTION != DISPLAY LABEL.
    const recordedValueRequiredAsEvidence = action === "fill" || action === "select";
    // FIRST_LOSS fix (recordingId ba0dec1c-7db8-4793-9ef6-676c9fad98c8, interaction-24): a
    // technicalTargetCandidate can carry real, structurally-deterministic owner identity
    // (`deterministicStructuralIdentity: true`, `identityAmbiguous` not set) purely from
    // structure -- stable attributes/descendants/landmark, NEVER a label -- even when its own
    // `locatorCandidates` is empty and the click's accessible name/aria-label is a generic,
    // grid-repeated string ("Seleccionar fila"-shaped) that admission correctly refuses to trust
    // as field identity on its own. This is the EXACT SAME identity flag
    // `resolveRecordedStructuralOwner` (target-resolver.ts) already builds a live selector from
    // and re-verifies for genuine runtime uniqueness before ever resolving anything -- it never
    // trusts this capture-time flag alone, so admitting it here can never fabricate a fake
    // resolution; a genuinely repeated/ambiguous live DOM still fails closed downstream, exactly
    // as the "generic label" concern requires. Never used as field/semantic identity (no
    // semanticField/valueKey is derived from it below) -- runtime EXECUTION authority only.
    //
    // Scoped to `check`/`uncheck` only -- the exact action shape this ticket proved the runtime
    // structural resolver already handles safely. Never generalized to `click`/`select`: a
    // selection/combobox OWNER click also carries a bare structural candidate indistinguishable
    // from its own OPTION at this evidence layer, and telling them apart relies on
    // `structuralFieldName` being real/present -- an invariant this narrower evidence path must
    // never bypass. Widening beyond check/uncheck needs its own proven boundary, not assumed here.
    const deterministicStructuralOwnerEvidence = (action === "check" || action === "uncheck")
      && (target?.technicalTargetCandidates ?? []).some((candidate) =>
        candidate.structuralContext?.deterministicStructuralIdentity === true
        && candidate.structuralContext.identityAmbiguous !== true,
      );
    const scopedStructuralEvidencePresent = (target?.technicalTargetCandidates ?? []).some((candidate) => {
      const context = candidate.structuralContext;
      return Boolean(
        context?.scopeIdentity?.strategy
        && context.scopeIdentity.value
        && context.targetFingerprint
        && context.captureScopeUnique === true
        && context.captureTargetMatchCount === 1
        && context.structuralIdentityMatchCount === 1
        && context.identityAmbiguous !== true,
      );
    });
    // LAST-RESORT, EXECUTION-ONLY: the ORIGINAL clicked target's own captured semantic evidence
    // (accessible name/visible text), already proven unique within one or more stable technical
    // scopes at capture time -- never a certified owner, never a technicalTarget, never promoted
    // to `technicalReady`/`promotionReady` (see `executionAudit` below). Scoped to the SAME
    // action types the structural runtime path supports; a target already proven ambiguous by
    // prior locator evidence is never handed to it either, exactly like the structural path.
    const semanticRuntimeEligible = Boolean(target?.semanticRuntimeEvidence)
      && target!.semanticRuntimeEvidence!.captureUniqueTarget === true
      && target!.semanticRuntimeEvidence!.scopeAlternatives.length > 0
      && (action === "fill" || action === "click" || action === "press")
      && !(target?.technicalTargetCandidates ?? []).some((candidate) =>
        (candidate.locatorCandidates ?? []).some((locator) => locator.ambiguous === true),
      );
    const recorderRuntimeEligible = Boolean(target?.playwrightRecorderEvidence)
      && target!.playwrightRecorderEvidence!.runtimeResolutionRequired === true
      && target!.playwrightRecorderEvidence!.kind !== "segmented_input"
      && (action === "fill" || action === "click" || action === "press")
      // Capture-time match count is provenance/diagnostic only. It must not
      // gate execution admission: the shared runtime resolver repeats the
      // locator-intent lookup live and remains fail-closed for 0 or >1 matches.
      && Boolean(target!.playwrightRecorderEvidence!.normalizedName?.trim());
    const sufficientRuntimeEvidence = admissionRejected
      && !missingRequiredFillPrecondition
      // A press with no captured key has nothing to send -- no amount of structural evidence
      // about the OWNER recovers a key that was simply never recorded. Stays hard-blocked
      // exactly like a missing required fill precondition.
      && !missingPressKey
      && (!recordedValueRequiredAsEvidence || Boolean(value))
      && (ownerRecertificationRequired
        ? nonTextualTechnicalEvidencePresent
        : (technicalTargetRefsForEvent.length > 0 || Boolean(structuralFieldName) || Boolean(target?.fieldOwnerDiagnostic) || deterministicStructuralOwnerEvidence || scopedStructuralEvidencePresent || semanticRuntimeEligible || recorderRuntimeEligible));
    // A SECOND, independent runtime-resolution case: admission ACCEPTED the field/owner identity
    // (a real, non-generic associatedField/role) but the recorder never captured any technical
    // locator for it at all (technicalTargetRefsForEvent.length === 0) -- not rejected, just
    // never technically covered. The live field-scoped structural resolver (target-resolver.ts's
    // `resolveActionTarget`/`resolveFillTarget` field-scoped fallback) can attempt this live for
    // the action types it actually supports (fill/click/press only -- select/check/uncheck are
    // not wired to it and must never be assumed eligible). No prior locator-ambiguity evidence on
    // this target either: a target already proven ambiguous is never handed to live re-resolution
    // hoping it resolves differently.
    const STRUCTURAL_RUNTIME_ELIGIBLE_ACTIONS = new Set<CanonicalInteractionAction>(["fill", "click", "press"]);
    // REGRESSION FIX (recordingId e5c8ac51-1dff-4c56-9a55-dcd941203a32, interaction-14): a prior
    // ticket folded `structuralContext.identityAmbiguous`/`structuralIdentityMatchCount` into this
    // check, reasoning that capture-time ambiguity should fail closed as early as possible. That
    // was demonstrated WRONG by physical replay: `structuralIdentityMatchCount` is a coarse,
    // landmark-wide match count taken at CAPTURE time (before the live re-resolver's own
    // `stableDescendants`/`semanticShape`/`:not(:has(...))` nearest-owner narrowing ever runs),
    // not the same scope or precision as the LIVE field-scoped resolver's own re-count. The exact
    // same "Número de identificación" button (`identityAmbiguous:true, matchCount:2` at capture)
    // was PHYSICALLY resolved live to exactly one element and executed successfully before this
    // regression -- capture-time global ambiguity is a WEAKER, over-cautious proxy, never a
    // substitute for the live resolver's own independent `count !== 1` fail-closed check (which
    // stays completely unchanged and is the real safety net here). Only a genuine per-LOCATOR
    // `ambiguous` flag (a narrower, more specific marker on an actual candidate locator) still
    // blocks eligibility here.
    const priorAmbiguityEvidence = (target?.technicalTargetCandidates ?? []).some((candidate) =>
      (candidate.locatorCandidates ?? []).some((locator) => locator.ambiguous === true),
    );
    const frameworkStructuralRuntimeEligible = semanticIdentityFromFrameworkOwnerEvidence(target)
      .hasDeterministicStructuralAuthority;
    // Unrestricted by action type (STRUCTURAL_RUNTIME_ELIGIBLE_ACTIONS below already scopes this
    // to fill/click/press) -- kept as its own definition, separate from the narrower,
    // check/uncheck-only `deterministicStructuralOwnerEvidence` above, since reusing that one
    // here would silently exclude fill/click/press (pre-existing, unrelated behavior this ticket
    // must not touch).
    const deterministicStructuralRuntimeEligible = (target?.technicalTargetCandidates ?? []).some((candidate) =>
      candidate.structuralContext?.deterministicStructuralIdentity === true
      && candidate.structuralContext.identityAmbiguous !== true,
    );
    const scopedStructuralRuntimeEligible = scopedStructuralEvidencePresent;
    const structuralRuntimeEligible = !admissionRejected
      && technicalTargetRefsForEvent.length === 0
      && STRUCTURAL_RUNTIME_ELIGIBLE_ACTIONS.has(action)
      && !priorAmbiguityEvidence
      && (
        frameworkStructuralRuntimeEligible
        || deterministicStructuralRuntimeEligible
        || scopedStructuralRuntimeEligible
        || (Boolean(structuralFieldName) && Boolean(target?.role))
        || semanticRuntimeEligible
        || recorderRuntimeEligible
      );
    // A combobox-trigger click that is part of a functional selection (selectionCovered) is no
    // longer excluded here: the generic field-scoped structural-owner resolver
    // (target-resolver.ts's landmark-scoped owner match, used by every other runtime-resolution-
    // required click) is role-agnostic -- it matches on stableDirectAttributes/stableDescendants/
    // semanticShape/landmarkAncestor and fails closed on its own live re-count (`count!==1` ->
    // `structural_match_not_unique`/`action_owner_ambiguous`, never a fabricated/positional pick).
    // Nothing in it special-cases or excludes role="combobox". The paired OPTION click never
    // qualifies here regardless (it carries no associatedField/headerContext/columnIdentity of its
    // own, so `structuralFieldName` is always undefined for it, and it already has real captured
    // technicalTargetRefs from its own identity) -- this only ever newly admits the combobox OWNER
    // half of a selection, never the option half, and never touches `tryResolveSelectionOptionViaField`
    // or the synthesized "select" projection's own (unrelated, executionAuthority:false) resolution.
    const resolutionState: "certified" | "runtime_resolution_required" | "unresolved_unrecoverable" = !admissionRejected
      ? (structuralRuntimeEligible ? "runtime_resolution_required" : "certified")
      : sufficientRuntimeEvidence
        ? "runtime_resolution_required"
        : "unresolved_unrecoverable";
    // TEMPORARY DIAGNOSTIC (this ticket only, remove once the real blocking action is confirmed):
    // structural label VALUES logged below (associatedField/headerContext/columnIdentity/
    // rawStructuralFieldCandidate/structuralFieldName) are field-name METADATA (e.g. a column
    // header or DOM data-field identity), never a recordedValue/dataset literal/secret -- no
    // interaction.value/recordedValue is ever included here.
    console.info("[recording-readiness-action]", {
      interactionId: `interaction-${index + 1}`,
      action,
      role: target?.role ?? null,
      associatedField: target?.associatedField ?? null,
      headerContext: target?.headerContext ?? null,
      columnIdentity: target?.columnIdentity ?? null,
      rawStructuralFieldCandidate: rawStructuralFieldCandidate ?? null,
      structuralFieldName: structuralFieldName ?? null,
      isGenericUnresolvedLabel: Boolean(rawStructuralFieldCandidate) && isGenericUnresolvedLabel(rawStructuralFieldCandidate),
      ownerRecertificationRequired: Boolean(ownerRecertificationRequired),
      selectionCovered: Boolean(selectionCovered),
      supportedStructuralAction: STRUCTURAL_RUNTIME_ELIGIBLE_ACTIONS.has(action),
      roleKnown: Boolean(target?.role),
      technicalTargetCount: technicalTargetRefsForEvent.length,
      admissionStatus: admissionRejected ? "unresolved" : "accepted",
      resolutionState,
      structuralRuntimeEligible,
      semanticRuntimeEligible,
    });
    // semanticField/valueKey are only restored from a REAL structural field name, never from the
    // rejected fallback label — this is "may attempt runtime resolution", not "this identity is
    // now certified": admissionStatus below stays "unresolved" regardless.
    // A press's payload is its `key`, never a dataset-bound field value -- computing a
    // semanticField/valueKey for it risks creating a spurious runtime input requirement (the
    // dataset system expects a fillable value behind every valueKey) for an action that has none.
    const semanticField = event.kind === "press"
      ? undefined
      : !admissionRejected
        ? fieldOf(target)
        : (resolutionState === "runtime_resolution_required" ? structuralFieldName : undefined);
    const scope = scopeOf(target);
    const valueKey = semanticField
      ? `${scope ? `${scope}.` : ""}${keyPart(semanticField)}${selection ? "_seleccion" : target?.compoundRole === "amount_or_text" ? "_valor" : ""}`
      : undefined;
    const ownership = ownershipForEvent(events, index);
    const technicalTargetCandidates = preserveCapturedTechnicalTargetLocators(
      target?.technicalTargetCandidates,
      target?.locators ?? [],
    );
    // Diagnostic/state-observation authority only: derive a related state surface from the recorder's
    // causal mutation observation. Never affects action/field/readiness/execution decisions.
    const relatedStateSurfaceEvidence = target?.eventTargetRef
      ? deriveRelatedStateSurfaceEvidence({
          sourceInteractionId: `interaction-${index + 1}`,
          sourceOwnerIdentity: (relatedStateByTrigger.get(target.eventTargetRef)?.ownerIdentity) ?? target.eventTargetRef,
          relationKind: "local_container",
          containerIdentity: relatedStateByTrigger.get(target.eventTargetRef)?.containerIdentity,
          mutations: relatedStateByTrigger.get(target.eventTargetRef)?.mutations ?? [],
        })
      : undefined;
    result.push({
      id: `interaction-${index + 1}`,
      controlIdentity: stableControlOf(event),
      ...(semanticField ? { semanticField } : {}),
      ...(scope ? { entityScope: scope } : {}),
      action,
      ...(valueKey ? { valueKey } : {}),
      ...(value ? { recordedValue: value } : {}),
      ...(key ? { key } : {}),
      ...(event.kind === "fill" && target?.rawTypedValue ? { rawTypedValue: target.rawTypedValue } : {}),
      ...(target?.committedValue ? { committedValue: target.committedValue } : {}),
      ...(target?.displayValue ? { displayValue: target.displayValue } : {}),
      sourceEventRefs: [`event-${index + 1}`],
      technicalTargetRefs: technicalTargetRefsForEvent,
      ...(target?.editingSessionRef ? { editingSessionRef: target.editingSessionRef } : {}),
      ...(selectorControlOf(event, target) ? {
        selectorControlId: selectorControlOf(event, target),
        optionSurfaceId: `${event.screenKey}|${selectorControlOf(event, target)}|option-surface`,
      } : {}),
      ...(target?.observedOptions?.length ? { observedOptions: [...new Set(target.observedOptions)] } : {}),
      ...(technicalTargetCandidates?.length ? { technicalTargetCandidates } : {}),
      ...(technicalTargetCandidates?.some((candidate) => candidate.validatedByInteraction) ? { validatedByInteraction: true } : {}),
      // LAST-RESORT, EXECUTION-ONLY authority; never a technicalTarget/certified owner. Only
      // transported when the eligibility gate above accepted it for THIS action.
      ...(semanticRuntimeEligible && target?.semanticRuntimeEvidence ? { semanticRuntimeEvidence: target.semanticRuntimeEvidence } : {}),
      ...(target?.playwrightRecorderEvidence ? { playwrightRecorderEvidence: target.playwrightRecorderEvidence } : {}),
      // target.label itself is withheld here too when uncertified — it is exactly the
      // ancestor-walk signal that can still reflect the previous screen for a brief window after
      // a transition, so falling back to raw label text would silently reintroduce the stale
      // owner this gate exists to prevent. The human-facing description is only ever built from
      // a resolved semanticField (real structural evidence), never a rejected fallback label —
      // true both when fully accepted and when only runtime-resolution evidence exists.
      ...(semanticField && target?.label ? { description: action === "select" ? `Seleccionar en "${semanticField}"` : `Ingresar en "${semanticField}"` } : {}),
      ...ownership,
      ...(ownerRecertificationRequired ? { ownerRecertificationRequired: true } : {}),
      ...(admissionRejected ? { admissionStatus: "unresolved" as const, admissionReason } : { admissionStatus: "accepted" as const }),
      resolutionState,
      ...(relatedStateSurfaceEvidence ? { relatedStateSurfaceEvidence } : {}),
      ...(derivedDisplayClick ? { technicalOnly: true, postGoalObservation: true } : {}),
      // technicalOnly hides these two raw clicks from the human FUNCTIONAL step list (unchanged,
      // consumed by trace-to-scenario.ts), but executionAuthority:true keeps them as real replay
      // authority in RecordingExecutionContract -- they were genuinely performed against real DOM
      // targets, unlike a derivedDisplayClick.
      ...(selectionCovered && !derivedDisplayClick ? { technicalOnly: true, executionAuthority: true } : {}),
      // The reverse case: a display projection IS shown as its own step, but was never captured
      // against a real DOM target (no locators), so it must never be picked as an executable
      // action in its own right -- its real execution authority is the technicalOnly clicks above.
      ...(isDisplayProjection ? { executionAuthority: false } : {}),
      confidence: target?.locators?.[0]?.confidence ?? 0.7,
    });
  }
  // A compound control (combobox/autocomplete/grid picker) can raise several raw events for
  // ONE physical selection — a click on the option descendant, a change/selection confirmation
  // on the owning control — each with its own raw controlIdentity (built from that specific
  // event's own locator/target). Deduping on controlIdentity alone left these uncollapsed: the
  // OWNER is the same, but its raw pointer-target identity differs per event. selectorControlId
  // (already computed above for any compoundRole="selection" target) is the actionable-owner
  // identity that must be used instead — controlIdentity remains the fallback for non-compound
  // controls, where raw target IS the owner.
  /** Collapse an explicitly captured segmented-input component into one logical action. The
   * browser recorder supplies the group evidence; no DOM ordinal is promoted to authority. */
  const collapseSegmentedInputs = (interactions: CanonicalInteraction[]): CanonicalInteraction[] => {
    const output: CanonicalInteraction[] = [];
    let index = 0;
    while (index < interactions.length) {
      const first = interactions[index];
      const evidence = first.playwrightRecorderEvidence;
      if (first.action !== "fill" || evidence?.kind !== "segmented_input" || !evidence.segmentCount || evidence.segmentCount < 2) {
        output.push(first);
        index += 1;
        continue;
      }
      // FIRST_LOSS fix (recordingId=efff98e2-...): a naive contiguous slice assumed every sibling
      // segment landed back-to-back in the canonical interactions array. Physical evidence showed
      // a technical-only interaction (e.g. a navigation/state-transition bridge) can land between
      // two segment fills without the user ever leaving the OTP box group -- that single
      // interleaved interaction broke the contiguous slice, made every sibling's own group check
      // fail, and left all N boxes as N separate steps each with its own leaked value instead of
      // one merged group. Scan forward collecting only real siblings (same scope+segmentCount),
      // skipping over technicalOnly interactions in between; any other, non-sibling interaction
      // ends the scan without being consumed, so a genuinely different action right after the
      // group is left untouched for the outer loop.
      const group: CanonicalInteraction[] = [];
      const skippedTechnicalOnly: CanonicalInteraction[] = [];
      let scan = index;
      while (scan < interactions.length && group.length < evidence.segmentCount) {
        const candidate = interactions[scan];
        const isSibling = candidate.action === "fill"
          && candidate.playwrightRecorderEvidence?.kind === "segmented_input"
          && candidate.playwrightRecorderEvidence.segmentCount === evidence.segmentCount
          && JSON.stringify(candidate.playwrightRecorderEvidence.scopeIdentity) === JSON.stringify(evidence.scopeIdentity);
        if (isSibling) {
          group.push(candidate);
          scan += 1;
          continue;
        }
        if (candidate.technicalOnly) {
          skippedTechnicalOnly.push(candidate);
          scan += 1;
          continue;
        }
        break;
      }
      const groupIsValid = group.length > 1 && group.length === evidence.segmentCount;
      // A technicalOnly interaction skipped over while scanning for siblings is never itself
      // dropped -- it still carries its own execution authority (e.g. a navigation bridge) that
      // downstream consumers rely on -- it is only reordered to precede the merged step.
      if (groupIsValid) output.push(...skippedTechnicalOnly);
      // FIRST_LOSS fix (recordingId=5416582a-...): this grouping only ever handled a segmented
      // input arriving as `segmentCount` SEPARATE, adjacent raw interactions to merge. Physical
      // evidence showed the browser recorder can ALSO emit the whole segmented input as ONE
      // interaction whose OWN `playwrightRecorderEvidence` already carries the complete
      // `segmentCount`/`runtimeResolutionRequired` evidence (`sourceEventRefs` already spans
      // every segment) -- no sibling interactions ever existed to group, so `groupIsValid` was
      // always false and this fell through to the generic admission path, which (correctly, in
      // isolation) demoted it to `unresolved_unrecoverable` with a generic reason -- silently
      // dropping the entire OTP/token step from the resulting scenario. `evidence.runtimeResolutionRequired`
      // is the browser's own already-computed evidence (never fabricated here) that this single
      // interaction is already complete on its own; only fall through to the generic path when
      // NEITHER a valid sibling group NOR this interaction's own evidence proves it.
      if (!groupIsValid && !evidence.runtimeResolutionRequired) {
        output.push(first);
        index += 1;
        continue;
      }
      const merged = groupIsValid ? group : [first];
      output.push({
        ...first,
        valueKey: first.valueKey ?? evidence.valueKey,
        recordedValue: undefined,
        technicalTargetRefs: [],
        sourceEventRefs: merged.flatMap((candidate) => candidate.sourceEventRefs),
        playwrightRecorderEvidence: { ...evidence, runtimeResolutionRequired: true },
        resolutionState: "runtime_resolution_required",
        admissionStatus: "unresolved",
        admissionReason: "segmented_input_runtime_resolution_required",
      });
      index = groupIsValid ? scan : index + merged.length;
    }
    return output;
  };
  const dedupOwnerIdentity = (interaction: CanonicalInteraction): string => interaction.selectorControlId ?? interaction.controlIdentity;
  // A real recording still produced pairs like: interaction A targets the compound control's
  // own technical/structural owner (e.g. "structural:grid=..."), interaction B targets the
  // selected option's display value (e.g. "Cuentas de Efectivo") — same valueKey, same
  // recordedValue, but selectorControlId/controlIdentity genuinely differ because each was
  // built from that event's own raw target. valueKey alone is never sufficient (two distinct
  // fields could coincidentally share one); requiring that exactly one side additionally
  // carries its own technical target evidence is what proves this is the SAME compound
  // control's owner+option split, not two unrelated fields.
  const hasOwnTechnicalIdentity = (interaction: CanonicalInteraction): boolean => interaction.technicalTargetRefs.length > 0;
  const deduped: CanonicalInteraction[] = [];
  for (const interaction of collapseSegmentedInputs(result)) {
    // Only the IMMEDIATELY PRECEDING pushed interaction is a merge candidate — sequence
    // adjacency is the gesture-cluster proxy: any other functional action (a different
    // selection, a fill, an owned navigation) landing between two same-owner/same-value
    // selections means they are legitimately separate user actions, not one gesture's
    // technical noise, and must never collapse regardless of how similar their identity is.
    const previous = deduped[deduped.length - 1];
    const bothSelectCompatible = interaction.action === "select" && previous?.action === "select";
    // A compound control's OWNER-half tap (the one that opens it) very often carries NO value
    // of its own — the value only appears on the OPTION-half event once something is chosen.
    // Requiring an exact recordedValue match here would permanently block the owner+option
    // merge whenever the owner's raw event has none; two select actions are still
    // value-compatible when at most one side actually carries a recorded value. Two DIFFERENT
    // resolved values (a real correction/reselection, or two unrelated fields) are never
    // treated as compatible.
    const valuesCompatible = previous?.recordedValue === interaction.recordedValue
      || previous?.recordedValue === undefined
      || interaction.recordedValue === undefined;
    const sharedGestureEvidence = bothSelectCompatible
      && previous.entityScope === interaction.entityScope
      && valuesCompatible
      // Same surface, never merged across a transition.
      && previous.screenBeforeRef === interaction.screenBeforeRef
      && !previous.transitionObserved && !interaction.transitionObserved
      // Fail-closed: an unresolved owner/identity is never merged by coincidental value/text
      // match — keep the raw events separate rather than guess they are the same gesture.
      && previous.admissionStatus !== "unresolved" && interaction.admissionStatus !== "unresolved";
    const sameGestureCluster = sharedGestureEvidence && dedupOwnerIdentity(previous) === dedupOwnerIdentity(interaction);
    // The owner+option shape: raw owner identities differ, but the same structured valueKey
    // AND exactly one side has its own technical target — the other is the option/display half
    // of the same gesture, not an independently-identified field.
    const sameCompoundSelectionGesture = sharedGestureEvidence
      && Boolean(previous.valueKey) && previous.valueKey === interaction.valueKey
      && hasOwnTechnicalIdentity(previous) !== hasOwnTechnicalIdentity(interaction);
    if (sameGestureCluster || sameCompoundSelectionGesture) {
      // Order-independent owner survival: whichever side actually carries technical target
      // evidence becomes the retained record — a union of technicalTargetRefs alone would keep
      // the FIRST-pushed interaction's (possibly display-only) controlIdentity/description even
      // when the owner arrived second.
      const keepInteractionAsBase = !hasOwnTechnicalIdentity(previous) && hasOwnTechnicalIdentity(interaction);
      const kept = keepInteractionAsBase ? interaction : previous;
      const other = keepInteractionAsBase ? previous : interaction;
      // OWNER authority: `kept` already carries the field's own valueKey/semanticField (it is
      // the side WITH technical identity). VALUE authority: when the owner's own raw event
      // never carried a value, the option half's recordedValue is what the user actually
      // selected — adopt it here rather than leave the merged action unresolved.
      if (kept.recordedValue === undefined && other.recordedValue !== undefined) {
        kept.recordedValue = other.recordedValue;
      }
      kept.sourceEventRefs = [...new Set([...previous.sourceEventRefs, ...interaction.sourceEventRefs])];
      kept.technicalTargetRefs = [...new Set([...previous.technicalTargetRefs, ...interaction.technicalTargetRefs])];
      deduped[deduped.length - 1] = kept;
      continue;
    }
    deduped.push(interaction);
  }
  return reconcileOptionOwnerLineage(deduped);
}

/**
 * FIRST_LOSS fix (jobId 73e597f1-1312-48ba-b422-66ffdf9b091d): a transient overlay option's raw
 * CLICK event has no real DOM field ancestor to climb from (it renders in a portal), so its own
 * `semanticField` (computed per-event, from ITS OWN target) silently fell back to the option's own
 * display label instead of the owning field's name. The click survives as its own interaction (it
 * carries real technical identity of its own, so the owner+option merge in
 * `buildCanonicalInteractions` correctly does not collapse it into the owner). But the SAME
 * physical selection is ALSO captured as a separate `action: "select"` interaction -- built from a
 * different raw event, never executed on its own (`executionAuthority: false`) -- which already
 * carries the CORRECT owner `semanticField` and the exact `recordedValue` the option click's own
 * (wrong) semanticField happens to equal. That equality is real captured evidence (both sides
 * independently observed the same value), not a guess: it corrects the click's semanticField in
 * place, never touching its target/technical identity/execution authority. No previous-step/
 * positional/DOM-index signal is used.
 *
 * Exported (jobId 662dad69-f0e5-480b-ba94-c23301713d72 gap) so a caller holding a PREVIOUSLY
 * persisted `canonicalInteractions` array -- computed before this fix existed, or copied forward
 * by a rerun that reuses a prior job's own materialized snapshot rather than re-deriving from the
 * raw recording trace -- can re-apply the CURRENT reconciliation rules to data it already has,
 * without re-running Discovery or losing any already-captured technicalTargetRefs/recordedValue.
 */
export function reconcileOptionOwnerLineage<T extends { id?: string; action: string; semanticField?: string; recordedValue?: string; screenBeforeRef?: string }>(
  interactions: readonly T[],
): T[] {
  const selectSiblingsByValue = new Map<string, T[]>();
  for (const interaction of interactions) {
    if (interaction.action !== "select") continue;
    const value = clean(interaction.recordedValue);
    if (!value || !interaction.semanticField) continue;
    const key = `${interaction.screenBeforeRef ?? ""}|${value}`;
    const bucket = selectSiblingsByValue.get(key) ?? [];
    bucket.push(interaction);
    selectSiblingsByValue.set(key, bucket);
  }
  return interactions.map((interaction) => {
    if (interaction.action === "select" || !interaction.semanticField) return interaction;
    const key = `${interaction.screenBeforeRef ?? ""}|${clean(interaction.semanticField) ?? ""}`;
    const siblings = selectSiblingsByValue.get(key);
    // Only when EXACTLY one same-screen select sibling recorded this exact value is the owner
    // unambiguous -- more than one candidate owner, or none, leaves semanticField untouched
    // rather than guessing.
    if (siblings?.length !== 1) return interaction;
    const owner = siblings[0];
    if (owner.semanticField && owner.semanticField !== interaction.semanticField) {
      return { ...interaction, semanticField: owner.semanticField };
    }
    return interaction;
  });
}

/**
 * FIRST_LOSS fix (jobId 60a1f392-ffb9-4b0b-bc91-96ad63bac82d): `reconcileOptionOwnerLineage` was
 * only ever wired into ONE consumer (`rerun-runner.ts`'s `virtualCaseToScenario`) -- a genuinely
 * FRESH scenario-preview job (no `sourceJobId`, never touches rerun-runner.ts at all) still reads
 * its scenario's `canonicalInteractions`/`recordingExecutionContract` straight from
 * `recording-store.ts`'s `loadScenarios`, which returns whatever was persisted to
 * `scenarios.json` the one time this recording was originally derived -- before this
 * reconciliation rule existed, for any recording derived before it landed. Rather than scatter
 * the same interactionId-join logic across every caller of `loadScenarios` (a second/parallel
 * copy of this reconciliation, and easy to miss one), this single exported helper joins a
 * `RecordingExecutionAction[]` back to its (now-reconciled) `CanonicalInteraction[]` by the
 * stable `interactionId`/`CanonicalInteraction.id` identity -- never index/position -- so ONE
 * caller at the true read boundary (`loadScenarios`) covers every consumer.
 */
export function reconcileRecordingExecutionContractLineage<
  I extends { id?: string; action: string; semanticField?: string; recordedValue?: string; screenBeforeRef?: string },
  A extends { interactionId?: string; semanticField?: string; associatedField?: string },
>(
  canonicalInteractions: readonly I[] | undefined,
  actions: readonly A[] | undefined,
): { canonicalInteractions: readonly I[] | undefined; actions: readonly A[] | undefined } {
  if (!canonicalInteractions?.length) return { canonicalInteractions, actions };
  const reconciledInteractions = reconcileOptionOwnerLineage(canonicalInteractions);
  if (!actions?.length) return { canonicalInteractions: reconciledInteractions, actions };
  const semanticFieldByInteractionId = new Map(
    reconciledInteractions.map((interaction) => [interaction.id, interaction.semanticField] as const),
  );
  const reconciledActions = actions.map((action) => {
    if (!action.interactionId) return action;
    const semanticField = semanticFieldByInteractionId.get(action.interactionId);
    if (!semanticField || (semanticField === action.semanticField && semanticField === action.associatedField)) return action;
    return { ...action, semanticField, associatedField: semanticField };
  });
  return { canonicalInteractions: reconciledInteractions, actions: reconciledActions };
}

export function validateInteractionStateSequence(interactions: readonly CanonicalInteraction[]): StateSequenceValidation {
  // Navigation/state-transition evidence is part of the reachability proof even though it is
  // not a user step. It must bridge route A -> loading -> route B for the next real action.
  const executable = interactions.filter((interaction) => interaction.action !== "system_observation"
    && (!interaction.technicalOnly || interaction.action === "navigation"));
  const issues: string[] = [];
  for (let index = 1; index < executable.length; index += 1) {
    const previous = executable[index - 1];
    const current = executable[index];
    const sameRoute = !previous.routeAfter || !current.routeBefore || previous.routeAfter === current.routeBefore;
    if (previous.screenAfterRef && current.screenBeforeRef && previous.screenAfterRef !== current.screenBeforeRef && !sameRoute) {
      issues.push(`${previous.id}:${previous.screenAfterRef}->${current.id}:${current.screenBeforeRef}`);
      continue;
    }
    if (previous.routeAfter && current.routeBefore && previous.routeAfter !== current.routeBefore) {
      issues.push(`${previous.id}:${previous.routeAfter}->${current.id}:${current.routeBefore}`);
    }
  }
  return { stateSequenceValid: issues.length === 0, stateSequenceIssues: issues };
}

function requirementFromField(
  field: RecordedDataField,
  canonical?: CanonicalInteraction,
  canonicalValueOverride?: string | null,
): RuntimeInputRequirement {
  const persistedValue = clean(field.exampleValue) ?? null;
  const derived = field.valueRole === "runtime_derived_oracle";
  const canonicalValue = canonicalValueOverride !== undefined
    ? canonicalValueOverride === null ? null : clean(canonicalValueOverride) ?? null
    : clean(canonical?.recordedValue) ?? clean(canonical?.committedValue) ?? null;
  const value = canonicalValue ?? persistedValue;
  const canonicalAuthority = clean(canonical?.recordedValue)
    ? "canonical_logical" as const
    : canonicalValue
      ? "canonical_committed" as const
      : undefined;
  const datasetAuthorityMismatch = Boolean(
    canonicalValue !== null
      && persistedValue !== null
      && persistedValue.trim().toLocaleLowerCase() !== canonicalValue.trim().toLocaleLowerCase(),
  );
  return {
    valueKey: field.key,
    semanticField: field.semanticField ?? field.label ?? null,
    ...(field.entityScope ? { entityScope: field.entityScope } : {}),
    valueRole: field.valueRole ?? (field.sensitive ? "secure_input" : "action_input"),
    required: !derived,
    value,
    source: derived ? "RECORDED_CONFIRMED" : value === null ? "unresolved" : field.source === "secure" ? "secure" : "RECORDED_CONFIRMED",
    resolved: derived || value !== null,
    sensitive: field.sensitive,
    stepIndex: field.stepIndex,
    ...(field.formatHint ? { controlType: field.formatHint } : {}),
    ...(field.constraints?.length ? { constraints: field.constraints } : {}),
    ...(field.allowedValues?.length ? { allowedValues: [...field.allowedValues] } : {}),
    ...(field.validatedByInteraction ? { validatedByInteraction: true } : {}),
    readOnly: derived || field.repeatClonePolicy === "SYSTEM_GENERATED",
    computed: derived,
    systemGenerated: field.repeatClonePolicy === "SYSTEM_GENERATED",
    masked: field.sensitive,
    editable: !derived && field.repeatClonePolicy !== "SYSTEM_GENERATED",
    ...(canonicalAuthority ? { authority: canonicalAuthority, authorityValue: canonicalValue, datasetAuthorityMismatch } : {
      authority: value === null ? "unresolved" : "recorded_confirmed",
      authorityValue: null,
      datasetAuthorityMismatch: false,
    }),
  };
}

function comparableValueKey(valueKey: string): string {
  return valueKey.replace(/_valor$/, "");
}

function canonicalForField(field: RecordedDataField, interactions: readonly CanonicalInteraction[]): CanonicalInteraction | undefined {
  const exact = interactions.find((interaction) => interaction.valueKey === field.key && (interaction.action === "fill" || interaction.action === "select"));
  if (exact) return exact;
  const comparable = comparableValueKey(field.key);
  return interactions.find((interaction) => {
    if (interaction.action !== "fill" && interaction.action !== "select") return false;
    const interactionKey = interaction.valueKey ? comparableValueKey(interaction.valueKey) : "";
    if (interactionKey && interactionKey === comparable) return true;
    return Boolean(interaction.entityScope === field.entityScope
      && interaction.semanticField
      && field.semanticField
      && interaction.semanticField === field.semanticField);
  });
}

function canonicalLogicalValueForField(
  field: RecordedDataField,
  interactions: readonly CanonicalInteraction[],
): string | null | undefined {
  const canonical = canonicalForField(field, interactions);
  if (!canonical) return undefined;
  const value = clean(canonical.recordedValue) ?? clean(canonical.committedValue);
  if (canonical.action !== "fill" || !canonical.valueKey?.endsWith("_valor")) return value;
  const selection = interactions.find((interaction) => interaction.action === "select"
    && interaction.entityScope === canonical.entityScope
    && interaction.semanticField === canonical.semanticField
    && clean(interaction.recordedValue));
  if (!selection) return value;
  // A compound amount is authoritative only as the child value. If the source
  // exposes only an aggregate, keep it unresolved rather than promoting display text.
  return logicalCompoundChildValue(value, selection.recordedValue)
    ?? (value === clean(selection.recordedValue) ? null : value);
}

export function materializeRuntimeInputRequirements(
  scenario: Pick<RecordedScenario, "requiredData"> & { canonicalInteractions?: CanonicalInteraction[] },
): RuntimeInputRequirement[] {
  const byKey = new Map<string, RuntimeInputRequirement>();
  const scopedSuffixes = new Set(scenario.requiredData
    .map((field) => field.key)
    .filter((key) => key.includes("."))
    .map((key) => key.slice(key.indexOf(".") + 1)));
  for (const field of scenario.requiredData) {
    // Old persisted scenarios could contain both `field` and `entity_1.field`. Once the
    // scoped canonical key exists, the unscoped entry is a migration alias, not another
    // logical runtime input.
    if (!field.key.includes(".") && scopedSuffixes.has(field.key)) continue;
    const interactions = scenario.canonicalInteractions ?? [];
    const requirement = requirementFromField(
      field,
      canonicalForField(field, interactions),
      canonicalLogicalValueForField(field, interactions),
    );
    if (requirement.valueRole === "runtime_derived_oracle" && !requirement.readOnly) continue;
    const previous = byKey.get(requirement.valueKey);
    if (!previous) {
      byKey.set(requirement.valueKey, requirement);
      continue;
    }
    byKey.set(requirement.valueKey, {
      ...previous,
      value: previous.value ?? requirement.value,
      resolved: previous.resolved || requirement.resolved,
      source: previous.resolved ? previous.source : requirement.source,
      technicalTargetRefs: [...new Set([...(previous.technicalTargetRefs ?? []), ...(requirement.technicalTargetRefs ?? [])])],
      sourceEventRefs: [...new Set([...(previous.sourceEventRefs ?? []), ...(requirement.sourceEventRefs ?? [])])],
      validatedByInteraction: previous.validatedByInteraction || requirement.validatedByInteraction,
      authority: previous.authority ?? requirement.authority,
      authorityValue: previous.authorityValue ?? requirement.authorityValue,
      datasetAuthorityMismatch: previous.datasetAuthorityMismatch || requirement.datasetAuthorityMismatch,
      constraints: previous.constraints ?? requirement.constraints,
      editable: previous.editable || requirement.editable,
      readOnly: previous.readOnly || requirement.readOnly,
      computed: previous.computed || requirement.computed,
      systemGenerated: previous.systemGenerated || requirement.systemGenerated,
      masked: previous.masked || requirement.masked,
    });
  }
  return [...byKey.values()];
}

/** Applies the single QA dataset authority and recalculates all readiness dimensions. */
export function applyRuntimeDatasetValues(
  scenario: RecordedScenario,
  values: Readonly<Record<string, string | undefined>>,
): RecordedScenario {
  const persistedValues = scenario.runtimeDataset?.resolvedValues ?? {};
  const persistedQaValues = Object.fromEntries((scenario.runtimeInputRequirements ?? [])
    .filter((requirement) => requirement.authority === "explicit_qa_edit" && typeof requirement.value === "string")
    .map((requirement) => [requirement.valueKey, requirement.value!] as const));
  const repeatLineageValues = scenario.mutation?.mutationType === "REPEAT_ENTITY"
    ? Object.fromEntries((scenario.runtimeInputRequirements ?? [])
      .filter((requirement) => requirement.sourceValueKey && persistedValues[requirement.sourceValueKey] !== undefined)
      .map((requirement) => [requirement.valueKey, persistedValues[requirement.sourceValueKey!]] as const))
    : {};
  // A derived repeat scenario may already contain a confirmed base dataset. Preserve that
  // authority for the source entity and its clones; canonical capture values remain the
  // authority for the primary scenario and for explicit QA edits.
  // Explicit QA edits outrank cloned lineage on every rehydration. The lineage remains
  // the fallback only until QA supplies the editable target value.
  const effectiveValues = { ...(scenario.mutation?.mutationType === "REPEAT_ENTITY" ? persistedValues : {}), ...repeatLineageValues, ...persistedQaValues, ...values };
  const requiredData = scenario.requiredData.map((field) => {
    // QA overrides belong to the effective runtime dataset only. Do not rewrite the
    // captured field/example value, which is part of the canonical recording contract.
    if (persistedQaValues[field.key] !== undefined || values[field.key] !== undefined) return field;
    const canonicalValue = canonicalLogicalValueForField(field, scenario.canonicalInteractions ?? []) ?? null;
    return canonicalValue === null ? field : { ...field, exampleValue: canonicalValue, source: "RECORDED_CONFIRMED" as const };
  });
  const materializedRequirements = materializeRuntimeInputRequirements({ ...scenario, requiredData });
  const existingLineage = new Map((scenario.runtimeInputRequirements ?? []).map((requirement) => [requirement.valueKey, requirement]));
  const runtimeInputRequirements = materializedRequirements.map((requirement) => {
    const lineage = existingLineage.get(requirement.valueKey);
    const withLineage = lineage ? {
      ...requirement,
      ...(lineage.sourceValueKey ? { sourceValueKey: lineage.sourceValueKey } : {}),
      ...(lineage.sourceAuthority ? { sourceAuthority: lineage.sourceAuthority } : {}),
      ...(lineage.repeatCloneDisposition ? { repeatCloneDisposition: lineage.repeatCloneDisposition } : {}),
      ...(lineage.authority ? { authority: lineage.authority } : {}),
      ...(lineage.authorityValue !== undefined ? { authorityValue: lineage.authorityValue } : {}),
    } : requirement;
    const explicitQaEdit = values[requirement.valueKey] !== undefined
      || withLineage.authority === "explicit_qa_edit"
      || isQaEditSource(withLineage.source);
    const qaOverridable = isQaOverridableRuntimeInput(withLineage);
    return effectiveValues[requirement.valueKey] === undefined ? withLineage : {
       ...withLineage,
       value: effectiveValues[requirement.valueKey] ?? null,
       source: (explicitQaEdit ? "CURRENT_QA_EDIT" : requirement.source === "secure" ? "secure" : "RECORDED_CONFIRMED") as RuntimeInputRequirement["source"],
       resolved: effectiveValues[requirement.valueKey] !== undefined,
       authority: values[requirement.valueKey] !== undefined || withLineage.authority === "explicit_qa_edit"
         ? "explicit_qa_edit" as const
         : "recorded_confirmed" as const,
       authorityValue: effectiveValues[requirement.valueKey] ?? null,
       editable: qaOverridable,
       readOnly: qaOverridable ? false : true,
       masked: withLineage.sensitive === true || withLineage.masked === true,
       ...(explicitQaEdit && withLineage.entityScope && scenario.mutation?.mutationType === "REPEAT_ENTITY"
         ? { sourceAuthority: "EXPLICIT_MUTATION" as const }
         : {}),
        datasetAuthorityMismatch: false,
     };
  });
  const uniqueConstraintResolutions = scenario.mutation?.mutationType === "REPEAT_ENTITY"
    ? revalidateRepeatUniqueConstraints(runtimeInputRequirements, scenario.repeatConstraintResolutions ?? [])
    : { requirements: runtimeInputRequirements, resolutions: scenario.repeatConstraintResolutions ?? [], valid: true };
  const validatedRuntimeInputRequirements = uniqueConstraintResolutions.requirements;
  const readiness = evaluateRecordingReadiness({
    functionalReadiness: scenario.functionalReadiness !== false && scenario.testRailSteps.length > 0,
    technicalReadiness: scenario.technicalReadiness !== false && !scenario.hasUncertainSteps,
    oracleReadiness: scenario.oracleAuthority !== "review_required"
      || (scenario.reviewStatus === "APPROVED" && Boolean(scenario.reviewedExpectedResult?.trim())),
    runtimeInputRequirements: validatedRuntimeInputRequirements,
    publicationRequiresOracle: true,
  });
  const valuesByKey = new Map(
    validatedRuntimeInputRequirements
      .filter((requirement) => typeof requirement.value === "string")
      .map((requirement) => [requirement.valueKey, requirement.value!] as const),
  );
  const testRailSteps = scenario.testRailSteps.map((step) => {
    if (!step.valueKey) return step;
    const value = valuesByKey.get(step.valueKey);
    if (value === undefined) return step;
    const template = step.stepTemplate ?? step.content;
    return { ...step, renderedStep: renderHumanStepValue(template, step.valueKey, value) };
  });
  const existingDiagnostics = scenario.mutationDiagnostics;
  const mutationDiagnostics = scenario.mutation?.mutationType === "REPEAT_ENTITY"
    ? {
      ...existingDiagnostics,
      ...(uniqueConstraintResolutions.valid && existingDiagnostics?.rejectionReason === "RUNTIME_DATA_CONSTRAINT_VIOLATION"
        ? { rejectionReason: undefined }
        : !uniqueConstraintResolutions.valid
          ? { rejectionReason: "RUNTIME_DATA_CONSTRAINT_VIOLATION" as const }
          : {}),
    }
    : existingDiagnostics;
  const mutationRejected = Boolean(mutationDiagnostics?.rejectionReason);
  const effectfulReadiness = mutationRejected
    ? { ...readiness, publicationContentReadiness: false, publicationReadiness: false }
    : readiness;
  const runtimeExecutionBlockedByData = scenario.mutation?.mutationType === "REPEAT_ENTITY"
    && (!uniqueConstraintResolutions.valid || validatedRuntimeInputRequirements.some((requirement) => requirement.required && !requirement.resolved));
  return {
    ...scenario,
    requiredData,
    runtimeInputRequirements: validatedRuntimeInputRequirements,
    runtimeDataset: buildScenarioRuntimeDataset({ ...scenario, requiredData, runtimeInputRequirements: validatedRuntimeInputRequirements }),
    testRailSteps,
    readiness: effectfulReadiness,
    functionalReadiness: effectfulReadiness.functionalReadiness,
    technicalReadiness: effectfulReadiness.technicalReadiness,
    ...(scenario.mutation?.mutationType === "REPEAT_ENTITY" ? {
      mutationDiagnostics,
      repeatConstraintResolutions: uniqueConstraintResolutions.resolutions,
      runtimeExecutionBlockedByData,
      replayEligible: !mutationRejected,
    } : {}),
  };
}

/** Re-checks the runtime-supplied value against the active entity collection. */
function revalidateRepeatUniqueConstraints(
  requirements: readonly RuntimeInputRequirement[],
  existingResolutions: readonly ConstraintResolution[],
): { requirements: RuntimeInputRequirement[]; resolutions: ConstraintResolution[]; valid: boolean } {
  const uniqueRequirements = requirements.filter((requirement) =>
    (requirement.constraints ?? []).some(isUniqueWithinCollection),
  );
  if (uniqueRequirements.length === 0) return { requirements: [...requirements], resolutions: [...existingResolutions], valid: true };
  const resolutions = existingResolutions.map((resolution) => ({ ...resolution }));
  let valid = true;
  const updated = requirements.map((requirement) => {
    const constraint = (requirement.constraints ?? []).find(isUniqueWithinCollection);
    if (!constraint) return requirement;
    const current = clean(requirement.value);
    const logicalKey = logicalFieldKey(requirement.valueKey);
    const activeValues = new Set(requirements
      .filter((candidate) => candidate.valueKey !== requirement.valueKey && logicalFieldKey(candidate.valueKey) === logicalKey)
      .map((candidate) => clean(candidate.value))
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLocaleLowerCase()));
    const distinct = Boolean(current) && !activeValues.has(current.toLocaleLowerCase());
    const previous = resolutions.find((resolution) => resolution.valueKey === requirement.valueKey);
    const nextResolution: ConstraintResolution = {
      valueKey: requirement.valueKey,
      constraintType: constraint.type,
      activeValueCount: activeValues.size,
      candidateCount: current ? Math.max(1, previous?.candidateCount ?? 0) : previous?.candidateCount ?? 0,
      distinctCandidateCount: distinct ? 1 : 0,
      resolutionSource: requirement.authority === "explicit_qa_edit" ? "runtime_dataset" : previous?.resolutionSource ?? "none",
      resolved: distinct,
    };
    const index = resolutions.findIndex((resolution) => resolution.valueKey === requirement.valueKey);
    if (index >= 0) resolutions[index] = nextResolution;
    else resolutions.push(nextResolution);
    valid &&= distinct;
    return distinct
      ? { ...requirement, resolved: true, editable: requirement.editable ?? false }
      : {
        ...requirement,
        resolved: false,
        source: "unresolved" as const,
        editable: true,
        authority: requirement.authority === "explicit_qa_edit" ? "explicit_qa_edit" as const : "unresolved" as const,
        authorityValue: current,
        sourceAuthority: "UNRESOLVED" as const,
      };
  });
  return { requirements: updated, resolutions, valid };
}

export function evaluateRecordingReadiness(input: {
  functionalReadiness: boolean;
  technicalReadiness: boolean;
  oracleReadiness: boolean;
  publicationContentReadiness?: boolean;
  runtimeInputRequirements: RuntimeInputRequirement[];
  publicationRequiresOracle?: boolean;
}): RecordingReadiness {
  const missingByKey = new Map<string, RuntimeInputRequirement>();
  for (const requirement of input.runtimeInputRequirements) {
    if (requirement.required && !requirement.resolved && !missingByKey.has(requirement.valueKey)) missingByKey.set(requirement.valueKey, requirement);
  }
  const missingInputs = [...missingByKey.values()];
  const mismatchByKey = new Map<string, RuntimeInputRequirement>();
  for (const requirement of input.runtimeInputRequirements) {
    if (requirement.datasetAuthorityMismatch && !mismatchByKey.has(requirement.valueKey)) mismatchByKey.set(requirement.valueKey, requirement);
  }
  const datasetAuthorityMismatches = [...mismatchByKey.values()];
  const dataReadiness = missingInputs.length === 0 && datasetAuthorityMismatches.length === 0;
  const runtimeDataRequired = missingInputs.some((requirement) =>
    requirement.source === "unresolved"
    || requirement.authority === "unresolved"
    || requirement.sourceAuthority === "UNRESOLVED"
  );
  const dataReadinessReasons = [
    ...missingInputs.map((requirement) => `missing_runtime_input:${requirement.valueKey}`),
    ...(runtimeDataRequired ? ["RUNTIME_DATA_REQUIRED"] : []),
    ...(datasetAuthorityMismatches.length > 0 ? ["dataset_authority_mismatch"] : []),
  ];
  const executionReadiness = input.functionalReadiness && dataReadiness && input.technicalReadiness;
  const publicationContentReadiness = input.publicationContentReadiness ?? input.functionalReadiness;
  return {
    functionalReadiness: input.functionalReadiness,
    dataReadiness,
    technicalReadiness: input.technicalReadiness,
    oracleReadiness: input.oracleReadiness,
    reviewReadiness: input.oracleReadiness,
    publicationContentReadiness,
    executionReadiness,
    publicationReadiness: input.functionalReadiness && dataReadiness && publicationContentReadiness,
    missingInputs,
    datasetAuthorityMismatches,
    dataReadinessReasons,
  };
}

function stepEntityScope(step: { entityScope?: string; valueKey?: string }): string | undefined {
  const valueKey = clean(step.valueKey);
  return clean(step.entityScope) ?? (valueKey?.includes(".") ? clean(valueKey.split(".")[0]) : undefined);
}

export function buildEntityActionBlocks(
  scenario: Pick<RecordedScenario, "requiredData" | "testRailSteps" | "sourceRecordingId"> & { canonicalInteractions?: CanonicalInteraction[] },
  interactions: CanonicalInteraction[],
  technicalKnowledgeRefs: string[] = [],
): EntityActionBlock[] {
  const scopes = new Set<string>();
  scenario.requiredData.forEach((field) => { if (field.entityScope) scopes.add(field.entityScope); });
  scenario.testRailSteps.forEach((step) => { const scope = stepEntityScope(step); if (scope) scopes.add(scope); });
  return [...scopes].map((entityScope) => {
    const firstEntityIndex = interactions.findIndex((interaction) => interaction.entityScope === entityScope);
    const stateBoundary = firstEntityIndex >= 0
      ? interactions.findIndex((interaction, index) => index > firstEntityIndex && interaction.causedTransition)
      : -1;
    // Entity ownership is the form/context block, not every later row action in the
    // recording. A post-transition action remains in Primary but is not cloned into entity_2.
    const semanticActions = interactions.filter((interaction, index) => interaction.entityScope === entityScope
      && (stateBoundary < 0 || index <= stateBoundary));
    const dataRequirements = materializeRuntimeInputRequirements(scenario).filter((requirement) => requirement.entityScope === entityScope);
    const relevantRefs = new Set(semanticActions.flatMap((interaction) => interaction.sourceEventRefs.map((ref) => {
      const match = ref.match(/^event-(\d+)$/);
      return match ? `obs-${match[1]}` : ref;
    })));
    return {
      entityScope,
      semanticActions,
      dataRequirements: dataRequirements.filter((requirement) => requirement.valueRole !== "runtime_derived_oracle"),
      runtimeDerivedOracles: dataRequirements.filter((requirement) => requirement.valueRole === "runtime_derived_oracle"),
      technicalKnowledgeRefs: technicalKnowledgeRefs.filter((ref) => relevantRefs.has(ref)),
    };
  });
}

function hasRepeatEvidence(model?: SemanticRecordingModel): boolean {
  const repeatLabel = /repeat|repetir|\badd\b|agregar|a\u00f1adir|anadir|another|\botro\b|duplicar/i;
  const technical = model?.technicalObservations.some((observation) => {
    const label = observation.label?.trim() ?? "";
    const text = [label, observation.associatedField, ...(observation.dynamicLifecycle?.mutationSummary ?? [])].filter(Boolean).join(" ");
    return (label.length <= 80 || Boolean(observation.associatedField && observation.associatedField.length <= 80))
      && repeatLabel.test(text);
  });
  const components = model?.semanticComponents.some((component) => (component.label?.length ?? 0) <= 80 && repeatLabel.test(component.label ?? ""));
  return Boolean(technical || components);
}

function humanizeGoal(value: string): string {
  const words = value.trim().replace(/[_.\/-]+/g, " ").replace(/\s+/g, " ").toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "Recorrido grabado";
}

function humanMutationTitle(primary: RecordedScenario, mutationType: MutationType, entityType?: string, alternativeValue?: string): string {
  const goal = humanizeGoal(primary.scenarioGoal?.trim() || primary.title.trim());
  const subject = humanizeGoal(entityType?.trim() || "entidades");
  if (mutationType === "REPEAT_ENTITY") return `${goal}: registrar varias ${subject.toLowerCase()} en un mismo proceso`;
  if (mutationType === "ZERO_ENTITY") return `${goal}: comprobar el proceso sin registrar ${subject.toLowerCase()}`;
  if (mutationType === "ALTERNATIVE_SELECTION" && alternativeValue?.trim()) return `${goal}: registrar usando ${alternativeValue.trim()}`;
  if (mutationType === "ALTERNATIVE_SELECTION") return `${goal}: comprobar una opción observada alternativa`;
  if (mutationType === "FIELD_OMISSION") return `${goal}: comprobar la omisión de un dato`;
  return `${goal}: comprobar una variante del proceso`;
}

export function detectMutationOpportunities(
  primary: RecordedScenario,
  model?: SemanticRecordingModel,
): MutationOpportunity[] {
  const blocks = primary.entityActionBlocks ?? [];
  const opportunities: MutationOpportunity[] = [];
  const primaryEvents = primary.sourceEventRefs ?? [];
  if (blocks.length > 0 && hasRepeatEvidence(model)) {
    const source = blocks[0];
    const repeatLabel = /repeat|repetir|\badd\b|agregar|a\u00f1adir|anadir|another|\botro\b|duplicar/i;
    const sourceScreen = source.semanticActions.at(-1)?.screenBeforeRef;
    const affordance = model?.technicalObservations.find((observation) => observation.screenIdentity === sourceScreen
      && (observation.label?.length ?? 0) <= 80
      && Boolean(observation.locatorCandidates.length)
      && repeatLabel.test(observation.label ?? ""))
      ?? model?.technicalObservations.find((observation) => (observation.label?.length ?? 0) <= 80
        && Boolean(observation.locatorCandidates.length)
        && repeatLabel.test(observation.label ?? ""))
      ?? model?.technicalObservations.find((observation) => (observation.associatedField?.length ?? 0) <= 80
        && Boolean(observation.locatorCandidates.length)
        && repeatLabel.test(observation.associatedField ?? ""));
    const repeatAction: CanonicalInteraction = {
      id: `repeat-affordance-${affordance?.observationId ?? "observed"}`,
      controlIdentity: affordance?.technicalTargetRef ?? "observed-repeat-affordance",
      action: "click",
      sourceEventRefs: affordance ? [affordance.observationId] : [],
      technicalTargetRefs: affordance?.locatorCandidates.map((locator) => `${locator.strategy}:${locator.value}`) ?? [],
      screenBeforeRef: affordance?.screenIdentity ?? sourceScreen,
      screenAfterRef: affordance?.screenIdentity ?? sourceScreen,
      ...(affordance ? { routeBefore: model?.semanticScreens.find((screen) => screen.screenIdentity === affordance.screenIdentity)?.url } : {}),
      ...(affordance ? { routeAfter: model?.semanticScreens.find((screen) => screen.screenIdentity === affordance.screenIdentity)?.url } : {}),
      stateScope: affordance?.screenIdentity,
      goalRelevant: true,
      ...(affordance?.label ? { description: `Presionar "${affordance.label}"` } : {}),
      confidence: affordance?.confidence ?? 0.7,
    };
    opportunities.push({
      opportunityId: `${primary.scenarioId}:repeat_entity`,
      title: humanMutationTitle(primary, "REPEAT_ENTITY", source.entityType),
      mutationType: "REPEAT_ENTITY",
      basePrimaryScenarioId: primary.scenarioId,
      operations: [
        { type: "insert_action", action: repeatAction, afterInteractionId: source.semanticActions.at(-1)?.id },
        { type: "clone_entity", sourceEntityScope: source.entityScope, targetEntityScope: `${source.entityScope.replace(/[_-]?\d+$/, "") || source.entityScope}_2` },
      ],
      evidenceRefs: primaryEvents,
      rationale: "El recorrido observó un affordance de repetición/agregado y existe un bloque de entidad completo.",
      oracleAuthority: "MISSING",
      confidence: 0.8,
      needsReview: true,
    });
  }
  if (blocks.length > 0 && primary.testRailSteps.some((step) => /final|continuar|guardar|enviar|confirmar/i.test(step.content))) {
    opportunities.push({
      opportunityId: `${primary.scenarioId}:zero_entity`,
      title: humanMutationTitle(primary, "ZERO_ENTITY", blocks[0].entityType),
      mutationType: "ZERO_ENTITY",
      basePrimaryScenarioId: primary.scenarioId,
      operations: [{ type: "remove_entity", entityScope: blocks[0].entityScope }],
      evidenceRefs: primaryEvents,
      rationale: "La grabación alcanzó una acción final desde el contexto de la entidad; el resultado de omitirla requiere revisión.",
      oracleAuthority: "MISSING",
      confidence: 0.55,
      needsReview: true,
    });
  }
  const actionInputs = materializeRuntimeInputRequirements(primary).filter((requirement) => requirement.valueRole === "action_input");
  if (actionInputs.length > 1) {
    opportunities.push({
      opportunityId: `${primary.scenarioId}:field_omission`,
      title: humanMutationTitle(primary, "FIELD_OMISSION"),
      mutationType: "FIELD_OMISSION",
      basePrimaryScenarioId: primary.scenarioId,
      operations: [{ type: "remove_action", interactionId: primary.canonicalInteractions?.find((interaction) => interaction.valueKey === actionInputs[0].valueKey)?.id ?? "" }],
      evidenceRefs: primaryEvents,
      rationale: "Existen varios inputs observados; se propone una omisión agrupada sin inventar el resultado.",
      oracleAuthority: "MISSING",
      confidence: 0.5,
      needsReview: true,
    });
  }
  // Options are scoped to the selector/surface that opened them. A selected option's label
  // is not itself an inventory, and no global option pool is allowed to manufacture a
  // replacement for another control.
  const legacyInventories = (model?.selectorOptionInventories?.length ? [] : (model?.technicalObservations ?? []).map((observation) => ({
    selectorRef: observation.selectorControlId ?? observation.technicalTargetRef,
    semanticField: observation.semanticField ?? null,
    ...(observation.entityScope ? { entityScope: observation.entityScope } : {}),
    surfaceRef: observation.optionSurfaceId ?? observation.technicalTargetRef,
    options: [...new Set(observation.observedOptions ?? observation.dynamicLifecycle?.options ?? [])].filter(Boolean),
    ...(observation.dynamicLifecycle?.selectedOption ?? observation.afterValue ? { selectedOption: observation.dynamicLifecycle?.selectedOption ?? observation.afterValue } : {}),
    observationRefs: [observation.observationId],
  }))) ?? [];
  const inventories = model?.selectorOptionInventories?.length ? model.selectorOptionInventories : legacyInventories;
  const alternatives = inventories.flatMap((inventory) => {
    if (inventory.options.length < 2) return [];
    const primarySelection = primary.canonicalInteractions?.find((interaction) => interaction.action === "select"
      && (model?.selectorOptionInventories?.length
        ? interaction.selectorControlId === inventory.selectorRef && interaction.optionSurfaceId === inventory.surfaceRef
        : true)
      && (interaction.semanticField ?? null) === inventory.semanticField
      && (!inventory.entityScope || interaction.entityScope === inventory.entityScope));
    if (!primarySelection) return [];
    const selected = inventory.selectedOption ?? primarySelection.recordedValue;
    if (!selected) return [];
    return inventory.options
      .filter((option) => option !== selected)
      .map((option) => ({ inventory, primarySelection, option }));
  });
  if (alternatives.length > 0) {
    const alternative = alternatives[0];
    opportunities.push({
      opportunityId: `${primary.scenarioId}:alternative_selection`,
      title: humanMutationTitle(primary, "ALTERNATIVE_SELECTION", undefined, alternative.option),
      mutationType: "ALTERNATIVE_SELECTION",
      basePrimaryScenarioId: primary.scenarioId,
      operations: [{ type: "replace_selection", interactionId: alternative.primarySelection.id, value: alternative.option }],
      evidenceRefs: alternative.inventory.observationRefs,
      rationale: "La opción alternativa fue observada técnicamente en la misma superficie de selección.",
      oracleAuthority: "MISSING",
      confidence: 0.75,
      needsReview: true,
    });
  }
  return opportunities;
}

function scopedKey(valueKey: string, targetScope: string): string {
  const parts = valueKey.split(".");
  return parts.length > 1 ? `${targetScope}.${parts.slice(1).join(".")}` : `${targetScope}.${valueKey}`;
}

export function classifyRepeatFieldForClone(field: Pick<RecordedDataField, "valueRole" | "sensitive" | "repeatClonePolicy">): RepeatFieldCloneDisposition {
  if (field.repeatClonePolicy) return field.repeatClonePolicy;
  if (field.valueRole === "runtime_derived_oracle") return "SYSTEM_GENERATED";
  if (field.valueRole === "secure_input" || field.sensitive) return "REQUIRE_NEW_VALUE";
  if (field.valueRole === "action_input") return "CLONE_SAME_VALUE";
  return "NOT_APPLICABLE";
}

function cloneDataField(
  field: RecordedDataField,
  targetScope: string,
  sourceRequirement?: RuntimeInputRequirement,
  disposition: RepeatFieldCloneDisposition = classifyRepeatFieldForClone(field),
): RecordedDataField {
  const reusable = disposition === "CLONE_SAME_VALUE" || disposition === "DERIVE_FROM_ALLOWED_SOURCE";
  return {
    ...field,
    key: scopedKey(field.key, targetScope),
    entityScope: targetScope,
    exampleValue: reusable && sourceRequirement?.resolved ? sourceRequirement.value ?? undefined : undefined,
    source: "RECORDED_CONFIRMED",
    needsReview: false,
    reviewReason: undefined,
  };
}

function isUniqueWithinCollection(constraint: RecordedValueConstraint): boolean {
  const normalized = constraint.type.trim().toLowerCase().replace(/[\s-]/g, "_");
  return constraint.uniqueWithinCollection === true
    || ["unique_within_collection", "distinct_within_collection"].includes(normalized);
}

function logicalFieldKey(valueKey: string): string {
  const parts = valueKey.split(".");
  return parts.length > 1 ? parts.slice(1).join(".") : valueKey;
}

function resolveRepeatConstraintValue(
  field: RecordedDataField,
  sourceRequirement: RuntimeInputRequirement | undefined,
  activeData: readonly RecordedDataField[],
): { value?: string; resolution?: ConstraintResolution } {
  const constraint = (sourceRequirement?.constraints ?? field.constraints ?? []).find(isUniqueWithinCollection);
  if (!constraint) return {};
  const activeValues = new Set(activeData
    .filter((candidate) => logicalFieldKey(candidate.key) === logicalFieldKey(field.key))
    .map((candidate) => clean(candidate.exampleValue))
    .filter((value): value is string => Boolean(value)));
  const candidates = [...new Set((sourceRequirement?.allowedValues ?? field.allowedValues ?? [])
    .map((value) => clean(value))
    .filter((value): value is string => Boolean(value)))];
  const distinctCandidates = candidates.filter((candidate) => !activeValues.has(candidate));
  const resolution: ConstraintResolution = {
    valueKey: field.key,
    constraintType: constraint.type,
    activeValueCount: activeValues.size,
    candidateCount: candidates.length,
    distinctCandidateCount: distinctCandidates.length,
    resolutionSource: candidates.length > 0 ? "allowed_values" : "none",
    resolved: distinctCandidates.length === 1,
  };
  return distinctCandidates.length === 1 ? { value: distinctCandidates[0], resolution } : { resolution };
}

function replaceStepKey(step: RecordedScenarioStep, sourceScope: string, targetScope: string, cloneIndex?: number): RecordedScenarioStep {
  const oldKey = step.valueKey;
  const valueKey = oldKey && (step.entityScope === sourceScope || oldKey.startsWith(`${sourceScope}.`)) ? scopedKey(oldKey, targetScope) : oldKey;
  const template = step.stepTemplate ?? step.content;
  const content = valueKey && oldKey && valueKey !== oldKey ? template.replaceAll(`[${oldKey}]`, `[${valueKey}]`) : template;
  return { ...step, content, stepTemplate: content, renderedStep: content, valueKey, entityScope: targetScope,
    ...(cloneIndex !== undefined && step.interactionId ? { interactionId: `${step.interactionId}-clone-${cloneIndex + 1}` } : {}) };
}

function cloneWebStep(step: RecordedWebStep, sourceScope: string, targetScope: string, cloneIndex?: number): RecordedWebStep {
  const valueKey = step.valueKey && (step.entityScope === sourceScope || step.valueKey.startsWith(`${sourceScope}.`)) ? scopedKey(step.valueKey, targetScope) : step.valueKey;
  return { ...step, valueKey, entityScope: targetScope, description: valueKey && step.valueKey !== valueKey ? step.description.replaceAll(`[${step.valueKey}]`, `[${valueKey}]`) : step.description,
    ...(cloneIndex !== undefined && step.interactionId ? { interactionId: `${step.interactionId}-clone-${cloneIndex + 1}` } : {}) };
}

function stepSignature(step: RecordedScenarioStep): string {
  return [step.interactionId ?? "", step.entityScope ?? "", step.valueKey ?? "", step.classification ?? "", step.content].join("|");
}

function dateOnly(value: string | null | undefined): string | undefined {
  const normalized = value === null ? undefined : clean(value);
  return normalized && /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : undefined;
}

function todayDateOnly(): string {
  const now = new Date();
  return `${now.getFullYear().toString().padStart(4, "0")}-${(now.getMonth() + 1).toString().padStart(2, "0")}-${now.getDate().toString().padStart(2, "0")}`;
}

function evaluateConstraint(constraint: RecordedValueConstraint, value: string): "valid" | "invalid" | "unknown" {
  const type = constraint.type.trim().toLowerCase().replace(/[-\s]/g, "_");
  if (["not_future", "date_not_future", "max_today"].includes(type)) {
    const candidate = dateOnly(value);
    return candidate ? (candidate <= todayDateOnly() ? "valid" : "invalid") : "unknown";
  }
  if (["min", "minimum", "min_date"].includes(type)) {
    const bound = clean(constraint.value);
    return bound && value >= bound ? "valid" : bound ? "invalid" : "unknown";
  }
  if (["max", "maximum", "max_date"].includes(type)) {
    const bound = clean(constraint.value);
    return bound && value <= bound ? "valid" : bound ? "invalid" : "unknown";
  }
  return "unknown";
}

/** Validates a mutation's data preconditions without knowing product field names. */
export function evaluateMutationPreconditionValidity(
  mutation: ScenarioMutationProposal,
  requirements: readonly RuntimeInputRequirement[],
): MutationPreconditionValidity {
  if (mutation.mutationType !== "REPEAT_ENTITY") {
    return { status: "valid", checkedValueKeys: [], invalidValueKeys: [], reasons: [] };
  }
  const checkedValueKeys: string[] = [];
  const invalidValueKeys: string[] = [];
  const reasons: string[] = [];
  let unknown = false;
  for (const requirement of requirements) {
    const isClonedReusable = requirement.sourceAuthority === "CLONED_CONFIRMED_VALUE"
      && (requirement.repeatCloneDisposition === "CLONE_SAME_VALUE" || requirement.repeatCloneDisposition === "DERIVE_FROM_ALLOWED_SOURCE");
    if (isClonedReusable || requirement.constraints?.length) checkedValueKeys.push(requirement.valueKey);
    if (isClonedReusable && (!requirement.resolved || requirement.value === null)) {
      invalidValueKeys.push(requirement.valueKey);
      reasons.push(`unresolved_repeat_precondition:${requirement.valueKey}`);
    }
    for (const constraint of requirement.constraints ?? []) {
      if (isUniqueWithinCollection(constraint)) continue;
      if (requirement.value === null || !requirement.resolved) {
        invalidValueKeys.push(requirement.valueKey);
        reasons.push(`unresolved_constraint_value:${requirement.valueKey}`);
        continue;
      }
      const result = evaluateConstraint(constraint, requirement.value);
      if (result === "invalid") {
        invalidValueKeys.push(requirement.valueKey);
        reasons.push(`constraint_not_satisfied:${requirement.valueKey}:${constraint.type}`);
      } else if (result === "unknown") {
        unknown = true;
        reasons.push(`constraint_unverified:${requirement.valueKey}:${constraint.type}`);
      }
    }
  }
  const uniqueInvalidValueKeys = [...new Set(invalidValueKeys)];
  return {
    status: uniqueInvalidValueKeys.length > 0 ? "invalid" : unknown ? "unknown" : "valid",
    checkedValueKeys: [...new Set(checkedValueKeys)],
    invalidValueKeys: uniqueInvalidValueKeys,
    reasons: [...new Set(reasons)],
  };
}

export function materializedSemanticSignature(scenario: Pick<RecordedScenario, "canonicalInteractions" | "testRailSteps" | "requiredData">): string {
  const interactions = (scenario.canonicalInteractions ?? [])
    .map((interaction) => [interaction.action, interaction.controlIdentity, interaction.entityScope ?? "", interaction.valueKey ?? "", interaction.recordedValue ?? "", interaction.description ?? ""].join("|"));
  const steps = scenario.testRailSteps.map(stepSignature);
  const values = scenario.requiredData.map((field) => field.key).sort();
  return JSON.stringify({ interactions, steps, values });
}

export function mutationEffectDiagnostics(
  primary: Pick<RecordedScenario, "canonicalInteractions" | "testRailSteps" | "requiredData">,
  materialized: Pick<RecordedScenario, "canonicalInteractions" | "testRailSteps" | "requiredData">,
): MutationEffectDiagnostics {
  const primarySteps = new Map(primary.testRailSteps.map((step) => [stepSignature(step), (primary.testRailSteps.filter((item) => stepSignature(item) === stepSignature(step)).length)]));
  const materializedSteps = new Map(materialized.testRailSteps.map((step) => [stepSignature(step), (materialized.testRailSteps.filter((item) => stepSignature(item) === stepSignature(step)).length)]));
  const countDelta = (left: Map<string, number>, right: Map<string, number>) => [...left.entries()].reduce((total, [key, count]) => total + Math.max(0, count - (right.get(key) ?? 0)), 0);
  const primaryKeys = new Set(primary.requiredData.map((field) => field.key));
  const materializedKeys = new Set(materialized.requiredData.map((field) => field.key));
  const primaryScopes = new Set((primary.canonicalInteractions ?? []).map((interaction) => interaction.entityScope).filter(Boolean) as string[]);
  const materializedScopes = new Set((materialized.canonicalInteractions ?? []).map((interaction) => interaction.entityScope).filter(Boolean) as string[]);
  const stepsReplaced = [...new Set((primary.canonicalInteractions ?? []).map((interaction) => interaction.id))].filter((id) => {
    const before = primary.canonicalInteractions?.find((interaction) => interaction.id === id);
    const after = materialized.canonicalInteractions?.find((interaction) => interaction.id === id);
    return Boolean(before && after && JSON.stringify([before.action, before.valueKey, before.recordedValue]) !== JSON.stringify([after.action, after.valueKey, after.recordedValue]));
  }).length;
  const signature = materializedSemanticSignature(materialized);
  const primarySignature = materializedSemanticSignature(primary);
  const diagnostics: MutationEffectDiagnostics = {
    materializedSemanticSignature: signature,
    primarySemanticSignature: primarySignature,
    stepsAdded: countDelta(materializedSteps, primarySteps),
    stepsRemoved: countDelta(primarySteps, materializedSteps),
    stepsReplaced,
    entityScopesAdded: [...materializedScopes].filter((scope) => !primaryScopes.has(scope)),
    valueKeysAdded: [...materializedKeys].filter((key) => !primaryKeys.has(key)),
    valueKeysRemoved: [...primaryKeys].filter((key) => !materializedKeys.has(key)),
  };
  if (signature === primarySignature) diagnostics.rejectionReason = "MUTATION_NO_EFFECT";
  return diagnostics;
}

/** Materializes a complete scenario from a mutation. It never copies source entity values. */
export function materializeScenarioMutation(primary: RecordedScenario, mutation: ScenarioMutationProposal): RecordedScenario {
  const repeat = mutation.operations.find((operation): operation is Extract<MutationOperation, { type: "clone_entity" }> => operation.type === "clone_entity");
  const remove = new Set(mutation.operations.filter((operation): operation is Extract<MutationOperation, { type: "remove_action" }> => operation.type === "remove_action").map((operation) => operation.interactionId));
  const removeEntities = new Set(mutation.operations.filter((operation): operation is Extract<MutationOperation, { type: "remove_entity" }> => operation.type === "remove_entity").map((operation) => operation.entityScope));
  const inserts = mutation.operations.filter((operation): operation is Extract<MutationOperation, { type: "insert_action" }> => operation.type === "insert_action");
  const replacement = mutation.operations.find((operation): operation is Extract<MutationOperation, { type: "replace_selection" }> => operation.type === "replace_selection");
  let testRailSteps = [...primary.testRailSteps];
  let webSteps = [...primary.webSteps];
  let requiredData = [...primary.requiredData];
  let canonicalInteractions = [...(primary.canonicalInteractions ?? [])];
  let stepTargets = [...(primary.stepTargets ?? [])];
  const repeatLineage = new Map<string, {
    sourceValueKey: string;
    sourceAuthority: RuntimeInputRequirement["sourceAuthority"];
    repeatCloneDisposition: RepeatFieldCloneDisposition;
  }>();
  const repeatConstraintResolutions: ConstraintResolution[] = [];
  const resolvedRepeatValues = new Map<string, string>();
  if (remove.size > 0) {
    const removed = new Set(canonicalInteractions.filter((interaction) => remove.has(interaction.id)).flatMap((interaction) => interaction.sourceEventRefs));
    canonicalInteractions = canonicalInteractions.filter((interaction) => !remove.has(interaction.id));
    testRailSteps = testRailSteps.filter((step) => !step.sourceEventRefs?.some((ref) => removed.has(ref)));
    webSteps = webSteps.filter((step) => !step.interactionId || !remove.has(step.interactionId));
    stepTargets = stepTargets.filter((target) => {
      const interactionId = primary.webSteps[target.stepIndex]?.interactionId;
      return !interactionId || !remove.has(interactionId);
    });
  }
  if (removeEntities.size > 0) {
    const originalCanonical = canonicalInteractions;
    const entityBlockIds = new Set((primary.entityActionBlocks ?? [])
      .filter((block) => removeEntities.has(block.entityScope))
      .flatMap((block) => block.semanticActions.map((interaction) => interaction.id)));
    const lastRemovedEntityIndex = Math.max(-1, ...originalCanonical.map((interaction, index) => entityBlockIds.has(interaction.id) ? index : -1));
    const uncertainDownstreamBoundary = originalCanonical.findIndex((interaction, index) => index > lastRemovedEntityIndex && interaction.causedTransition);
    const removed = new Set(canonicalInteractions.filter((interaction) => interaction.entityScope && removeEntities.has(interaction.entityScope)).flatMap((interaction) => interaction.sourceEventRefs));
    canonicalInteractions = canonicalInteractions.filter((interaction) => !interaction.entityScope || !removeEntities.has(interaction.entityScope));
    testRailSteps = testRailSteps.filter((step) => !step.entityScope || !removeEntities.has(step.entityScope));
    webSteps = webSteps.filter((step) => !step.entityScope || !removeEntities.has(step.entityScope));
    stepTargets = stepTargets.filter((target) => !removeEntities.has(primary.webSteps[target.stepIndex]?.entityScope ?? ""));
    requiredData = requiredData.filter((field) => !field.entityScope || !removeEntities.has(field.entityScope));
    if (removed.size > 0) {
      testRailSteps = testRailSteps.filter((step) => !step.sourceEventRefs?.some((ref) => removed.has(ref)));
    }
    // ZERO_ENTITY is exploratory: after removing the entity, a downstream functional
    // transition is not applicable unless the recording structurally proved it remains
    // independent. Stop before that transition; technical reachability evidence may remain.
    if (uncertainDownstreamBoundary >= 0) {
      const boundaryId = originalCanonical[uncertainDownstreamBoundary]?.id;
      const boundaryInteraction = originalCanonical[uncertainDownstreamBoundary];
      const functionalBoundary = Boolean(boundaryInteraction
        && !boundaryInteraction.technicalOnly
        && boundaryInteraction.action !== "navigation"
        && boundaryInteraction.action !== "system_observation");
      const boundaryRailIndex = testRailSteps.findIndex((step) => step.interactionId === boundaryId);
      if (boundaryRailIndex >= 0) testRailSteps = testRailSteps.slice(0, functionalBoundary ? boundaryRailIndex : boundaryRailIndex + 1);
      const boundaryWebIndex = webSteps.findIndex((step) => step.interactionId === boundaryId);
      if (boundaryWebIndex >= 0) webSteps = webSteps.slice(0, functionalBoundary ? boundaryWebIndex : boundaryWebIndex + 1);
      canonicalInteractions = canonicalInteractions.filter((interaction) => {
        const originalIndex = originalCanonical.findIndex((candidate) => candidate.id === interaction.id);
        return originalIndex < 0 || originalIndex < uncertainDownstreamBoundary || !functionalBoundary && originalIndex === uncertainDownstreamBoundary;
      });
    }
  }
  if (replacement) {
    canonicalInteractions = canonicalInteractions.map((interaction) => interaction.id === replacement.interactionId ? { ...interaction, recordedValue: replacement.value } : interaction);
    const replacementKey = canonicalInteractions.find((interaction) => interaction.id === replacement.interactionId)?.valueKey;
    if (replacementKey) requiredData = requiredData.map((field) => field.key === replacementKey
      ? { ...field, exampleValue: replacement.value, source: "RECORDED_CONFIRMED" as const }
      : field);
    testRailSteps = testRailSteps.map((step) => step.interactionId === replacement.interactionId && step.valueKey ? { ...step, renderedStep: (step.stepTemplate ?? step.content).replace(`[${step.valueKey}]`, JSON.stringify(replacement.value)) } : step);
  }
  if (repeat) {
    const sourceData = requiredData.filter((field) => field.entityScope === repeat.sourceEntityScope);
    const sourceBlock = primary.entityActionBlocks?.find((block) => block.entityScope === repeat.sourceEntityScope);
    // The persisted entity block can be an older/partial projection of the
    // canonical contract. Clone the canonical source actions when available so
    // compound controls (for example click + select) are not silently lost.
    const canonicalSourceInteractions = canonicalInteractions.filter((interaction) => interaction.entityScope === repeat.sourceEntityScope);
    const sourceInteractions = canonicalSourceInteractions.length > 0
      ? canonicalSourceInteractions
      : (sourceBlock?.semanticActions ?? []);
    const sourceRequirements = materializeRuntimeInputRequirements({ requiredData: sourceData, canonicalInteractions: sourceInteractions });
    const clonedData = sourceData.map((field) => {
      const sourceRequirement = sourceRequirements.find((requirement) => requirement.valueKey === field.key);
      const persistedSourceValue = primary.runtimeDataset?.resolvedValues[field.key];
      const lineageRequirement = persistedSourceValue === undefined || !sourceRequirement
        ? sourceRequirement
        : {
          ...sourceRequirement,
          value: persistedSourceValue,
          resolved: true,
          authority: "recorded_confirmed" as const,
          authorityValue: persistedSourceValue,
          datasetAuthorityMismatch: false,
        };
      const repeatCloneDisposition = classifyRepeatFieldForClone(field);
      const constraintResolution = resolveRepeatConstraintValue(field, sourceRequirement, requiredData);
      if (constraintResolution.resolution) repeatConstraintResolutions.push({
        ...constraintResolution.resolution,
        valueKey: scopedKey(field.key, repeat.targetEntityScope),
      });
      if (constraintResolution.value) resolvedRepeatValues.set(scopedKey(field.key, repeat.targetEntityScope), constraintResolution.value);
      const cloned = {
        ...cloneDataField(field, repeat.targetEntityScope, lineageRequirement, repeatCloneDisposition),
        ...(constraintResolution.value ? {
          exampleValue: constraintResolution.value,
          source: "RECORDED_CONFIRMED" as const,
        } : {}),
      };
      repeatLineage.set(cloned.key, {
        sourceValueKey: field.key,
        sourceAuthority: repeatCloneDisposition === "SYSTEM_GENERATED"
          ? "SYSTEM_GENERATED"
          : (repeatCloneDisposition === "CLONE_SAME_VALUE" || repeatCloneDisposition === "DERIVE_FROM_ALLOWED_SOURCE") && lineageRequirement?.resolved
            ? "CLONED_CONFIRMED_VALUE"
            : "UNRESOLVED",
        repeatCloneDisposition,
      });
      return cloned;
    });
    requiredData = [...requiredData, ...clonedData];
    const sourceInteractionIds = new Set(sourceInteractions.map((interaction) => interaction.id));
    const hasExplicitSourceBlock = sourceInteractions.length > 0;
    const sourceRail = testRailSteps.filter((step) => step.entityScope === repeat.sourceEntityScope
      && (!hasExplicitSourceBlock || !step.interactionId || sourceInteractionIds.has(step.interactionId)));
    const sourceWeb = webSteps.filter((step) => step.entityScope === repeat.sourceEntityScope
      && (!hasExplicitSourceBlock || !step.interactionId || sourceInteractionIds.has(step.interactionId)));
    const sourceInteractionId = sourceBlock?.semanticActions.at(-1)?.id
      ?? canonicalInteractions.filter((interaction) => interaction.entityScope === repeat.sourceEntityScope).at(-1)?.id;
    const clonedRail = sourceRail.map((step, index) => replaceStepKey(step, repeat.sourceEntityScope, repeat.targetEntityScope, index));
    const clonedWeb = sourceWeb.map((step, index) => cloneWebStep(step, repeat.sourceEntityScope, repeat.targetEntityScope, index));
    const sourceRailLastIndex = Math.max(-1, ...testRailSteps.map((step, index) => step.interactionId === sourceInteractionId ? index : -1));
    const terminalRailIndex = testRailSteps.findIndex((step, index) => index > sourceRailLastIndex && (() => {
      const interaction = step.interactionId ? canonicalInteractions.find((candidate) => candidate.id === step.interactionId) : undefined;
      return Boolean(interaction?.causedTransition);
    })());
    const railIndex = sourceRailLastIndex >= 0
      ? sourceRailLastIndex
      : terminalRailIndex >= 0 ? terminalRailIndex - 1 : -1;
    const repeatOperations = inserts.filter((operation) => operation.afterInteractionId === sourceInteractionId);
    const repeatSteps = repeatOperations.map((operation) => ({
      content: operation.action.description ?? "Presionar el control observado de repetición",
      renderedStep: operation.action.description ?? "Presionar el control observado de repetición",
      stepTemplate: operation.action.description ?? "Presionar el control observado de repetición",
      expected: "",
      classification: "FUNCTIONAL_ACTION" as const,
      interactionId: operation.action.id,
      sourceEventRefs: operation.action.sourceEventRefs,
      ...(operation.action.screenBeforeRef ? { screenBeforeRef: operation.action.screenBeforeRef } : {}),
      ...(operation.action.screenAfterRef ? { screenAfterRef: operation.action.screenAfterRef } : {}),
      ...(operation.action.routeBefore ? { routeBefore: operation.action.routeBefore } : {}),
      ...(operation.action.routeAfter ? { routeAfter: operation.action.routeAfter } : {}),
      ...(operation.action.stateScope ? { stateScope: operation.action.stateScope } : {}),
     }));
    testRailSteps.splice(railIndex + 1, 0, ...repeatSteps, ...clonedRail);
    const sourceWebLastIndex = Math.max(-1, ...webSteps.map((step, index) => step.interactionId === sourceInteractionId ? index : -1));
    const terminalWebIndex = webSteps.findIndex((step, index) => index > sourceWebLastIndex && step.interactionId && canonicalInteractions.find((candidate) => candidate.id === step.interactionId)?.causedTransition);
    const webIndex = sourceWebLastIndex >= 0
      ? sourceWebLastIndex
      : terminalWebIndex >= 0 ? terminalWebIndex - 1 : -1;
    const repeatWebSteps = repeatOperations.map((operation) => {
      const targetRef = operation.action.technicalTargetRefs[0];
      const separator = targetRef?.indexOf(":");
      return {
        action: "click" as const,
        ...(targetRef && separator !== undefined && separator > 0 ? { target: { strategy: targetRef.slice(0, separator), value: targetRef.slice(separator + 1) } } : {}),
        description: operation.action.description ?? "Presionar el control observado de repetición",
         interactionId: operation.action.id,
        ...(operation.action.screenBeforeRef ? { screenBeforeRef: operation.action.screenBeforeRef } : {}),
        ...(operation.action.screenAfterRef ? { screenAfterRef: operation.action.screenAfterRef } : {}),
        ...(operation.action.routeBefore ? { routeBefore: operation.action.routeBefore } : {}),
        ...(operation.action.routeAfter ? { routeAfter: operation.action.routeAfter } : {}),
        ...(operation.action.stateScope ? { stateScope: operation.action.stateScope } : {}),
      };
    });
    webSteps.splice(webIndex + 1, 0, ...repeatWebSteps, ...clonedWeb);
    const clonedInteractions = sourceInteractions.map((interaction, index) => ({
      ...interaction,
      id: `${interaction.id}-clone-${index + 1}`,
      entityScope: repeat.targetEntityScope,
      rowRelation: "added" as const,
      valueKey: interaction.valueKey ? scopedKey(interaction.valueKey, repeat.targetEntityScope) : undefined,
      recordedValue: interaction.valueKey
        ? resolvedRepeatValues.get(scopedKey(interaction.valueKey, repeat.targetEntityScope))
        : undefined,
      rawTypedValue: undefined,
      committedValue: undefined,
      sourceEventRefs: [],
      confidence: Math.min(interaction.confidence, 0.7),
    }));
    // Entity blocks may be reconstructed during hydration, so their interaction
    // objects are not guaranteed to retain reference identity with the canonical
    // array. Resolve the insertion boundary by the stable interaction id.
    const sourceLastInteractionId = sourceInteractions.at(-1)?.id;
    const sourceLastIndex = sourceLastInteractionId
      ? canonicalInteractions.findIndex((interaction) => interaction.id === sourceLastInteractionId)
      : -1;
    const canonicalTerminalIndex = canonicalInteractions.findIndex((interaction, index) => index > sourceLastIndex && interaction.causedTransition);
    const canonicalInsertIndex = canonicalTerminalIndex >= 0 ? canonicalTerminalIndex : canonicalInteractions.length;
    canonicalInteractions.splice(canonicalInsertIndex, 0, ...repeatOperations.map((operation) => operation.action), ...clonedInteractions);
  }
  if (inserts.length > 0 && !repeat) {
    for (const operation of inserts) {
      const index = operation.afterInteractionId ? canonicalInteractions.findIndex((interaction) => interaction.id === operation.afterInteractionId) + 1 : canonicalInteractions.length;
      canonicalInteractions.splice(Math.max(0, index), 0, operation.action);
    }
  }

  // A mutation may be persisted from an older projection that retained functional
  // interactions after the observed terminal transition. Keep the first functional
  // transition as the scenario terminal and remove everything after it coherently.
  let terminalIndex = -1;
  for (let index = canonicalInteractions.length - 1; index >= 0; index -= 1) {
    const interaction = canonicalInteractions[index];
    if (!interaction.technicalOnly
      && interaction.action !== "navigation"
      && interaction.action !== "system_observation"
      && interaction.causedTransition) {
      terminalIndex = index;
      break;
    }
  }
  if (mutation.mutationType === "ALTERNATIVE_SELECTION" && terminalIndex >= 0) {
    const terminalId = canonicalInteractions[terminalIndex].id;
    const terminalRailIndex = testRailSteps.findIndex((step) => step.interactionId === terminalId);
    if (terminalRailIndex >= 0) testRailSteps = testRailSteps.slice(0, terminalRailIndex + 1);
    const terminalWebIndex = webSteps.findIndex((step) => step.interactionId === terminalId);
    if (terminalWebIndex >= 0) webSteps = webSteps.slice(0, terminalWebIndex + 1);
    canonicalInteractions = canonicalInteractions.slice(0, terminalIndex + 1);
  }
  let runtimeInputRequirements = materializeRuntimeInputRequirements({ requiredData, canonicalInteractions });
  runtimeInputRequirements = runtimeInputRequirements.map((requirement) => {
    const lineage = repeatLineage.get(requirement.valueKey);
    const lineageValueKey = lineage?.sourceValueKey ?? requirement.valueKey;
    const persistedSourceValue = repeat && primary.runtimeDataset?.resolvedValues[lineageValueKey];
    return lineage
      ? {
        ...requirement,
        ...(persistedSourceValue !== undefined ? {
          value: persistedSourceValue,
          resolved: true,
          authority: "recorded_confirmed" as const,
          authorityValue: persistedSourceValue,
          datasetAuthorityMismatch: false,
        } : {}),
        ...lineage,
      }
      : repeat && persistedSourceValue !== undefined && requirement.entityScope === repeat.sourceEntityScope
        ? { ...requirement, value: persistedSourceValue, resolved: true, authority: "recorded_confirmed" as const, authorityValue: persistedSourceValue, datasetAuthorityMismatch: false }
        : requirement;
  });
  const unresolvedRepeatValueKeys = new Set(
    repeatConstraintResolutions.filter((resolution) => !resolution.resolved).map((resolution) => resolution.valueKey),
  );
  if (unresolvedRepeatValueKeys.size > 0) {
    runtimeInputRequirements = runtimeInputRequirements.map((requirement) => unresolvedRepeatValueKeys.has(requirement.valueKey)
      ? {
        ...requirement,
        required: true,
        value: null,
        resolved: false,
        source: "unresolved" as const,
        authority: "unresolved" as const,
        authorityValue: null,
        sourceAuthority: "UNRESOLVED" as const,
        datasetAuthorityMismatch: false,
      }
      : requirement);
  }
  const runtimeDataset = buildScenarioRuntimeDataset({ ...primary, scenarioId: `${primary.scenarioId}-MUT-${mutation.mutationType.toLowerCase()}`, requiredData, runtimeInputRequirements });
  const targetByInteraction = new Map<string, RecordedScenario["stepTargets"][number]>();
  for (const target of primary.stepTargets ?? []) {
    const interactionId = primary.webSteps[target.stepIndex]?.interactionId;
    if (interactionId) targetByInteraction.set(interactionId, target);
  }
  stepTargets = webSteps.flatMap((step, index) => {
    if (!step.target) return [];
    const previous = step.interactionId ? targetByInteraction.get(step.interactionId) : undefined;
    return [{
      ...(previous ?? {}),
      stepIndex: index,
      description: step.description,
      strategy: step.target.strategy,
      value: step.target.value,
    }];
  });
  const stateValidation = validateInteractionStateSequence(canonicalInteractions);
  const readiness = evaluateRecordingReadiness({
    functionalReadiness: testRailSteps.length > 0,
    technicalReadiness: primary.readiness?.technicalReadiness ?? primary.technicalReadiness ?? false,
    oracleReadiness: mutation.oracleAuthority !== "MISSING",
    runtimeInputRequirements,
    publicationRequiresOracle: true,
  });
  const materializedTechnicalRefs = [...new Set([...(primary.technicalKnowledgeRefs ?? []), ...inserts.flatMap((operation) => operation.action.sourceEventRefs)])];
  const entityActionBlocks = buildEntityActionBlocks({ requiredData, testRailSteps, sourceRecordingId: primary.sourceRecordingId }, canonicalInteractions, materializedTechnicalRefs);
  const numberedSteps = testRailSteps.map((step, index) => ({ ...step, stepNumber: index + 1 }));
  const diagnostics = mutationEffectDiagnostics(primary, { ...primary, testRailSteps: numberedSteps, canonicalInteractions, requiredData });
  if (replacement) {
    const primaryTarget = primary.canonicalInteractions?.find((interaction) => interaction.id === replacement.interactionId);
    if (primaryTarget?.recordedValue === replacement.value) diagnostics.rejectionReason = "MUTATION_NO_EFFECT";
  }
  const mutationPreconditionValidity = evaluateMutationPreconditionValidity(mutation, runtimeInputRequirements);
  diagnostics.mutationPreconditionValidity = mutationPreconditionValidity;
  if (diagnostics.rejectionReason === undefined
    && mutation.mutationType === "REPEAT_ENTITY"
    && repeatConstraintResolutions.some((resolution) => !resolution.resolved)) {
    diagnostics.rejectionReason = "RUNTIME_DATA_CONSTRAINT_VIOLATION";
  }
  if (diagnostics.rejectionReason === undefined && mutationPreconditionValidity.status !== "valid") {
    diagnostics.rejectionReason = mutationPreconditionValidity.status === "invalid"
      ? "MUTATION_PRECONDITION_INVALID"
      : "MUTATION_PRECONDITION_UNKNOWN";
  }
  const effectfulReadiness = diagnostics.rejectionReason ? {
    ...readiness,
    publicationContentReadiness: false,
    publicationReadiness: false,
  } : readiness;
  const runtimeExecutionBlockedByData = mutation.mutationType === "REPEAT_ENTITY" && unresolvedRepeatValueKeys.size > 0;
  const materializedTitle = diagnostics.rejectionReason === "MUTATION_NO_EFFECT"
    ? primary.title
    : mutation.title;
  return {
    ...primary,
    scenarioId: `${primary.scenarioId}-MUT-${mutation.mutationType.toLowerCase()}`,
    title: materializedTitle,
    description: mutation.rationale,
    provenance: "derived",
    primary: false,
    replayEligible: diagnostics.rejectionReason === undefined,
    containsUnexecutedActions: true,
    // The cloned controls reuse validated technical references from the source block. The
    // missing values are a data gate, not a locator-confidence failure.
    hasUncertainSteps: primary.hasUncertainSteps,
    testRailSteps: numberedSteps,
    stepTargets,
    webSteps,
    requiredData,
    canonicalInteractions,
    entityActionBlocks,
    technicalKnowledgeRefs: materializedTechnicalRefs,
    runtimeInputRequirements,
    runtimeDataset,
    readiness: effectfulReadiness,
    runtimeExecutionBlockedByData,
    mutation,
    expectedResultCandidate: mutation.expectedResultCandidate,
    oracleAuthority: mutation.oracleAuthority === "OBSERVED" ? "observed_only" : "review_required",
    reviewStatus: mutation.oracleAuthority === "OBSERVED" ? "APPROVED" : "PENDING",
    functionalReadiness: readiness.functionalReadiness,
    technicalReadiness: readiness.technicalReadiness,
    stateSequenceValid: stateValidation.stateSequenceValid,
    stateSequenceIssues: stateValidation.stateSequenceIssues,
    suggestionCategory: mutation.mutationType === "FIELD_OMISSION" || mutation.mutationType === "ZERO_ENTITY" ? "DERIVED_VALIDATION" : "DERIVED_ALTERNATIVE",
    scenarioSpecificSteps: numberedSteps,
    mutationDiagnostics: diagnostics,
    repeatConstraintResolutions: repeatConstraintResolutions.length > 0 ? repeatConstraintResolutions : undefined,
    mutationPreconditionValidity,
    ...(mutation.mutationType === "ZERO_ENTITY" ? {
      negativeOracle: {
        kind: "negative" as const,
        source: "mutation_precondition_graph" as const,
        expectedState: { entityCount: 0, canSubmit: false },
        terminalActionApplicable: false,
      },
    } : {}),
    scenarioStepCount: numberedSteps.length,
    functionalActionCount: numberedSteps.filter((step) => !step.isSetup && step.classification === "FUNCTIONAL_ACTION").length,
    nonUserSetupSteps: numberedSteps.filter((step) => step.isSetup === true).length,
    reasonForDifference: numberedSteps.some((step) => step.isSetup) ? "El contador funcional excluye filas de setup/navegación inicial visibles en el preview." : "Todas las filas del escenario son acciones funcionales.",
  };
}

export function enrichRecordedScenarioContract(
  scenario: RecordedScenario,
  interactions: CanonicalInteraction[],
  technicalKnowledgeRefs: string[] = [],
  model?: SemanticRecordingModel,
): RecordedScenario {
  const runtimeInputRequirements = materializeRuntimeInputRequirements({ ...scenario, canonicalInteractions: interactions });
  const readiness = evaluateRecordingReadiness({
    functionalReadiness: scenario.testRailSteps.length > 0,
    technicalReadiness: scenario.technicalReadiness !== false && !scenario.hasUncertainSteps,
    oracleReadiness: scenario.oracleAuthority !== "review_required"
      || (scenario.reviewStatus === "APPROVED" && Boolean(scenario.reviewedExpectedResult?.trim())),
    runtimeInputRequirements,
    publicationRequiresOracle: true,
  });
  const executableInteractions = interactions.filter((interaction) => hasExecutionAuthority(interaction) && interaction.action !== "system_observation");
  const relevantRefs = new Set(executableInteractions.flatMap((interaction) => interaction.sourceEventRefs.map((ref) => {
    const match = ref.match(/^event-(\d+)$/);
    return match ? `obs-${match[1]}` : ref;
  })));
  const scopedTechnicalRefs = technicalKnowledgeRefs.filter((ref) => relevantRefs.has(ref));
  const stateValidation = validateInteractionStateSequence(interactions);
  const entityActionBlocks = buildEntityActionBlocks({ ...scenario, canonicalInteractions: interactions }, executableInteractions, scopedTechnicalRefs);
  // Keep technical navigation interactions in the canonical contract as reachability
  // evidence. They are not rendered as user steps, but they bridge route/state ownership
  // for actions that occur after a screen transition.
  const withContract = { ...scenario, replayEligible: scenario.replayEligible ?? !scenario.mutationDiagnostics?.rejectionReason, canonicalInteractions: interactions, entityActionBlocks, readiness: { ...readiness, executionReadiness: readiness.executionReadiness && stateValidation.stateSequenceValid }, technicalReadiness: scenario.technicalReadiness !== false, technicalKnowledgeRefs: scopedTechnicalRefs, stateSequenceValid: stateValidation.stateSequenceValid, stateSequenceIssues: stateValidation.stateSequenceIssues, runtimeInputRequirements, runtimeDataset: buildScenarioRuntimeDataset({ ...scenario, runtimeInputRequirements }), mutationOpportunities: [] };
  return { ...withContract, mutationOpportunities: detectMutationOpportunities(withContract, model) };
}

/** Adapter into the same MCP scenario shape used by Jira/HU and TestRail. */
/**
 * The route reached by the immediately preceding executable transition is the
 * runtime route authority for the next action. A stale captured routeBefore is
 * retained in the canonical interaction for auditability, but must not block
 * replay when the observed transition provides the current route.
 */
export function deriveExpectedRouteBefore(
  interaction: Pick<CanonicalInteraction, "routeBefore">,
  previousExecutableInteraction?: Pick<CanonicalInteraction, "routeAfter">,
): string | undefined {
  return previousExecutableInteraction?.routeAfter ?? interaction.routeBefore;
}

export function toSharedMcpScenario(
  scenario: RecordedScenario,
  appSlug: string,
  datasetValues: Readonly<Record<string, string | undefined>> = {},
): RecordedScenarioMcpContract {
  const materialized = applyRuntimeDatasetValues(scenario, datasetValues);
  const requirements = materialized.runtimeInputRequirements ?? materializeRuntimeInputRequirements(materialized);
  const datasetBindings = Object.fromEntries(requirements.map((requirement) => [requirement.valueKey, requirement.value]));
  const readiness = materialized.readiness ?? evaluateRecordingReadiness({
    functionalReadiness: materialized.testRailSteps.length > 0,
    technicalReadiness: materialized.technicalReadiness !== false,
    oracleReadiness: materialized.oracleAuthority !== "review_required"
      || (materialized.reviewStatus === "APPROVED" && Boolean(materialized.reviewedExpectedResult?.trim())),
    runtimeInputRequirements: requirements,
    publicationRequiresOracle: true,
  });
  const mutationEffectOk = !materialized.mutationDiagnostics?.rejectionReason;
  const executionAudit = evaluateRecordedScenarioExecutionReadiness(materialized);
  const requirementsByKey = new Map(requirements.map((requirement) => [requirement.valueKey, requirement]));
  const testRailStepByInteractionId = new Map(
    materialized.testRailSteps
      .filter((step) => Boolean(step.interactionId))
      .map((step) => [step.interactionId!, step]),
  );
  const executableInteractionsForRoute = (materialized.canonicalInteractions ?? [])
      .filter((interaction) => hasExecutionAuthority(interaction) && interaction.action !== "system_observation" && interaction.action !== "navigation");
  const executableInteractions = executableInteractionsForRoute
      .map((interaction, actionOrder) => {
        const previousExecutableInteraction = actionOrder > 0 ? executableInteractionsForRoute[actionOrder - 1] : undefined;
        const expectedRouteBefore = deriveExpectedRouteBefore(interaction, previousExecutableInteraction);
        const humanStep = interaction.id ? testRailStepByInteractionId.get(interaction.id) : undefined;
        // A rendered step is presentation-only. The template supplies the safe human
        // description while the canonical interaction supplies execution authority.
        const candidateValueKeys = [humanStep?.valueKey, interaction.valueKey]
          .filter((key): key is string => Boolean(key?.trim()));
        const valueKey = candidateValueKeys.find((key) => requirementsByKey.has(key))
          ?? candidateValueKeys
            .map((key) => key.replace(/_valor$/i, ""))
            .find((key) => requirementsByKey.has(key))
          ?? candidateValueKeys[0];
        const requirement = valueKey ? requirementsByKey.get(valueKey) : undefined;
        return {
          actionType: interaction.action,
          interactionId: interaction.id,
          ...(interaction.key ? { key: interaction.key } : {}),
          ...(humanStep?.stepTemplate ?? humanStep?.content ? { humanStep: humanStep.stepTemplate ?? humanStep.content } : {}),
          ...(interaction.semanticField ? { semanticField: interaction.semanticField } : {}),
          // FIRST_LOSS fix: the same real field-relation authority that already backs
          // `semanticField` (certified `fieldOf(target)`, or `structuralFieldName` when
          // `resolutionState==="runtime_resolution_required"` -- both already exclude generic
          // labels) forwarded under the name case-discovery.ts's existing target-scoped fill
          // readiness retry gate reads. This is the SAME value, not a re-derivation.
          ...(interaction.semanticField ? { associatedField: interaction.semanticField } : {}),
          targetRef: interaction.controlIdentity,
          ...(interaction.technicalTargetRefs[0] ? { technicalTargetRef: interaction.technicalTargetRefs[0] } : {}),
          ...(interaction.technicalTargetRefs.length > 0 ? { technicalTargetRefs: [...interaction.technicalTargetRefs] } : {}),
          ...(interaction.technicalTargetCandidates?.length ? { technicalTargetCandidates: interaction.technicalTargetCandidates as Array<Record<string, unknown>> } : {}),
          // LAST-RESORT, EXECUTION-ONLY authority; the SAME structured value already present on
          // the canonical interaction, never reconstructed from humanStep/scenario text.
          ...(interaction.semanticRuntimeEvidence ? { semanticRuntimeEvidence: interaction.semanticRuntimeEvidence } : {}),
          ...(interaction.playwrightRecorderEvidence ? { playwrightRecorderEvidence: interaction.playwrightRecorderEvidence } : {}),
          ...(valueKey ? { valueKey } : {}),
          ...(requirement && (interaction.action === "fill" || interaction.action === "select") && typeof requirement.value === "string"
            ? { value: requirement.value }
            : {}),
          ...(requirement?.valueRole ? { valueRole: requirement.valueRole } : {}),
          ...(interaction.action === "fill" || interaction.action === "select" ? { runtimeValueSource: "dataset" as const } : {}),
          // The structured contract owns executable ordering. TestRail step
          // numbers are presentation metadata and may repeat around compound
          // interactions, so they cannot be used as runtime indices.
          stepIndex: actionOrder + 1,
          ...(interaction.entityScope ? { entityScope: interaction.entityScope } : {}),
          ...(interaction.rowRelation ? { rowRelation: interaction.rowRelation } : {}),
          ...(interaction.stateScope ? { expectedState: interaction.stateScope } : {}),
          ...(expectedRouteBefore ? { expectedRouteBefore } : {}),
          // Recorded post-action transition authority. The canonical interaction is the
          // source of truth: its `routeAfter` is the surface the action must reach. A
          // technicalOnly navigation interaction carries the route it reached in its
          // `routeBefore`, so a `routeAfter` is already the final recorded destination.
          // Only an interaction that owns a recorded route transition may impose a
          // post-action route. In-place transitions (for example dismissing a modal)
          // can carry a later/stale route observation in legacy traces; propagating it
          // would bind a future navigation to this action and reject a valid same-route
          // completion. The canonical `causedTransition` flag is the existing authority.
          ...(interaction.causedTransition === true && interaction.routeAfter
            ? { expectedRouteAfter: interaction.routeAfter }
            : {}),
          ...(interaction.controlIdentity ? { controlIdentity: interaction.controlIdentity } : {}),
          ...(interaction.relatedStateSurfaceEvidence
            ? { relatedStateSurfaceEvidence: interaction.relatedStateSurfaceEvidence }
            : {}),
          ...(interaction.causedTransition
            ? { expectedOutcomeKind: "route_transition" as const }
            : interaction.transitionObserved
              ? { expectedOutcomeKind: "in_place_transition" as const }
              : {}),
        };
      });
  const recordingExecutionContract: RecordingExecutionContract = {
    actions: normalizeRecordingExecutionActionIndices(executableInteractions),
    runtimeInputRequirements: requirements.map((requirement) => ({ ...requirement })),
    datasetBindings,
  };
  return {
    sourceIssueKey: `REC-${materialized.sourceRecordingId.slice(0, 8).toUpperCase()}`,
    title: materialized.title,
    steps: materialized.testRailSteps.map((step) => step.renderedStep ?? step.content),
    preconditions: materialized.preconditions,
    expectedResult: materialized.reviewedExpectedResult ?? materialized.expectedResultCandidate ?? materialized.testRailSteps.at(-1)?.expected ?? "Resultado esperado por confirmar",
    caseOracle: materialized.oracleAuthority,
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "recorded_session",
    setupStrategy: "recorded_walkthrough",
    appSlug,
    routeProfile: "",
    dataRequirements: requirements.filter((requirement) => requirement.required).map((requirement) => requirement.valueKey).join(", "),
    nonExecutableCriteria: executionAudit.executionReady
      ? ""
      : executionAudit.blockReasons.join(", ") || readiness.missingInputs.map((requirement) => `${requirement.entityScope ?? "global"}.${requirement.semanticField ?? requirement.valueKey}`).join(", "),
    mcpExecutable: mutationEffectOk && executionAudit.executionReady,
    executionReadiness: mutationEffectOk && executionAudit.executionReady ? "ready" : "blocked_execution_contract",
    // Recording Replay may run with a runtime-resolution-required action still pending live
    // re-verification, but promotion (spec generation/reuse/publication) never may — this stays
    // blocked until executionAudit.promotionReady, independent of Recording Replay's own gate.
    publishableToTestManagement: mutationEffectOk && readiness.publicationReadiness && executionAudit.promotionReady,
    publicationClassification: mutationEffectOk && readiness.publicationReadiness && executionAudit.promotionReady ? "executable" : "blocked",
    scenarioId: materialized.scenarioId,
    recordingId: materialized.sourceRecordingId,
    recordedScenarioId: materialized.scenarioId,
    ...(materialized.mutation?.basePrimaryScenarioId ? { basePrimaryScenarioId: materialized.mutation.basePrimaryScenarioId } : {}),
    canonicalInteractions: materialized.canonicalInteractions ?? [],
    entityActionBlocks: materialized.entityActionBlocks ?? [],
    runtimeInputRequirements: requirements,
    datasetBindings,
    technicalKnowledgeRefs: materialized.technicalKnowledgeRefs ?? [],
    stateSequenceValid: materialized.stateSequenceValid !== false,
    stateSequenceIssues: materialized.stateSequenceIssues ?? [],
    oracleAuthority: materialized.oracleAuthority === "review_required" ? "MISSING" : "OBSERVED",
    ...(materialized.negativeOracle ? { negativeOracle: materialized.negativeOracle } : {}),
    executionReadinessAudit: executionAudit,
    recordingExecutionContract,
  };
}
