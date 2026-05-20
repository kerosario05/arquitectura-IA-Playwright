export type CaseAutomationStatus =
  | "not_automated"
  | "draft"
  | "active"
  | "disabled"
  | "different_profile";

export type CaseAutomationSummary = {
  caseId: number;
  externalId?: string;
  title: string;
  automationStatus: CaseAutomationStatus;
  automationId?: string;
  specPath?: string;
  planPath?: string;
  lastUpdated?: string;
  appProfile?: string;
  currentProfile?: string;
};

export type CaseAutomationListResult = {
  cases: CaseAutomationSummary[];
  totalCount: number;
  automatedCount: number;
  notAutomatedCount: number;
  fetchedAt: string;
};
