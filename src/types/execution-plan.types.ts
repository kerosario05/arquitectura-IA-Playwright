import type { ControlIdentity } from "./control-identity";

export type ExecutionPlanVersion = "1.0";

export type ExecutionPlanSource = "manual" | "rule_based" | "ai_generated" | "discovery_generated";

export type ExecutionPlanStatus =
  | "draft"
  | "validated"
  | "invalid"
  | "needs_data"
  | "needs_discovery"
  | "unsupported";

export type PlanAction =
  | "navigate"
  | "login"
  | "click"
  | "fill"
  | "uploadFile"
  | "select"
  | "check"
  | "uncheck"
  | "press"
  | "waitFor"
  | "assertVisible"
  | "assertText"
  | "assertUrl"
  | "screenshot"
  | "noop";

export type LocatorStrategy =
  | "role"
  | "text"
  | "label"
  | "placeholder"
  | "testId"
  | "css"
  | "xpath"
  | "semantic"
  | "registry"
  | "url"
  | "selection_keyboard_typeahead";

export type PlanTarget = {
  strategy: LocatorStrategy;
  value?: string;
  hint?: string;
  role?: string;
  name?: string;
  exact?: boolean;
  /** Assertion-only scope; keeps verified application-shell checks distinct from page-content checks. */
  assertionScope?: "header";
  // AI-assisted resolution metadata
  metadata?: {
    originalTarget?: string;
    resolvedTargetName?: string;
    resolvedCandidateId?: string;
    aiAssisted?: boolean;
    aiReason?: string;
    repairType?: string;
    decisionStatus?: string;
    validationStatus?: string;
  };
};

export type RequiredDataRef = {
  key: string;
  required: boolean;
  resolved: boolean;
  sensitive?: boolean;
  source?: string;
  reason?: string;
  valueRole?: "runtime_input" | "expected_oracle" | "runtime_derived_oracle";
  oracleSource?: string;
  dependsOn?: string[];
};

export type InputIntent = {
  mode: "set_value" | "leave_unset" | "invalid_value" | "preserve_state";
  requirementRefs?: string[];
};

export type ExecutionPlanStep = {
  /** Opt-in Jira workflow operation; Recording uses its own trace contract. */
  jiraWorkflow?: import("../jira/jira-workflow").JiraWorkflowOperation;
  /** Exact source interaction from a Recording contract; absent on Jira and manual plans. */
  sourceInteractionId?: string;
  recordingActionType?: "fill" | "select" | "click" | "check" | "uncheck" | "press" | "navigation" | "tab_switch" | "upload" | "system_observation";
  /** Durable project-scoped file refs captured from the observed file input. */
  fileAssets?: import("../recording/session-trace.types").RecordedFileAssetRef[];
  /** Runtime-selected file set key for an observed Recording upload control. */
  fileSetValueKey?: string;
  /** Exact observed file-input locators. Used only by recorded upload steps. */
  technicalTargetRefs?: string[];
  /** Exact observed destination URL for a recorded cross-application navigation. */
  navigationUrl?: string;
  /** Recorder-owned tab identity; absent for Jira and legacy single-page plans. */
  pageKey?: string;
  /** Opens the pageKey in a new browser tab during replay when true. */
  opensNewPage?: boolean;
  /** Live value transfer metadata; never contains the copied value. */
  runtimeDerivedSourceEventRef?: string;
  runtimeValueCaptures?: Array<{
    sourceEventRef: string;
    sourcePageKey?: string;
    technicalTargetRefs: string[];
    valueSelection: import("../recording/session-trace.types").RecordedValueSelection;
  }>;
  /** Live Discovery observation, independent of recorder evidence. */
  selectionControlKind?: "native_select";
  index: number;
  action: PlanAction;
  description?: string;
  target?: PlanTarget | "APP_BASE_URL";
  value?: string;
  valueKey?: string;
  /** Character position for one press from a shared custom-keyboard value. */
  segmentPosition?: number;
  inputIntent?: InputIntent;
  requirementRefs?: string[];
  entityScope?: string;
  rowScope?: number;
  rowRelation?: "next" | "added";
  associatedField?: string;
  /** Semantic owner whose controlled selection surface contains this recorded query input. */
  selectionQueryOwnerField?: string;
  /** Recorder-captured runtime evidence for compound controls such as segmented OTP inputs. */
  playwrightRecorderEvidence?: import("../recording/structural-owner-identity").PlaywrightRecorderEvidence;
  resolutionState?: "certified" | "runtime_resolution_required" | "unresolved_unrecoverable";
  expectedValueKey?: string;
  controlIdentity?: ControlIdentity;
  supportingStrategy?: {
    kind: "select_valid_option" | "radio_valid_option" | "checkbox_required_state" | "combobox_valid_option" | "autocomplete_valid_option" | "date_valid_value" | "multiselect_valid_options";
    strategy: "first_valid" | "ensure_checked" | "valid_in_range" | "ensure_valid_selection";
  };
  conditionalAction?: import("../scenarios/canonical-scenario").CanonicalConditionalAction;
  expected?: string;
  timeoutMs?: number;
  optional?: boolean;
  evidence?: boolean;
  // Discovery resolution metadata
  locatorStrategy?: string;
  recoveryMetadata?: {
    recoveredBy?: "segmented_route_recovery" | "route_completion" | "contextual_intermediate_already_satisfied" | "ordinal_selection";
    rationale?: string;
    ordinalSelectionDiagnostics?: {
      selectionPatternDetected: boolean;
      ordinal?: "first" | "second" | "third" | "last";
      domainTerm?: string;
      domainTermSource?: "routeProfile" | "generic_fallback";
      selectedCandidateText?: string;
      selectedCandidateId?: string;
    };
    alreadySatisfiedEvidence?: {
      candidateText: string;
      candidateType: string;
      containsTarget: boolean;
      consistentWithNextTarget: boolean;
      reason: string;
    };
    selectedCandidateId?: string;
    selectedCandidateText?: string;
    segmentIndex?: number;
    transitionDetected?: boolean;
    beforeStructuralFingerprint?: string;
    afterStructuralFingerprint?: string;
    transitionValidated?: boolean;
    executedAction?: string;
  };
  // Context tracking for context-dependent actions
  contextMetadata?: {
    expectedScreen?: string;
    requiresContext?: string[];
    producesContext?: string;
    screenTransition?: "none" | "navigation" | "modal" | "in-place";
    ownerPage?: string;
    isContextDependent?: boolean;
  };
};

export type ExecutionPlanScenarioRef = {
  source: "testrail" | "jira" | "manual";
  externalId?: string;
  caseId?: number;
  title: string;
};

export type ExecutionPlan = {
  version: ExecutionPlanVersion;
  source: ExecutionPlanSource;
  status: ExecutionPlanStatus;
  scenario: ExecutionPlanScenarioRef;
  requiredData: RequiredDataRef[];
  steps: ExecutionPlanStep[];
  executionContract?: Record<string, unknown>;
  notes?: string[];
  createdAt: string;
  // Metadata for auth flow insertion and other cross-cutting concerns
  metadata?: {
    authFlowRequired?: boolean;
    authFlowInsertionAfterStepIndex?: number; // Insert AuthFlow after this step (0-based)
    authFlowAlias?: string;
    authFlowLanding?: string;
    authGateDetectedDuringDiscovery?: boolean;
    authGateStage?: string;
  };
};
