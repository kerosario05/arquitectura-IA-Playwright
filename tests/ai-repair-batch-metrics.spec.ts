/**
 * AI Repair Batch Metrics Integration Tests
 */

import { test, expect } from "@playwright/test";
import { buildAiRepairBatchSummary, formatAiRepairBatchConsoleOutput } from "../src/ai/repair/ai-repair-summary-builder";
import type { AiRepairCaseSummary } from "../src/ai/repair/ai-repair-metrics";

function createCaseSummary(overrides?: Partial<AiRepairCaseSummary>): AiRepairCaseSummary {
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
      missing_intermediate_step: 0,
      unknown: 0
    },
    appliedRepairs: 0,
    blockedRepairs: 0,
    avgDurationMs: 0,
    maxDurationMs: 0,
    targets: [],
    ...overrides
  };
}

test("batch without AI Repair - zero invocations", () => {
  const caseSummaries = [
    { caseId: "C001", appSlug: "app-1", summary: createCaseSummary() },
    { caseId: "C002", appSlug: "app-1", summary: createCaseSummary() }
  ];
  
  const batch = buildAiRepairBatchSummary(caseSummaries);
  
  expect(batch.casesWithAiRepair).toBe(0);
  expect(batch.totalInvocations).toBe(0);
  expect(batch.appliedRepairs).toBe(0);
  expect(batch.blockedRepairs).toBe(0);
  expect(batch.providerErrors).toBe(0);
  expect(batch.byProvider).toEqual({});
  expect(batch.cases).toHaveLength(0);
});

test("batch with one case that applied repaired_plan", () => {
  const caseSummaries = [
    {
      caseId: "C001",
      appSlug: "app-1",
      summary: createCaseSummary({
        enabled: true,
        invocations: 1,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        decisionCounts: {
          repaired_plan: 1,
          no_safe_action: 0,
          needs_more_context: 0,
          invalid_response: 0,
          provider_error: 0,
          provider_disabled: 0
        },
        validationCounts: { valid: 1, blocked: 0, invalid: 0, error: 0 },
        appliedRepairs: 1,
        blockedRepairs: 0,
        avgDurationMs: 1000,
        maxDurationMs: 1000,
        targets: []
      })
    }
  ];
  
  const batch = buildAiRepairBatchSummary(caseSummaries);
  
  expect(batch.casesWithAiRepair).toBe(1);
  expect(batch.totalInvocations).toBe(1);
  expect(batch.appliedRepairs).toBe(1);
  expect(batch.byProvider.gemini).toBeDefined();
  expect(batch.byProvider.gemini.invocations).toBe(1);
  expect(batch.byProvider.gemini.appliedRepairs).toBe(1);
});

test("batch with multiple cases and providers", () => {
  const caseSummaries = [
    {
      caseId: "C001",
      appSlug: "app-1",
      summary: createCaseSummary({
        enabled: true,
        invocations: 2,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        decisionCounts: {
          repaired_plan: 1,
          no_safe_action: 1,
          needs_more_context: 0,
          invalid_response: 0,
          provider_error: 0,
          provider_disabled: 0
        },
        validationCounts: { valid: 2, blocked: 0, invalid: 0, error: 0 },
        appliedRepairs: 1,
        blockedRepairs: 0,
        avgDurationMs: 1000,
        maxDurationMs: 1500,
        targets: []
      })
    },
    {
      caseId: "C002",
      appSlug: "app-1",
      summary: createCaseSummary({
        enabled: true,
        invocations: 1,
        providerName: "openai",
        model: "gpt-4",
        decisionCounts: {
          repaired_plan: 0,
          no_safe_action: 1,
          needs_more_context: 0,
          invalid_response: 0,
          provider_error: 0,
          provider_disabled: 0
        },
        validationCounts: { valid: 1, blocked: 0, invalid: 0, error: 0 },
        appliedRepairs: 0,
        blockedRepairs: 0,
        avgDurationMs: 800,
        maxDurationMs: 800,
        targets: []
      })
    }
  ];
  
  const batch = buildAiRepairBatchSummary(caseSummaries);
  
  expect(batch.casesWithAiRepair).toBe(2);
  expect(batch.totalInvocations).toBe(3);
  expect(batch.byProvider.gemini).toBeDefined();
  expect(batch.byProvider.openai).toBeDefined();
  expect(batch.byProvider.gemini.invocations).toBe(2);
  expect(batch.byProvider.openai.invocations).toBe(1);
});

test("batch with provider_error", () => {
  const caseSummaries = [
    {
      caseId: "C001",
      appSlug: "app-1",
      summary: createCaseSummary({
        enabled: true,
        invocations: 1,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        decisionCounts: {
          repaired_plan: 0,
          no_safe_action: 0,
          needs_more_context: 0,
          invalid_response: 0,
          provider_error: 1,
          provider_disabled: 0
        },
        validationCounts: { valid: 0, blocked: 0, invalid: 0, error: 1 },
        appliedRepairs: 0,
        blockedRepairs: 0,
        avgDurationMs: 5000,
        maxDurationMs: 5000,
        targets: []
      })
    }
  ];
  
  const batch = buildAiRepairBatchSummary(caseSummaries);
  
  expect(batch.providerErrors).toBe(1);
  expect(batch.byProvider.gemini.providerErrors).toBe(1);
});

test("batch with case without aiRepairSummary - does not break aggregation", () => {
  // Simulate cases where some don't have AI Repair summaries
  const caseSummaries: Array<{ caseId: string; appSlug: string; summary: AiRepairCaseSummary }> = [
    {
      caseId: "C001",
      appSlug: "app-1",
      summary: createCaseSummary({
        enabled: true,
        invocations: 1,
        providerName: "gemini",
        appliedRepairs: 1,
        avgDurationMs: 1000,
        decisionCounts: { repaired_plan: 1, no_safe_action: 0, needs_more_context: 0, invalid_response: 0, provider_error: 0, provider_disabled: 0 },
        validationCounts: { valid: 1, blocked: 0, invalid: 0, error: 0 },
        blockedRepairs: 0,
        maxDurationMs: 1000,
        targets: []
      })
    },
    {
      caseId: "C002",
      appSlug: "app-1",
      summary: createCaseSummary() // No AI Repair invocations
    }
  ];
  
  const batch = buildAiRepairBatchSummary(caseSummaries);
  
  // Should not break - C002 is simply not included in casesWithAiRepair
  expect(batch.casesWithAiRepair).toBe(1);
  expect(batch.totalInvocations).toBe(1);
  expect(batch.cases).toHaveLength(1);
  expect(batch.cases[0].caseId).toBe("C001");
});

test("console output prints batch summary", () => {
  const batch = {
    casesWithAiRepair: 2,
    totalInvocations: 4,
    appliedRepairs: 2,
    blockedRepairs: 1,
    providerErrors: 1,
    invalidResponses: 0,
    avgDurationMs: 1100,
    byProvider: {},
    cases: []
  };
  
  const output = formatAiRepairBatchConsoleOutput(batch as any);
  
  expect(output).toContain("[ai-repair:batch-summary]");
  expect(output).toContain("casesWithAiRepair=2");
  expect(output).toContain("totalInvocations=4");
  expect(output).toContain("applied=2");
  expect(output).toContain("blocked=1");
  expect(output).toContain("providerErrors=1");
  expect(output).toContain("avgDurationMs=1100");
});

test("console output does not print secrets", () => {
  const batch = {
    casesWithAiRepair: 1,
    totalInvocations: 1,
    appliedRepairs: 1,
    blockedRepairs: 0,
    providerErrors: 0,
    invalidResponses: 0,
    avgDurationMs: 1000,
    byProvider: {
      gemini: {
        invocations: 1,
        appliedRepairs: 1,
        blockedRepairs: 0,
        providerErrors: 0,
        avgDurationMs: 1000
      }
    },
    cases: [
      {
        caseId: "C001",
        appSlug: "app-1",
        invocations: 1,
        appliedRepairs: 1,
        blockedRepairs: 0
      }
    ]
  };
  
  const output = formatAiRepairBatchConsoleOutput(batch as any);
  
  expect(output).not.toContain("password");
  expect(output).not.toContain("secret");
  expect(output).not.toContain("api_key");
  expect(output).toContain("[ai-repair:batch-summary]");
});

test("console output for zero invocations", () => {
  const batch = {
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
  
  const output = formatAiRepairBatchConsoleOutput(batch as any);
  
  expect(output).toBe("[ai-repair:batch-summary] casesWithAiRepair=0");
});

test("batch summary with invalid_response", () => {
  const caseSummaries = [
    {
      caseId: "C001",
      appSlug: "app-1",
      summary: createCaseSummary({
        enabled: true,
        invocations: 1,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        decisionCounts: {
          repaired_plan: 0,
          no_safe_action: 0,
          needs_more_context: 0,
          invalid_response: 1,
          provider_error: 0,
          provider_disabled: 0
        },
        validationCounts: { valid: 0, blocked: 0, invalid: 1, error: 0 },
        appliedRepairs: 0,
        blockedRepairs: 0,
        avgDurationMs: 500,
        maxDurationMs: 500,
        targets: []
      })
    }
  ];
  
  const batch = buildAiRepairBatchSummary(caseSummaries);
  
  expect(batch.invalidResponses).toBe(1);
  expect(batch.casesWithAiRepair).toBe(1);
});

test("batch summary with blocked sensitive action", () => {
  const caseSummaries = [
    {
      caseId: "C001",
      appSlug: "app-1",
      summary: createCaseSummary({
        enabled: true,
        invocations: 1,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        decisionCounts: {
          repaired_plan: 0,
          no_safe_action: 0,
          needs_more_context: 0,
          invalid_response: 1,
          provider_error: 0,
          provider_disabled: 0
        },
        validationCounts: { valid: 0, blocked: 1, invalid: 0, error: 0 },
        appliedRepairs: 0,
        blockedRepairs: 1,
        avgDurationMs: 600,
        maxDurationMs: 600,
        targets: []
      })
    }
  ];
  
  const batch = buildAiRepairBatchSummary(caseSummaries);
  
  expect(batch.blockedRepairs).toBe(1);
  expect(batch.casesWithAiRepair).toBe(1);
});
