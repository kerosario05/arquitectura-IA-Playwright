/**
 * AI Repair Summary Builder
 * 
 * Aggregates aiRepairDiagnostics from steps into case-level and batch-level summaries.
 */

import type { AiRepairCaseSummary, AiRepairBatchSummary, AiRepairTargetSummary } from "./ai-repair-metrics";
import { createEmptyCaseSummary, createEmptyBatchSummary } from "./ai-repair-metrics";

export type StepWithAiRepair = {
  index: number;
  targetText?: string;
  action?: string;
  aiRepairDiagnostics?: {
    enabled?: boolean;
    providerName?: string;
    model?: string;
    failureType?: string;
    target?: string;
    decisionStatus?: string;
    validationStatus?: string;
    selectedCandidateId?: string | null;
    selectionStatus?: string | null;
    blockedReason?: string | null;
    durationMs?: number;
    repairType?: string;
    resolvedTargetName?: string;
    resolvedCandidateId?: string;
    [key: string]: unknown;
  };
};

export function buildAiRepairCaseSummary(
  steps: StepWithAiRepair[],
  appSlug?: string
): AiRepairCaseSummary {
  const summary = createEmptyCaseSummary();
  
  const stepsWithAiRepair = steps.filter(s => s.aiRepairDiagnostics);
  
  if (stepsWithAiRepair.length === 0) {
    return summary;
  }
  
  summary.enabled = true;
  summary.invocations = stepsWithAiRepair.length;
  
  let totalDuration = 0;
  const durations: number[] = [];
  
  const targets: AiRepairTargetSummary[] = [];
  
  for (const step of stepsWithAiRepair) {
    const diag = step.aiRepairDiagnostics!;
    
    // Track provider/model (use most recent)
    if (diag.providerName) summary.providerName = diag.providerName;
    if (diag.model) summary.model = diag.model;
    
    // Count decision statuses
    const status = diag.decisionStatus as string;
    if (status === "repaired_plan") summary.decisionCounts.repaired_plan++;
    else if (status === "no_safe_action") summary.decisionCounts.no_safe_action++;
    else if (status === "needs_more_context") summary.decisionCounts.needs_more_context++;
    else if (status === "invalid_response") summary.decisionCounts.invalid_response++;
    else if (status === "provider_error") summary.decisionCounts.provider_error++;
    else if (status === "provider_disabled") summary.decisionCounts.provider_disabled++;
    
    // Count validation statuses
    const validation = diag.validationStatus as string;
    if (validation === "valid") summary.validationCounts.valid++;
    else if (validation === "blocked") summary.validationCounts.blocked++;
    else if (validation === "invalid") summary.validationCounts.invalid++;
    else if (validation === "error") summary.validationCounts.error++;
    
    // Count repair types
    const repairType = (diag.repairType as string) ?? "unknown";
    if (repairType === "target_resolution") summary.repairTypeCounts.target_resolution++;
    else if (repairType === "route_recovery") summary.repairTypeCounts.route_recovery++;
    else if (repairType === "assertion_resolution") summary.repairTypeCounts.assertion_resolution++;
    else if (repairType === "pom_method_missing") summary.repairTypeCounts.pom_method_missing++;
    else if (repairType === "selection_resolution") summary.repairTypeCounts.selection_resolution++;
    else if (repairType === "missing_intermediate_step") summary.repairTypeCounts.missing_intermediate_step++;
    else summary.repairTypeCounts.unknown++;
    
    // Count applied vs blocked
    if (status === "repaired_plan" && validation === "valid") {
      summary.appliedRepairs++;
    }
    if (validation === "blocked" || (status === "invalid_response" && diag.blockedReason)) {
      summary.blockedRepairs++;
    }
    
    // Track duration
    const duration = diag.durationMs ?? 0;
    if (duration > 0) {
      totalDuration += duration;
      durations.push(duration);
    }
    
    // Build target summary
    targets.push({
      stepIndex: step.index,
      target: diag.target ?? step.targetText ?? "unknown",
      action: step.action ?? "unknown",
      decisionStatus: status ?? "unknown",
      validationStatus: validation ?? "unknown",
      repairType: diag.repairType as string | undefined,
      selectedCandidateId: diag.selectedCandidateId ?? null,
      selectionStatus: diag.selectionStatus ?? null,
      resolvedTargetName: (diag as any).resolvedTargetName ?? null,
      resolvedCandidateId: diag.resolvedCandidateId ?? diag.selectedCandidateId ?? null,
      blockedReason: diag.blockedReason ?? null,
      durationMs: duration,
      providerName: diag.providerName ?? "unknown",
      model: diag.model ?? "unknown"
    });
  }
  
  summary.targets = targets;
  summary.avgDurationMs = durations.length > 0 ? Math.round(totalDuration / durations.length) : 0;
  summary.maxDurationMs = durations.length > 0 ? Math.max(...durations) : 0;
  
  return summary;
}

export function buildAiRepairBatchSummary(
  caseSummaries: Array<{ caseId: string; appSlug: string; summary: AiRepairCaseSummary }>
): AiRepairBatchSummary {
  const batch = createEmptyBatchSummary();
  
  const casesWithRepair = caseSummaries.filter(c => c.summary.enabled && c.summary.invocations > 0);
  
  batch.casesWithAiRepair = casesWithRepair.length;
  batch.totalInvocations = casesWithRepair.reduce((sum, c) => sum + c.summary.invocations, 0);
  batch.appliedRepairs = casesWithRepair.reduce((sum, c) => sum + c.summary.appliedRepairs, 0);
  batch.blockedRepairs = casesWithRepair.reduce((sum, c) => sum + c.summary.blockedRepairs, 0);
  
  // Aggregate provider errors and invalid responses
  batch.providerErrors = casesWithRepair.reduce(
    (sum, c) => sum + c.summary.decisionCounts.provider_error,
    0
  );
  batch.invalidResponses = casesWithRepair.reduce(
    (sum, c) => sum + c.summary.decisionCounts.invalid_response,
    0
  );
  
  // Calculate average duration across all invocations
  const allDurations: number[] = [];
  for (const c of casesWithRepair) {
    if (c.summary.avgDurationMs > 0 && c.summary.invocations > 0) {
      // Approximate total duration for this case
      const totalCaseDuration = c.summary.avgDurationMs * c.summary.invocations;
      for (let i = 0; i < c.summary.invocations; i++) {
        allDurations.push(totalCaseDuration / c.summary.invocations);
      }
    }
  }
  batch.avgDurationMs = allDurations.length > 0
    ? Math.round(allDurations.reduce((a, b) => a + b, 0) / allDurations.length)
    : 0;
  
  // Aggregate by provider
  const providerStats: Record<string, { invocations: number; appliedRepairs: number; blockedRepairs: number; providerErrors: number; durations: number[] }> = {};
  
  for (const c of casesWithRepair) {
    const provider = c.summary.providerName ?? "unknown";
    if (!providerStats[provider]) {
      providerStats[provider] = { invocations: 0, appliedRepairs: 0, blockedRepairs: 0, providerErrors: 0, durations: [] };
    }
    providerStats[provider].invocations += c.summary.invocations;
    providerStats[provider].appliedRepairs += c.summary.appliedRepairs;
    providerStats[provider].blockedRepairs += c.summary.blockedRepairs;
    providerStats[provider].providerErrors += c.summary.decisionCounts.provider_error;
    if (c.summary.avgDurationMs > 0) {
      for (let i = 0; i < c.summary.invocations; i++) {
        providerStats[provider].durations.push(c.summary.avgDurationMs);
      }
    }
  }
  
  for (const [provider, stats] of Object.entries(providerStats)) {
    batch.byProvider[provider] = {
      invocations: stats.invocations,
      appliedRepairs: stats.appliedRepairs,
      blockedRepairs: stats.blockedRepairs,
      providerErrors: stats.providerErrors,
      avgDurationMs: stats.durations.length > 0
        ? Math.round(stats.durations.reduce((a, b) => a + b, 0) / stats.durations.length)
        : 0
    };
  }
  
  // Add case summaries
  batch.cases = casesWithRepair.map(c => ({
    caseId: c.caseId,
    appSlug: c.appSlug,
    invocations: c.summary.invocations,
    appliedRepairs: c.summary.appliedRepairs,
    blockedRepairs: c.summary.blockedRepairs
  }));
  
  return batch;
}

export function formatAiRepairConsoleOutput(summary: AiRepairCaseSummary): string {
  if (!summary.enabled || summary.invocations === 0) {
    return "[ai-repair:summary] invocations=0";
  }
  
  return `[ai-repair:summary] invocations=${summary.invocations} applied=${summary.appliedRepairs} blocked=${summary.blockedRepairs} invalid=${summary.decisionCounts.invalid_response} providerErrors=${summary.decisionCounts.provider_error} avgDurationMs=${summary.avgDurationMs}`;
}

export function formatAiRepairBatchConsoleOutput(batch: AiRepairBatchSummary): string {
  if (batch.totalInvocations === 0) {
    return "[ai-repair:batch-summary] casesWithAiRepair=0";
  }
  
  return `[ai-repair:batch-summary] casesWithAiRepair=${batch.casesWithAiRepair} totalInvocations=${batch.totalInvocations} applied=${batch.appliedRepairs} blocked=${batch.blockedRepairs} providerErrors=${batch.providerErrors} invalid=${batch.invalidResponses} avgDurationMs=${batch.avgDurationMs}`;
}
