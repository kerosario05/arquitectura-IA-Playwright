export type CaseAutomationStatus =
  | "not_automated"
  | "draft"
  | "active"
  | "disabled"
  | "different_profile"
  | "inline_debug_only"
  | "needs_page_object"
  | "needs_page_method"
  | "needs_component_object"
  | "needs_flow"
  | "blocked_missing_pom"
  | "spec_failed"
  | "promoted_but_verification_failed";

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
