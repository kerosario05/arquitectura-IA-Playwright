import type { RegistryObject, RegistryObjectType, RegistryLocator } from "./object-registry.types";
import type { SnapshotElement } from "./page-snapshot.types";
import type { ExecutionPlan } from "./execution-plan.types";
import type { AiExplorerOutput } from "../ai/ai-explorer.types";
import type { AssertionClassification, AssertionResolutionStatus } from "../discovery/assertion-resolver";
import type { AiRepairCaseSummary } from "../ai/repair/ai-repair-metrics";

export type RuntimeEvidenceTrace = {
  clickActions: Array<{
    stepIndex: number;
    target: string;
    normalizedTarget: string;
    actionType: string;
    ownerContext?: string;
    locatorStrategy?: string;
    success: boolean;
    transitionDetected?: boolean;
    postClickUiChange?: string;
    beforeContext?: string;
    afterContext?: string;
  }>;
  fillActions: Array<{
    stepIndex: number;
    field: string;
    normalizedField: string;
    valueKey?: string;
    source?: string;
    locatorStrategy?: string;
    success: boolean;
    activeContainerType?: string;
  }>;
  formEvidence: Array<{
    openedAtStep?: number;
    fieldsDetected: string[];
    normalizedFields: string[];
    submitAction?: string;
    closedAtStep?: number;
  }>;
  confirmationEvidence: Array<{
    successDetectedAtStep?: number;
    successText?: string;
    summaryFieldsDetected: string[];
    closeActionExecuted?: string;
    closedAtStep?: number;
    postCloseNavigationSignals: string[];
  }>;
  structuralEvidence: Array<{
    stepIndex: number;
    contextType: "catalog" | "list" | "filtered_list" | "detail" | "cart" | "form" | "confirmation";
    evidenceType: "items_visible" | "item_detail_visible" | "form_visible" | "summary_visible" | "success_message_visible";
    signals: string[];
    normalizedSignals: string[];
    snapshotTextSample?: string;
    confidence: number;
  }>;
  feedbackEvidence: Array<{
    stepIndex: number;
    message: string;
    normalizedMessage: string;
    source: "alert" | "toast" | "banner" | "dialog" | "text";
    confidence: number;
  }>;
};

export type PendingAssertionForensics = {
  assertion: string;
  normalizedAssertion: string;
  inferredType: "field" | "action" | "form" | "cart" | "confirmation" | "list" | "detail" | "unknown";
  requiredContext: string;
  currentContext: string;
  expectedConsumption: Array<
    | "satisfied_by_fill_action"
    | "satisfied_by_action_executed"
    | "satisfied_by_form_field_presence"
    | "satisfied_by_structural_evidence"
    | "satisfied_by_feedback_message"
    | "satisfied_by_confirmation_closed"
  >;
  evidenceAvailable: boolean;
  matchedEvidence: {
    executedAction?: Record<string, unknown>;
    fillAction?: Record<string, unknown>;
    activeContainer?: Record<string, unknown>;
    successConfirmation?: Record<string, unknown>;
    closeAction?: Record<string, unknown>;
    latestSnapshotSignals?: string[];
    structuralEvidence?: Record<string, unknown>[];
    feedbackEvidence?: Record<string, unknown>[];
  };
  notConsumedReason:
    | "normalization_mismatch"
    | "evidence_not_passed_to_resolver"
    | "wrong_context"
    | "missing_history"
    | "compound_field_not_split"
    | "ambiguous_assertion"
    | "concrete_evidence_missing"
    | "unsafe_to_assume";
  autoRepairAllowed: boolean;
  classification?: AssertionClassification;
  status?: AssertionResolutionStatus;
};

export type AutoRepairDecisionDiagnostics = {
  attempted: boolean;
  skipped: boolean;
  skipReason?: "local_diagnostic_sufficient" | "non_recoverable_failure" | "no_candidate_plan" | "no_snapshot" | "already_passed" | "timeout" | "agent_unavailable" | "agent_no_proposal";
  evaluatedPendingAssertions: string[];
  localClosureAttempted: boolean;
  localClosureConsumed: string[];
  localClosureRemaining: string[];
  ambiguousRemaining: string[];
  localDiagnostics: string[];
  pendingAssertions: string[];
  consumedAssertions: string[];
  autoRepairAllowed: boolean;
  autoRepairReason?: string;
  autoRepairSkippedReason?: "local_diagnostic_sufficient" | null;
  decision: "skip" | "attempt";
  explanation: string;
};

export type BatchCaseRootCause = 
  | "target_not_found"
  | "ambiguous_target"
  | "locator_resolution_failed"
  | "assertion_not_resolved"
  | "context_not_reached"
  | "precondition_unresolved"
  | "structural_evidence_missing"
  | "test_data_missing"
  | "auth_gate_blocked"
  | "page_transition_missing"
  | "agent_timeout"
  | "agent_no_proposal"
  | "local_assertions_pending"
  | "assertion_consumption_gap"
  | "unknown";

export type ProposedObject = RegistryObject & {
  confidence: number;
  reason: string;
  sourceElementId: string;
};

export type DiscoveryScanResult = {
  version: "1.0";
  url: string;
  title: string;
  scannedAt: string;
  totalElementsScanned: number;
  proposedObjects: ProposedObject[];
  summary: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    byType: Record<string, number>;
  };
};

export type ProposedObjectCandidate = {
  element: SnapshotElement;
  type: RegistryObjectType;
  key: string;
  name: string;
  locator: RegistryLocator;
  confidence: number;
  reason: string;
};

export type DiscoveryStepResult = {
  index: number;
  action: string;
  status:
    | "found"
    | "not_found"
    | "skipped"
    | "click_no_transition"
    | "ambiguous_target"
    | "locator_resolution_failed"
    | "fill_target_not_editable"
    | "fill_target_not_visible"
    | "fill_resolution_failed"
    | "fill_resolution_invalid"
    | "satisfied_by_children"
    | "skipped_semantic_descriptor"
    | "needs_assertion_resolution"
    | "needs_setup_resolution"
    | "needs_associated_target_resolution"
    | "ai_candidate_rejected"
    | "needs_approval"
    | "skipped_after_completion"
    | "skipped_redundant"
    | "optional_confirmation_detail_missing"
    | "satisfied_by_previous_assertion"
    | "precondition_unresolved";
  targetText?: string;
  snapshotUrl?: string;
  snapshotTitle?: string;
  elementsFound?: number;
  error?: string;
  evidencePath?: string;
  resolutionDiagnosis?: unknown[];
  attemptedLocators?: string[];
  locatorStrategy?: string;
  candidateId?: string;
  candidateText?: string;
  assertionClassification?: AssertionClassification;
  assertionStatus?: AssertionResolutionStatus;
  matchedText?: string;
  confidence?: number;
  closestCandidates?: Array<{ text: string; score: number; type: string }>;
  visibleTexts?: string[];
  descriptorTypes?: string[];
  subject?: string;
  matchedTokens?: string[];
  structuralSignals?: string[];
  childAssertionsUsed?: string[];
  assertionDiagnostics?: Record<string, unknown>;
  aiAssisted?: boolean;
  aiProposal?: AiExplorerOutput;
  aiReason?: string;
  ambiguityDiagnostics?: {
    target: string;
    semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "first_visible_item" | "unknown";
    relationContext?: string;
    candidateCount: number;
    candidateTexts: string[];
    candidateRoles: string[];
    candidateStrategies: string[];
    suggestedExactTargetPattern?: string;
    suggestedAssociatedActionPattern?: string;
  };
  aiDiagnostics?: {
    attempted: boolean;
    result: string;
    proposal?: AiExplorerOutput;
  };
  // Recovery metadata — set when segmented route recovery resolves a failed step
  originalStatus?: string;
  recoveryStatus?: "recovered" | "repaired";
  recoveredBy?: "segmented_route_recovery" | "route_completion" | "contextual_intermediate_already_satisfied" | "ordinal_selection" | "auth_flow" | "page_stability" | "later_success" | "retry_after_navigation";
  recoveryMetadata?: {
    selectedCandidateId?: string;
    selectedCandidateText?: string;
    semanticRelation?: string;
    score?: number;
    segmentIndex?: number;
    transitionDetected?: boolean;
    executedAction?: string;
    rationale?: string;
    alreadySatisfiedEvidence?: {
      candidateText: string;
      candidateType: string;
      containsTarget: boolean;
      consistentWithNextTarget: boolean;
      reason: string;
    };
    // Assertion recovery tracking
    originalFailureReason?: string;
    recoveredAfterStep?: number;
    recoveredBecause?: "auth_gate_completed" | "page_stabilized" | "target_used_successfully_later" | "action_on_target_succeeded";
    blocking?: boolean;
    ordinalSelectionDiagnostics?: {
      selectionPatternDetected: boolean;
      ordinal?: "first" | "second" | "third" | "last";
      domainTerm?: string;
      domainTermSource?: "routeProfile" | "generic_fallback";
      selectedCandidateText?: string;
      selectedCandidateId?: string;
    };
  };
  routeCompletionDiagnostics?: {
    attempted: boolean;
    enabled: boolean;
    appSlug: string;
    routeProfileUsed: boolean;
    trigger?: "pre_click_weak_resolution" | "post_click_semantic_mismatch" | "target_not_found";
    source?: "app_route_profile" | "generic_forward_route_completion";
    selectedCandidateId?: string;
    selectedCandidateText?: string;
    blockedReason?: string;
    retrySucceeded?: boolean;
    deterministicResolutionConfidence?: number;
    deterministicResolutionStrategy?: string;
  };
  earlyCompletionDiagnostics?: {
    checked: boolean;
    satisfied: boolean;
    satisfiedAssertions: string[];
    pendingAssertions: string[];
    deferredAssertions?: string[];
    blockingAssertions: string[];
    skippedAssertions: string[];
    weakSignals: string[];
    skippedReason?: string;
    skippedRemainingActions: number;
  };
  semanticRole?: "product" | "card" | "option" | "category" | "item" | "section" | "first_visible_item" | "unknown";
  relationContext?: string;
  authGateDiagnostics?: {
    detected: boolean;
    detectedBeforeStep?: string;
    stage?: string;
    requiredInputs?: string[];
    inputSource?: string;
    completedBy?: string;
    inputMethod?: string;
    maskedInputs?: Record<string, string>;
  };
  runtimeEvidenceTrace?: RuntimeEvidenceTrace;
  // AI selection resolution fields
  resolvedTargetName?: string;
  resolvedCandidateId?: string;
  resolvedLocator?: string;
  resolvedRole?: string;
  aiRepairType?: "target_resolution" | "route_recovery" | "assertion_resolution" | "selection_resolution" | "pom_method_missing";
  aiDecisionStatus?: "repaired_plan" | "no_safe_action" | "needs_more_context";
  aiValidationStatus?: "valid" | "invalid" | "error";
  aiSelectionRepairDiagnostics?: {
    enabled: boolean;
    providerName: string;
    model: string;
    failureType: string;
    selectionTarget: string;
    contextPackSummary: {
      selectionCandidateCount: number;
      hasSecrets: boolean;
      maxContextChars: number;
    };
    decisionStatus: string;
    validationStatus: string;
    selectedCandidateId: string | null;
    selectionStatus: string | null;
    blockedReason: string | null;
    durationMs: number;
  };
};

export type DiscoveredObject = {
  key: string;
  name: string;
  type: RegistryObjectType;
  locator: RegistryLocator;
  aliases: string[];
  discoveredAt: string;
  sourceStep: number;
  confidence: number;
};

export type ExpectedResultConsumption = {
  originalText: string;
  classification: "executable_assertion" | "non_executable_criteria" | "covered_by_concrete_assertions";
  reason: string;
  coveredByAssertions?: string[];
  extractedQuotedTexts?: string[];
};

export type CaseDiscoveryResult = {
  version: "1.0";
  caseId: number;
  caseTitle: string;
  discoveredAt: string;
  status:
    | "discovered_passed"
    | "repaired_passed"
    | "discovered_partial"
    | "needs_agent"
    | "auto_repair_exhausted"
    | "needs_assertion_resolution"
    | "needs_setup_resolution"
    | "needs_associated_target_resolution"
    | "needs_approval"
    | "exploration_failed";
  steps: DiscoveryStepResult[];
  discoveredObjects: DiscoveredObject[];
  candidatePlan?: ExecutionPlan;
  pendingObjectsPath?: string;
  pendingPlansPath?: string;
  evidenceDir?: string;
  failedAtStep?: number;
  failedTarget?: string;
  failedReason?: string;
  aiRepairSummary?: AiRepairCaseSummary;
  partialDiagnostics?: {
    partialReason: "pending_local_assertions" | "pending_context_deferred_assertions" | "pending_synthetic_expected";
    pendingAssertions: string[];
    localDiagnostics: string[];
    autoRepairSkippedReason: "local_diagnostic_sufficient";
    pendingForensics?: PendingAssertionForensics[];
    runtimeClosureDiagnostics?: {
      attempted: boolean;
      phase?: string;
      consumedAssertions: Array<{ assertion: string; decision: string; evidence?: string }>;
      remainingAssertions: string[];
      autoRepairAllowed: boolean;
      autoRepairSkippedReason?: string;
      notConsumedReasons?: string[];
    };
    expectedResultConsumption?: Array<{
      originalText: string;
      classification: "executable_assertion" | "non_executable_criteria" | "covered_by_concrete_assertions";
      reason: string;
      coveredByAssertions?: string[];
      extractedQuotedTexts?: string[];
    }>;
    nonExecutableCriteria?: string[];
    diagnosticsBuildError?: string;
  };
  autoRepairDecisionDiagnostics?: AutoRepairDecisionDiagnostics;
  finalStatusReconciliation?: {
    attempted: boolean;
    previousStatus: CaseDiscoveryResult["status"];
    newStatus: CaseDiscoveryResult["status"];
    reason: "local_closure_consumed_all_blockers" | "blocking_failures_remain";
    beforePendingAssertionCount: number;
    afterPendingAssertionCount: number;
    pendingActionsCount: number;
    blockingFailuresCount: number;
    unresolvedPreconditionsCount: number;
    promotionEligible: boolean;
    blockers?: string[];
  };
  rootCauseCategory?: BatchCaseRootCause;
  runtimeEvidenceTrace?: RuntimeEvidenceTrace;
};
