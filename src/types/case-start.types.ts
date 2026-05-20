export type PromotionResult = {
  promoted: boolean;
  automationId?: string;
  planPath?: string;
  specPath?: string;
  dryRun: boolean;
  reason?: "execution_failed" | "plan_not_validated" | "dry_run";
};

export type HandoffResult = {
  created: boolean;
  handoffDir?: string;
  requestPath?: string;
  instructionsPath?: string;
  schemaPath?: string;
  responsePath?: string;
  dryRun: boolean;
  reason?: "plan_needs_repair" | "plan_needs_discovery" | "dry_run";
};

export type AutoRepairResult = {
  attempted: boolean;
  success: boolean;
  dryRun: boolean;
  error?: string;
  responsePath?: string;
  timedOut?: boolean;
};

export type ReuseResult = {
  found: boolean;
  sourceAutomationId?: string;
  sourceCaseId?: number;
  matchType?: "same_case" | "functional_code" | "normalized_title";
  confidence?: number;
  skippedReason?: "no_match" | "disabled" | "invalid_plan";
};

export type CaseStartWorkflowInput = {
  caseId: number;
  projectId: string;
  suiteId?: string;
  sectionId?: string;
  headed?: boolean;
  continueOnFailure?: boolean;
  reportToTestRail?: boolean;
  dryRun?: boolean;
  autoPromote?: boolean;
  autoHandoff?: boolean;
  autoRepair?: boolean;
  reuseExisting?: boolean;
};

export type CaseStartWorkflowResult = {
  caseId: number;
  status: "success" | "failed" | "skipped" | "needs_agent" | "needs_discovery";
  planPath?: string;
  executionResultPath?: string;
  testRailRunId?: number;
  testRailRunUrl?: string;
  error?: string;
  startedAt: string;
  completedAt: string;
  promotion?: PromotionResult;
  handoff?: HandoffResult;
  autoRepair?: AutoRepairResult;
  reuse?: ReuseResult;
  postReporting?: {
    testRailRunId?: number;
    jiraAttached: boolean;
  };
};
