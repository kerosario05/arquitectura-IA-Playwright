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
  | "registry";

export type PlanTarget = {
  strategy: LocatorStrategy;
  value?: string;
  hint?: string;
  role?: string;
  name?: string;
  exact?: boolean;
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
  index: number;
  action: PlanAction;
  description?: string;
  target?: PlanTarget | "APP_BASE_URL";
  value?: string;
  valueKey?: string;
  inputIntent?: InputIntent;
  requirementRefs?: string[];
  entityScope?: string;
  rowScope?: number;
  rowRelation?: "next" | "added";
  associatedField?: string;
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
