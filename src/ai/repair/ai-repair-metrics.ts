/**
 * AI Repair Observability / Metrics Types
 */

export type AiRepairDecisionCounts = {
  repaired_plan: number;
  no_safe_action: number;
  needs_more_context: number;
  invalid_response: number;
  provider_error: number;
  provider_disabled: number;
};

export type AiRepairValidationCounts = {
  valid: number;
  blocked: number;
  invalid: number;
  error: number;
};

export type AiRepairRepairTypeCounts = {
  target_resolution: number;
  route_recovery: number;
  assertion_resolution: number;
  pom_method_missing: number;
  selection_resolution: number;
  unknown: number;
};

export type AiRepairTargetSummary = {
  stepIndex: number;
  target: string;
  action: string;
  decisionStatus: string;
  validationStatus: string;
  repairType?: string;
  selectedCandidateId?: string | null;
  selectionStatus?: string | null;
  resolvedTargetName?: string | null;
  resolvedCandidateId?: string | null;
  blockedReason?: string | null;
  durationMs: number;
  providerName: string;
  model: string;
};

export type AiRepairCaseSummary = {
  enabled: boolean;
  invocations: number;
  providerName: string | null;
  model: string | null;
  decisionCounts: AiRepairDecisionCounts;
  validationCounts: AiRepairValidationCounts;
  repairTypeCounts: AiRepairRepairTypeCounts;
  appliedRepairs: number;
  blockedRepairs: number;
  avgDurationMs: number;
  maxDurationMs: number;
  targets: AiRepairTargetSummary[];
};

export type AiRepairProviderSummary = {
  invocations: number;
  appliedRepairs: number;
  blockedRepairs: number;
  providerErrors: number;
  avgDurationMs: number;
};

export type AiRepairBatchSummary = {
  casesWithAiRepair: number;
  totalInvocations: number;
  appliedRepairs: number;
  blockedRepairs: number;
  providerErrors: number;
  invalidResponses: number;
  avgDurationMs: number;
  byProvider: Record<string, AiRepairProviderSummary>;
  cases: Array<{
    caseId: string;
    appSlug: string;
    invocations: number;
    appliedRepairs: number;
    blockedRepairs: number;
  }>;
};

export function createEmptyCaseSummary(): AiRepairCaseSummary {
  return {
    enabled: false,
    invocations: 0,
    providerName: null,
    model: null,
    decisionCounts: {
      repaired_plan: 0,
      no_safe_action: 0,
      needs_more_context: 0,
      invalid_response: 0,
      provider_error: 0,
      provider_disabled: 0
    },
    validationCounts: {
      valid: 0,
      blocked: 0,
      invalid: 0,
      error: 0
    },
    repairTypeCounts: {
      target_resolution: 0,
      route_recovery: 0,
      assertion_resolution: 0,
      pom_method_missing: 0,
      selection_resolution: 0,
      unknown: 0
    },
    appliedRepairs: 0,
    blockedRepairs: 0,
    avgDurationMs: 0,
    maxDurationMs: 0,
    targets: []
  };
}

export function createEmptyBatchSummary(): AiRepairBatchSummary {
  return {
    casesWithAiRepair: 0,
    totalInvocations: 0,
    appliedRepairs: 0,
    blockedRepairs: 0,
    providerErrors: 0,
    invalidResponses: 0,
    avgDurationMs: 0,
    byProvider: {},
    cases: []
  };
}
