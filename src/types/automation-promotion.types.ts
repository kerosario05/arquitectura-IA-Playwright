export type PromotedAutomationStatus = "active" | "disabled" | "draft" | "inline_debug_only" | "needs_page_object" | "needs_page_method" | "needs_component_object" | "needs_flow" | "blocked_missing_pom" | "spec_failed" | "promoted_but_verification_failed";

export type PromotedAutomationSource = "agent_handoff" | "manual" | "rule_based" | "discovery";

export type SpecGenerationMode = "page-object" | "inline-debug";

export type PromotionPolicy = {
  specMode: SpecGenerationMode;
  requirePageObjects: boolean;
  allowInlineFallback: boolean;
  allowInlineDebugMode: boolean;
  allowCandidateGeneration: boolean;
  blockPromotionWhenPageObjectMissing: boolean;
  autoPom?: boolean;
  autoGeneratePageObjectCandidates?: boolean;
  autoApproveSafePageObjects?: boolean;
  autoApproveConfidenceThreshold?: number;
  autoRunPomValidation?: boolean;
  blockSensitiveAutoApproval?: boolean;
  requirePomRuntime?: boolean;
};

export const DEFAULT_PROMOTION_POLICY: PromotionPolicy = {
  specMode: "page-object",
  requirePageObjects: true,
  allowInlineFallback: false,
  allowInlineDebugMode: true,
  allowCandidateGeneration: true,
  blockPromotionWhenPageObjectMissing: true,
  autoPom: false,
  autoGeneratePageObjectCandidates: true,
  autoApproveSafePageObjects: true,
  autoApproveConfidenceThreshold: 0.50,
  autoRunPomValidation: true,
  blockSensitiveAutoApproval: true
  ,requirePomRuntime: false
};

export type POMPromotionStatus =
  | "promoted"
  | "inline_debug_only"
  | "needs_page_object"
  | "needs_page_method"
  | "needs_component_object"
  | "needs_flow"
  | "page_object_candidate_created"
  | "blocked_missing_pom"
  | "needs_manual_review"
  | "needs_auth_flow_in_spec";

export type SpecVerificationStatus = "passed" | "failed" | "skipped" | "not_run";

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
  specVerificationStatus?: SpecVerificationStatus;
  metadata?: {
    discoveryDir?: string;
    confidenceSummary?: {
      promotedCount: number;
      averageConfidence: number;
      minConfidence: number;
    };
    promotedObjects?: string[];
    pomDiagnostics?: {
      status?: "needs_page_object" | "promoted";
      inlineFallbackUsed?: boolean;
      reason?: string;
      requiredDataUsed?: string[];
      generatedPageObjects?: string[];
      generatedMethods?: string[];
      missingPageObjects: string[];
      missingMethods: string[];
      generatedCandidates: number;
      autoPom?: {
        enabled: boolean;
        initialPomStatus: string;
        generatedCandidateFiles: string[];
        autoApprovedPageObjects: string[];
        autoApprovedMethods: string[];
        blockedAutoApprovals: string[];
        approvalThreshold: number;
        regeneratedSpec: boolean;
        validationStatus: "passed" | "failed" | "skipped";
        finalPomStatus: "promoted" | "blocked_missing_pom" | "needs_page_method" | "needs_manual_review";
      };
    };
    promotionStrategyDiagnostics?: {
      requestedStrategy: "pom" | "inline" | "auto";
      autoPomEnabled: boolean;
      selectedStrategy: "pom" | "inline";
      reason: string;
      blockers: string[];
      availablePageObjects: string[];
      requiredPageMethods: string[];
      missingPageMethods: string[];
      autoPomAttempted: boolean;
      autoPomCreatedMethods: string[];
      fallbackUsed: boolean;
      requirePomRuntime: boolean;
    };
    specGeneration?: {
      mode: "deterministic" | "ai_hybrid";
      provider: string | null;
      model: string | null;
      invocations: number;
      invocationsConsumed: number;
      durationMs: number;
      usage: {
        inputTokens: number | null;
        cachedInputTokens: number | null;
        cacheWriteInputTokens: number | null;
        nonCachedInputTokens: number | null;
        outputTokens: number | null;
        reasoningOutputTokens: number | null;
        totalPhysicalTokens: number | null;
        durationMs: number | null;
        credits: number | null;
      };
      validation: {
        schema: SpecVerificationStatus | "skipped";
        structure: SpecVerificationStatus | "skipped";
        typescript: SpecVerificationStatus | "skipped";
        playwrightDiscovery: SpecVerificationStatus | "skipped";
        semanticCoverage: SpecVerificationStatus | "skipped";
        functionalExecution: SpecVerificationStatus | "skipped";
      };
      promotionAllowed: boolean;
      specsRequested: number;
      specsValidated: number;
      specsRejected: number;
      specWritten?: boolean;
      previousSpec?: {
        existed: boolean;
        hash: string | null;
        lastModifiedAt: string | null;
      };
      errors: string[];
      warnings: string[];
    };
    overwritten?: boolean;
    previousAutomationPath?: string;
    previousStatus?: string;
    specVerification?: {
      status: SpecVerificationStatus;
      error?: string;
      tracePath?: string;
      screenshotPath?: string;
    };
  };
};

export type PromotedAutomationIndex = {
  version: "1.0";
  updatedAt: string;
  automations: PromotedAutomationIndexEntry[];
};

export type PromotionMode = "dry_run" | "approved";
