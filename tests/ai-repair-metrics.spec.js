"use strict";
/**
 * AI Repair Metrics / Summary Tests
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const ai_repair_summary_builder_1 = require("../src/ai/repair/ai-repair-summary-builder");
(0, test_1.test)("case summary with zero invocations", () => {
    const steps = [
        { index: 1, targetText: "Button 1", action: "click" },
        { index: 2, targetText: "Button 2", action: "click" }
    ];
    const summary = (0, ai_repair_summary_builder_1.buildAiRepairCaseSummary)(steps);
    (0, test_1.expect)(summary.enabled).toBe(false);
    (0, test_1.expect)(summary.invocations).toBe(0);
    (0, test_1.expect)(summary.appliedRepairs).toBe(0);
    (0, test_1.expect)(summary.blockedRepairs).toBe(0);
    (0, test_1.expect)(summary.targets).toHaveLength(0);
});
(0, test_1.test)("case summary with repaired_plan valid applied", () => {
    const steps = [
        {
            index: 1,
            targetText: "NonExistent Button",
            action: "click",
            aiRepairDiagnostics: {
                enabled: true,
                providerName: "gemini",
                model: "gemini-2.5-flash",
                failureType: "target_not_found",
                target: "NonExistent Button",
                decisionStatus: "repaired_plan",
                validationStatus: "valid",
                selectedCandidateId: "el-1",
                blockedReason: null,
                durationMs: 1234
            }
        }
    ];
    const summary = (0, ai_repair_summary_builder_1.buildAiRepairCaseSummary)(steps);
    (0, test_1.expect)(summary.enabled).toBe(true);
    (0, test_1.expect)(summary.invocations).toBe(1);
    (0, test_1.expect)(summary.providerName).toBe("gemini");
    (0, test_1.expect)(summary.model).toBe("gemini-2.5-flash");
    (0, test_1.expect)(summary.decisionCounts.repaired_plan).toBe(1);
    (0, test_1.expect)(summary.validationCounts.valid).toBe(1);
    (0, test_1.expect)(summary.appliedRepairs).toBe(1);
    (0, test_1.expect)(summary.blockedRepairs).toBe(0);
    (0, test_1.expect)(summary.avgDurationMs).toBe(1234);
    (0, test_1.expect)(summary.maxDurationMs).toBe(1234);
    (0, test_1.expect)(summary.targets).toHaveLength(1);
    (0, test_1.expect)(summary.targets[0].selectedCandidateId).toBe("el-1");
});
(0, test_1.test)("case summary with no_safe_action", () => {
    const steps = [
        {
            index: 1,
            targetText: "Ambiguous Target",
            action: "click",
            aiRepairDiagnostics: {
                enabled: true,
                providerName: "gemini",
                model: "gemini-2.5-flash",
                failureType: "target_not_found",
                target: "Ambiguous Target",
                decisionStatus: "no_safe_action",
                validationStatus: "valid",
                selectedCandidateId: null,
                blockedReason: null,
                durationMs: 800
            }
        }
    ];
    const summary = (0, ai_repair_summary_builder_1.buildAiRepairCaseSummary)(steps);
    (0, test_1.expect)(summary.enabled).toBe(true);
    (0, test_1.expect)(summary.invocations).toBe(1);
    (0, test_1.expect)(summary.decisionCounts.no_safe_action).toBe(1);
    (0, test_1.expect)(summary.appliedRepairs).toBe(0);
    (0, test_1.expect)(summary.blockedRepairs).toBe(0);
    (0, test_1.expect)(summary.avgDurationMs).toBe(800);
});
(0, test_1.test)("case summary with blocked sensitive action", () => {
    const steps = [
        {
            index: 1,
            targetText: "Confirm Payment",
            action: "click",
            aiRepairDiagnostics: {
                enabled: true,
                providerName: "gemini",
                model: "gemini-2.5-flash",
                failureType: "target_not_found",
                target: "Confirm Payment",
                decisionStatus: "invalid_response",
                validationStatus: "blocked",
                selectedCandidateId: "btn-payment",
                blockedReason: "AI_REPAIR_SENSITIVE_ACTION_BLOCKED",
                durationMs: 500
            }
        }
    ];
    const summary = (0, ai_repair_summary_builder_1.buildAiRepairCaseSummary)(steps);
    (0, test_1.expect)(summary.enabled).toBe(true);
    (0, test_1.expect)(summary.invocations).toBe(1);
    (0, test_1.expect)(summary.decisionCounts.invalid_response).toBe(1);
    (0, test_1.expect)(summary.validationCounts.blocked).toBe(1);
    (0, test_1.expect)(summary.appliedRepairs).toBe(0);
    (0, test_1.expect)(summary.blockedRepairs).toBe(1);
    (0, test_1.expect)(summary.targets[0].blockedReason).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
});
(0, test_1.test)("case summary with provider error", () => {
    const steps = [
        {
            index: 1,
            targetText: "Target",
            action: "click",
            aiRepairDiagnostics: {
                enabled: true,
                providerName: "gemini",
                model: "gemini-2.5-flash",
                failureType: "target_not_found",
                target: "Target",
                decisionStatus: "provider_error",
                validationStatus: "error",
                selectedCandidateId: null,
                blockedReason: "network_timeout",
                durationMs: 5000
            }
        }
    ];
    const summary = (0, ai_repair_summary_builder_1.buildAiRepairCaseSummary)(steps);
    (0, test_1.expect)(summary.enabled).toBe(true);
    (0, test_1.expect)(summary.invocations).toBe(1);
    (0, test_1.expect)(summary.decisionCounts.provider_error).toBe(1);
    (0, test_1.expect)(summary.validationCounts.error).toBe(1);
    (0, test_1.expect)(summary.avgDurationMs).toBe(5000);
});
(0, test_1.test)("batch summary aggregates multiple cases", () => {
    const caseSummaries = [
        {
            caseId: "C001",
            appSlug: "app-1",
            summary: {
                enabled: true,
                invocations: 2,
                providerName: "gemini",
                model: "gemini-2.5-flash",
                decisionCounts: { repaired_plan: 1, no_safe_action: 1, needs_more_context: 0, invalid_response: 0, provider_error: 0, provider_disabled: 0 },
                validationCounts: { valid: 2, blocked: 0, invalid: 0, error: 0 },
                repairTypeCounts: { target_resolution: 1, route_recovery: 0, assertion_resolution: 0, pom_method_missing: 0, selection_resolution: 0, missing_intermediate_step: 0, unknown: 1 },
                appliedRepairs: 1,
                blockedRepairs: 0,
                avgDurationMs: 1000,
                maxDurationMs: 1500,
                targets: []
            }
        },
        {
            caseId: "C002",
            appSlug: "app-1",
            summary: {
                enabled: true,
                invocations: 1,
                providerName: "gemini",
                model: "gemini-2.5-flash",
                decisionCounts: { repaired_plan: 0, no_safe_action: 0, needs_more_context: 0, invalid_response: 1, provider_error: 0, provider_disabled: 0 },
                validationCounts: { valid: 0, blocked: 1, invalid: 0, error: 0 },
                repairTypeCounts: { target_resolution: 0, route_recovery: 0, assertion_resolution: 0, pom_method_missing: 0, selection_resolution: 0, missing_intermediate_step: 0, unknown: 1 },
                appliedRepairs: 0,
                blockedRepairs: 1,
                avgDurationMs: 500,
                maxDurationMs: 500,
                targets: []
            }
        },
        {
            caseId: "C003",
            appSlug: "app-2",
            summary: {
                enabled: false,
                invocations: 0,
                providerName: null,
                model: null,
                decisionCounts: { repaired_plan: 0, no_safe_action: 0, needs_more_context: 0, invalid_response: 0, provider_error: 0, provider_disabled: 0 },
                validationCounts: { valid: 0, blocked: 0, invalid: 0, error: 0 },
                repairTypeCounts: { target_resolution: 0, route_recovery: 0, assertion_resolution: 0, pom_method_missing: 0, selection_resolution: 0, missing_intermediate_step: 0, unknown: 0 },
                appliedRepairs: 0,
                blockedRepairs: 0,
                avgDurationMs: 0,
                maxDurationMs: 0,
                targets: []
            }
        }
    ];
    const batch = (0, ai_repair_summary_builder_1.buildAiRepairBatchSummary)(caseSummaries);
    (0, test_1.expect)(batch.casesWithAiRepair).toBe(2);
    (0, test_1.expect)(batch.totalInvocations).toBe(3);
    (0, test_1.expect)(batch.appliedRepairs).toBe(1);
    (0, test_1.expect)(batch.blockedRepairs).toBe(1);
    (0, test_1.expect)(batch.invalidResponses).toBe(1);
    (0, test_1.expect)(batch.byProvider.gemini).toBeDefined();
    (0, test_1.expect)(batch.byProvider.gemini.invocations).toBe(3);
    (0, test_1.expect)(batch.cases).toHaveLength(2);
});
(0, test_1.test)("console output does not print secrets", () => {
    const summary = {
        enabled: true,
        invocations: 1,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        decisionCounts: { repaired_plan: 1, no_safe_action: 0, needs_more_context: 0, invalid_response: 0, provider_error: 0, provider_disabled: 0 },
        validationCounts: { valid: 1, blocked: 0, invalid: 0, error: 0 },
        repairTypeCounts: { target_resolution: 1, route_recovery: 0, assertion_resolution: 0, pom_method_missing: 0, selection_resolution: 0, missing_intermediate_step: 0, unknown: 0 },
        appliedRepairs: 1,
        blockedRepairs: 0,
        avgDurationMs: 1234,
        maxDurationMs: 1234,
        targets: [
            {
                stepIndex: 1,
                target: "Login with password=secret123",
                action: "click",
                decisionStatus: "repaired_plan",
                validationStatus: "valid",
                repairType: "target_resolution",
                selectedCandidateId: "btn-login",
                blockedReason: null,
                durationMs: 1234,
                providerName: "gemini",
                model: "gemini-2.5-flash"
            }
        ]
    };
    const output = (0, ai_repair_summary_builder_1.formatAiRepairConsoleOutput)(summary);
    (0, test_1.expect)(output).not.toContain("secret123");
    (0, test_1.expect)(output).not.toContain("password");
    (0, test_1.expect)(output).toContain("invocations=1");
    (0, test_1.expect)(output).toContain("applied=1");
});
(0, test_1.test)("batch console output format", () => {
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
    const output = (0, ai_repair_summary_builder_1.formatAiRepairBatchConsoleOutput)(batch);
    (0, test_1.expect)(output).toContain("casesWithAiRepair=2");
    (0, test_1.expect)(output).toContain("totalInvocations=4");
    (0, test_1.expect)(output).toContain("applied=2");
    (0, test_1.expect)(output).toContain("blocked=1");
    (0, test_1.expect)(output).toContain("providerErrors=1");
    (0, test_1.expect)(output).toContain("avgDurationMs=1100");
});
(0, test_1.test)("console output for zero invocations", () => {
    const summary = (0, ai_repair_summary_builder_1.buildAiRepairCaseSummary)([]);
    const output = (0, ai_repair_summary_builder_1.formatAiRepairConsoleOutput)(summary);
    (0, test_1.expect)(output).toBe("[ai-repair:summary] invocations=0");
});
(0, test_1.test)("batch console output for zero invocations", () => {
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
    const output = (0, ai_repair_summary_builder_1.formatAiRepairBatchConsoleOutput)(batch);
    (0, test_1.expect)(output).toBe("[ai-repair:batch-summary] casesWithAiRepair=0");
});
