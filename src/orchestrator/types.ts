/**
 * QA Lab Codex Orchestrator -- shared contract types.
 *
 * Actor roles: CLAUDE BUILDER (primary source writer), CODEX BUILDER (quota-only source-writing
 * fallback), CODEX PHYSICAL (source read-only verifier), and this ORCHESTRATOR (read-only
 * reasoning plus deterministic evidence guard). See AGENTS.md for the narrative contract.
 */

export type StopReason = "SUCCESS" | "HUMAN_GATE" | "EXTERNAL_BLOCKER";

export type QaLabReference = {
  kind: "recording" | "discovery-job";
  id: string;
  projectSlug?: string;
  inputPath?: string;
  sourceRecordingId?: string;
  priorStatus?: string;
  priorPromotionAllowed?: boolean;
  validatedCommand?: string[];
  /** Safe recorded actions copied from the explicitly supplied historical Recording. */
  steps?: string[];
  runtimeUrl?: string;
};

export type ActorName = "USER" | "CLAUDE_BUILDER" | "CODEX_BUILDER" | "CODEX_PHYSICAL" | "CODEX_TESTER" | "ORCHESTRATOR";

/** A task is the unit of work the Orchestrator drives to closure. */
export type TaskContract = {
  taskId: string;
  objective: string;
  successCriteria: string[];
  physicalValidationRequired: boolean;
  /** Human-readable description of the earliest unresolved boundary at task creation time. */
  currentFrontier: string;
  /** Boundaries already proven physically GREEN -- never reopen without contradicting evidence. */
  physicalGreens: string[];
  allowedStopReasons: StopReason[];
  /** Optional recorded steps/data this task's physical validation should exercise. Never secrets. */
  steps?: string[];
  /** User/environment-provided QA Lab frontend/API boundary for recorder-owned physical runs. */
  qaLabBaseUrl?: string;
  /** QA Lab project selector required by recording APIs; distinct from an app slug. */
  projectSlug?: string;
  /** Explicit task target for physical navigation; never inferred by the Orchestrator. */
  runtimeUrl?: string;
  /** Optional source workspace for Claude in explicitly multi-repository tasks. */
  builderWorkspaceRoot?: string;
  /** User-selected source-writing Builder. Defaults to Claude; Codex Physical remains read-only. */
  builderAgent?: "CLAUDE_BUILDER" | "CODEX_BUILDER";
  data?: Record<string, string>;
  /** Max consecutive iterations with identical first-loss + evidence before NO_PROGRESS gate. */
  noProgressLimit?: number;
  /** Stable chat thread grouping id; each follow-up orchestration run has its own taskId. */
  conversationThreadId?: string;
  /** Bounded prior chat/evidence context. Historical context only; never fresh authority. */
  threadContext?: string;
  /** Explicit user-supplied recording/job id; the cycle is never guessed from UUID shape. */
  qaLabReference?: QaLabReference;
};

export type FirstLoss = {
  file: string;
  function: string;
  condition: string;
  reason: string;
};

/** Structured result produced by either source-writing Builder; prose is never parsed for state. */
export type ClaudeResult = {
  actor: "CLAUDE" | "CODEX_BUILDER";
  taskId: string;
  iteration: number;
  firstLoss: FirstLoss;
  fix: {
    filesChanged: string[];
    behaviorChanged: boolean;
    sharedCoreReused: boolean;
    hardcoded: boolean;
    positionUsed: boolean;
    sleepAdded: boolean;
  };
  tests: {
    passed: number;
    failed: number;
    newTypeErrors: number;
    preExistingTypeErrors: number;
  };
  result: {
    readyForPhysicalReplay: boolean;
    successCriteriaSatisfied: string[];
    successCriteriaOpen: string[];
    humanGate: boolean;
    sourceChanged?: boolean;
    externalBlocker: boolean;
  };
};

/** Structured result Codex Physical must produce; source READ-ONLY, physical evidence only. */
export type CodexPhysicalResult = {
  actor: "CODEX_PHYSICAL";
  taskId: string;
  iteration: number;
  freshRunId: string;
  recordingId?: string;
  replayRunId?: string;
  physical: {
    fresh: boolean;
    /** True when this run id already appears in persisted physical evidence. */
    freshRunIdReused?: boolean;
    stepsExpected: number;
    stepsExecuted: number;
    firstFailedStep?: string;
    functionalExecution: boolean;
    causalOutcomeObserved: boolean;
  };
  firstLoss?: {
    boundary: string;
    artifact: string;
    reason: string;
  };
  successCriteriaSatisfied: string[];
  successCriteriaOpen: string[];
  humanGate: boolean;
  externalBlocker: boolean;
  /** Repo-change guard result from scripts/codex-qa-verify.ps1 -- true means HUMAN_GATE, always. */
  sourceChanged: boolean;
};

/** Result of a Discovery/Auto-POM job; deliberately distinct from recorder-owned physical runs. */
export type CodexDiscoveryResult = {
  actor: "CODEX_TESTER";
  taskId: string;
  iteration: number;
  sourceJobId: string;
  jobId: string;
  appSlug: string;
  status: "passed" | "failed" | "blocked";
  total: number;
  passed: number;
  failed: number;
  promotionAllowed: boolean;
  specWritten: boolean;
  automationReady: boolean;
  failedGates: string[];
  artifacts: string[];
  firstLoss?: { boundary: string; evidence: string; reason: string };
  successCriteriaSatisfied: string[];
  successCriteriaOpen: string[];
  humanGate: boolean;
  externalBlocker: boolean;
  sourceChanged: boolean;
};

export type EvidenceKind = "CLAUDE_RESULT" | "CODEX_PHYSICAL_RESULT" | "CODEX_DISCOVERY_RESULT" | "NONE";

export type OrchestratorDecisionKind =
  | "CALL_CLAUDE"
  | "CALL_CODEX_PHYSICAL"
  | "CALL_CODEX_TESTER"
  | "SUCCESS"
  | "HUMAN_GATE"
  | "EXTERNAL_BLOCKER";

export type OrchestratorDecision = {
  actor: "ORCHESTRATOR";
  taskId: string;
  iteration: number;
  decision: OrchestratorDecisionKind;
  physicalGreensPreserved: string[];
  earliestFirstLoss?: {
    boundary: string;
    evidence: string;
    reason: string;
  };
  successCriteriaSatisfied: string[];
  successCriteriaOpen: string[];
  /** Primary Builder effort. Policy currently fixes this at medium for every dispatch. */
  claudeEffort?: "low" | "medium";
  claudeEffortReason?: string;
  /** Skill/plugin headers the generated Claude prompt must invoke -- compression mechanism, so
   * full rule text is never repeated inline. Default is always the QA Lab trio. */
  requiredSkills?: string[];
  requiredPlugins?: string[];
  /** One-line description of how context was kept small for this iteration (checkpoint-first,
   * artifact paths over logs, etc.) -- informational, not itself sent to Claude. */
  contextStrategy?: string;
  /** Reason string when decision is HUMAN_GATE/EXTERNAL_BLOCKER. */
  stopReasonDetail?: string;
  nextActor?: ActorName;
};

/** One iteration's persisted record, including which Builder actually supplied the result. */
export type OrchestratorIterationRecord = {
  iteration: number;
  at: string;
  evidenceKind: EvidenceKind;
  claudeResult?: ClaudeResult;
  codexPhysicalResult?: CodexPhysicalResult;
  codexDiscoveryResult?: CodexDiscoveryResult;
  decision: OrchestratorDecision;
  generatedPromptPath?: string;
  /** Provenance when a real actor result is carried forward from a prior task checkpoint. */
  evidenceSourceTaskId?: string;
  requestedActor?: "CLAUDE_BUILDER" | "CODEX_BUILDER";
  effectiveActor?: "CLAUDE_BUILDER" | "CODEX_BUILDER";
  fallbackReason?: string;
  actorResultArtifactPath?: string;
  parserError?: string;
  processExitCode?: number | null;
  processError?: string;
};

/** Full persisted task state -- lives under .artifacts/orchestrator/<taskId>/state.json. */
export type OrchestratorState = {
  task: TaskContract;
  iterations: OrchestratorIterationRecord[];
  status: "RUNNING" | StopReason;
  physicalGreens: string[];
  /** Tracks repeated identical (firstLoss, evidence) pairs for the NO_PROGRESS guard. */
  lastFirstLossSignature?: string;
  lastFirstLossRepeatCount: number;
};

export type OrchestratorEvent = {
  timestamp: string;
  taskId: string;
  iteration: number;
  actor: ActorName;
  type: string;
  summary: string;
  metadata?: Record<string, string | number | boolean | undefined>;
};
