export type PromotedAutomationStatus = "active" | "disabled" | "draft" | "inline_debug_only" | "needs_page_object" | "needs_page_method" | "needs_component_object" | "needs_flow" | "blocked_missing_pom";

export type PromotedAutomationSource = "agent_handoff" | "manual" | "rule_based" | "discovery";

export type SpecGenerationMode = "page-object" | "inline-debug";

export type PromotionPolicy = {
  specMode: SpecGenerationMode;
  requirePageObjects: boolean;
  allowInlineFallback: boolean;
  allowInlineDebugMode: boolean;
  allowCandidateGeneration: boolean;
  blockPromotionWhenPageObjectMissing: boolean;
};

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  specMode: "page-object",
  requirePageObjects: true,
  allowInlineFallback: false,
  allowInlineDebugMode: true,
  allowCandidateGeneration: true,
  blockPromotionWhenPageObjectMissing: true
};

export type POMPromotionStatus =
  | "promoted"
  | "inline_debug_only"
  | "needs_page_object"
  | "needs_page_method"
  | "needs_component_object"
  | "needs_flow"
  | "page_object_candidate_created"
  | "blocked_missing_pom";

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
  pomStatus?: POMPromotionStatus;
  inlineDebugMode?: boolean;
  metadata?: {
    discoveryDir?: string;
    confidenceSummary?: {
      promotedCount: number;
      averageConfidence: number;
      minConfidence: number;
    };
    promotedObjects?: string[];
    pomDiagnostics?: {
      missingPageObjects: string[];
      missingMethods: string[];
      generatedCandidates: number;
    };
    overwritten?: boolean;
    previousAutomationPath?: string;
    previousStatus?: string;
  };
};

export type PromotedAutomationIndex = {
  version: "1.0";
  updatedAt: string;
  automations: PromotedAutomationIndexEntry[];
};

export type PromotionMode = "dry_run" | "approved";
