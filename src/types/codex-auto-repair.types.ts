export type CodexCliRunnerInput = {
  command: string;
  extraArgs: string[];
  prompt: string;
  cwd: string;
  timeoutMs: number;
  showAgentLog?: boolean;
  heartbeatMs?: number;
  handoffDir?: string;
  attempt?: number;
  stdoutLogPath?: string;
  stderrLogPath?: string;
};

export type CodexCliRunnerResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  signal?: string;
  durationMs: number;
  stdoutLogPath?: string;
  stderrLogPath?: string;
};

import type { SkillId } from "./agent-skill.types";

// --- Planning budget for bounded route recovery ---
export type PlanningBudget = {
  preferredResponseSeconds: number;
  maxPromptBudgetSeconds: number;
  maxCandidates: number;
  maxKnownObjects: number;
  maxKnownRoutes: number;
  maxKnownPlans: number;
  maxProposedActions: number;
  maxRationaleChars: number;
  maxUnresolvedQuestions: number;
};

export const DEFAULT_PLANNING_BUDGET: PlanningBudget = {
  preferredResponseSeconds: 30,
  maxPromptBudgetSeconds: 60,
  maxCandidates: 12,
  maxKnownObjects: 20,
  maxKnownRoutes: 10,
  maxKnownPlans: 5,
  maxProposedActions: 5,
  maxRationaleChars: 1200,
  maxUnresolvedQuestions: 5
};

// --- Semantic goal derived from case/scenario ---
export type SemanticGoal = {
  intent: string;
  targetConcept?: string;
  expectedOutcome?: string;
  requiredCapabilities?: string[];
  sensitive?: boolean;
};

// --- Route recovery pack — compact context for Codex ---
export type RouteRecoveryPack = {
  version: "1.0";
  createdAt: string;
  failedAction: {
    stepIndex?: number;
    actionType?: string;
    target?: string;
    failureReason?: string;
  };
  semanticGoal: SemanticGoal;
  currentScreen?: {
    url?: string;
    title?: string;
    visibleElementCount?: number;
  };
  topVisibleCandidates: Array<{
    id: string;
    type: string;
    text?: string;
    role?: string;
    score: number;
    actionability?: string;
    semanticRelation?: string;
    source?: string;
    nearbyText?: string;
    disabled?: boolean;
  }>;
  topKnownObjects: Array<{
    key?: string;
    name?: string;
    type?: string;
    score: number;
  }>;
  topKnownRoutes: Array<{
    route: string[];
    sourcePlanId?: string;
    score: number;
  }>;
  topKnownPlans: Array<{
    id?: string;
    title?: string;
    score: number;
  }>;
  priorSuccessfulSteps: Array<{
    index: number;
    action: string;
    target?: string;
  }>;
  pendingSteps: Array<{
    index: number;
    action: string;
    target?: string;
    failureReason?: string;
  }>;
  finalAssertions: Array<{
    target?: string;
    expected?: string;
  }>;
  actionHistorySummary: Array<{
    action: string;
    target?: string;
    status: string;
  }>;
  failedRoutePaths: string[];
  budget: PlanningBudget;
  constraints: {
    codexMustOnlyWriteAgentResponseJson: true;
    doNotRunPlaywright: true;
    doNotModifyStableRegistry: true;
    doNotApproveObjectsAutomatically: true;
    doNotInventData: true;
    useOnlyIdsPresentInThisPack: true;
  };
};

export type RouteRecoveryPackStats = {
  visibleCandidates: number;
  knownObjects: number;
  knownRoutes: number;
  knownPlans: number;
  pendingSteps: number;
  finalAssertions: number;
};

// --- Route recovery response decision ---
export type RecoveryDecision =
  | "repaired_plan"
  | "no_safe_action"
  | "needs_more_context"
  | "no_response"
  | "invalid_response"
  | "timeout"
  | "process_error"
  | "rejected_recovery_plan";

// --- Diagnostics for route recovery ---
export type RouteRecoveryDiagnostics = {
  promptMode: "compact-route-recovery" | "compact" | "verbose";
  compactPrompt: boolean;
  preferredResponseSeconds: number;
  promptBudgetSeconds: number;
  promptLengthChars?: number;
  routeRecoveryPackPath?: string;
  routeRecoveryPackStats?: RouteRecoveryPackStats;
  responseDecision: RecoveryDecision;
  candidatePathLength: number;
  usedKnownRoutes: string[];
  usedKnownObjects: string[];
  usedKnownPlans: string[];
  agentResponseExists: boolean;
  agentResponseValid: boolean;
  nextAction: string;
  timedOut: boolean;
  durationMs: number;
};

export type CodexAutoRepairInput = {
  handoffDir: string;
  requestPath: string;
  instructionsPath: string;
  responsePath: string;
  schemaPath: string;
  contextPackPath?: string;
  projectRoot: string;
  timeoutMs: number;
  codexCommand: string;
  codexExtraArgs: string[];
  promptMode?: "compact" | "verbose" | "compact-route-recovery";
  skillId?: SkillId;
  skillPath?: string;
  skillAwarePromptOverride?: string;
  showAgentLog?: boolean;
  heartbeatMs?: number;
  stdoutLogPath?: string;
  stderrLogPath?: string;
  attempt?: number;
  // Bounded route recovery fields
  compactPrompt?: boolean;
  promptBudgetSeconds?: number;
  maxCandidates?: number;
  maxProposedActions?: number;
  maxAttemptsOverride?: number;
  routeRecoveryPackPath?: string;
  planningBudget?: PlanningBudget;
  routeRecoveryDecisionSchemaPath?: string;
  routeRecoveryDecisionPath?: string;
};

export type TopCandidateRecommendation = {
  candidateId: string;
  text?: string;
  relation?: string;
  score: number;
  actionability?: string;
};

export type CodexAutoRepairResult = {
  success: boolean;
  responsePath: string;
  exitCode?: number;
  error?: string;
  timedOut?: boolean;
  diagnostics?: {
    exitCode?: number;
    timedOut?: boolean;
    durationMs?: number;
    stdoutLogPath?: string;
    stderrLogPath?: string;
    agentResponseExists?: boolean;
    agentResponseValid?: boolean;
    nextAction?: string;
    recoveryDecision?: RecoveryDecision;
    promptMode?: string;
    compactPrompt?: boolean;
    preferredResponseSeconds?: number;
    promptBudgetSeconds?: number;
    promptLengthChars?: number;
    routeRecoveryPackPath?: string;
    routeRecoveryPackStats?: RouteRecoveryPackStats;
    responseDecision?: string;
    candidatePathLength?: number;
    validationErrors?: string[];
    rawRecoveryDecision?: string;
    generatedAtPresent?: boolean;
    generatedAtValid?: boolean;
    placeholdersDetected?: string[];
    topCandidateRecommendation?: TopCandidateRecommendation;
    fallbackApplied?: boolean;
    fallbackReason?: string;
    fallbackCandidate?: TopCandidateRecommendation;
    fallbackResponseValid?: boolean;
    originalAgentValidationErrors?: string[];
    routeRecoveryDecisionValid?: boolean;
    routeRecoveryDecisionErrors?: string[];
    finalAgentResponseBuiltBy?: "codex_decision" | "deterministic_fallback";
    selectedCandidateId?: string;
    selectedCandidateText?: string;
    transformationErrors?: string[];
  };
};
