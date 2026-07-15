export type PlanStepExecutionStatus = "passed" | "failed" | "skipped";

export type PlanExecutionStatus = "passed" | "failed" | "partial" | "skipped";

export type StepExecutionResult = {
  index: number;
  action: string;
  status: PlanStepExecutionStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  error?: string;
  screenshotPath?: string;
};

export type EvidenceKind = "selectionEvidence" | "formEvidence" | "assertionEvidence" | "detailEvidence" | "routeEvidence";

export type PlanExecutionResult = {
  scenario: {
    source: "testrail" | "jira" | "manual";
    externalId?: string;
    caseId?: number;
    title: string;
  };
  status: PlanExecutionStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  evidenceDir: string;
  steps: StepExecutionResult[];
  error?: string;
  evidenceKind?: EvidenceKind;
  isDetailEvidence?: boolean;
  detailScreenshotRequired?: boolean;
  lastActionTarget?: string;
};

export type PlansExecutionSummary = {
  generatedAt: string;
  total: number;
  passed: number;
  failed: number;
  partial: number;
  skipped: number;
  results: PlanExecutionResult[];
};
