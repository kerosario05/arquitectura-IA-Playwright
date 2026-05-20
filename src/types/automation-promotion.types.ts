export type PromotedAutomationStatus = "active" | "disabled" | "draft";

export type PromotedAutomationSource = "agent_handoff" | "manual" | "rule_based" | "discovery";

export type PromotedAutomationIndexEntry = {
  id: string;
  externalId?: string;
  caseId?: number;
  title: string;
  planPath: string;
  specPath: string;
  appSlug?: string;
  appConfigPath?: string;
  status: PromotedAutomationStatus;
  source: PromotedAutomationSource;
  createdAt: string;
  updatedAt: string;
  lastPromotedFrom?: string;
  lastExecutionResultPath?: string;
  appProfile?: string;
  baseUrlHash?: string;
  tags?: string[];
  metadata?: {
    discoveryDir?: string;
    confidenceSummary?: {
      promotedCount: number;
      averageConfidence: number;
      minConfidence: number;
    };
    promotedObjects?: string[];
  };
};

export type PromotedAutomationIndex = {
  version: "1.0";
  updatedAt: string;
  automations: PromotedAutomationIndexEntry[];
};

export type PromotionMode = "dry_run" | "approved";
