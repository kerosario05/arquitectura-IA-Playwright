"use strict";
/**
 * AI Repair Observability / Metrics Types
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyCaseSummary = createEmptyCaseSummary;
exports.createEmptyBatchSummary = createEmptyBatchSummary;
function createEmptyCaseSummary() {
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
        targets: []
    };
}
function createEmptyBatchSummary() {
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
