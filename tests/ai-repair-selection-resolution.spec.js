"use strict";
/**
 * AI Repair Selection Resolution Tests
 *
 * Tests for selection_resolution repair type:
 * - Schema accepts selection_resolution with valid candidateId
 * - Validator accepts visible/clickable/non-sensitive candidate
 * - Validator blocks unknown candidateId
 * - Validator blocks invisible candidate
 * - Validator blocks sensitive candidate
 * - Validator blocks invented selectors
 * - Context-pack redacts secrets in selection fields
 * - Orchestrator returns valid repaired_plan with selection_resolution
 * - Orchestrator handles no_safe_action
 * - Orchestrator blocks unknown candidate
 * - Metrics count selection_resolution repairType
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_decision_validator_1 = require("../src/ai/repair/repair-decision-validator");
const repair_context_pack_1 = require("../src/ai/repair/repair-context-pack");
const ai_repair_orchestrator_1 = require("../src/ai/repair/ai-repair-orchestrator");
const ai_repair_metrics_1 = require("../src/ai/repair/ai-repair-metrics");
const SELECTION_CANDIDATES = [
    {
        candidateId: "item-1",
        role: "button",
        name: "Product A",
        text: "Product A - $10",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        semanticRelation: "near_match",
        score: 0.75,
        sensitive: false
    },
    {
        candidateId: "item-2",
        role: "button",
        name: "Product B",
        text: "Product B - $20",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        semanticRelation: "partial_match",
        score: 0.65,
        sensitive: false
    },
    {
        candidateId: "item-3",
        role: "button",
        name: "Product C",
        text: "Product C - $30",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        semanticRelation: "eligible_option",
        score: 0.55,
        sensitive: false
    }
];
const SENSITIVE_SELECTION_CANDIDATES = [
    {
        candidateId: "sensitive-item",
        role: "button",
        name: "Confirm Payment",
        text: "Pay $100",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: true
    }
];
(0, test_1.test)("schema accepts selection_resolution with valid candidateId", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "selection_resolution",
        candidateId: "item-1",
        selectionStatus: "selected",
        reason: "Candidate best matches the requested option.",
        confidence: 0.82
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SELECTION_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
    if (result.valid) {
        (0, test_1.expect)(result.decision.repairType).toBe("selection_resolution");
        (0, test_1.expect)(result.decision.candidateId).toBe("item-1");
        (0, test_1.expect)(result.decision.selectionStatus).toBe("selected");
    }
});
(0, test_1.test)("validator accepts selection_resolution candidate visible/clickable/not sensitive", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "selection_resolution",
        candidateId: "item-2",
        reason: "Candidate is visible and selectable.",
        confidence: 0.78
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SELECTION_CANDIDATES,
        mustUseVisibleCandidate: true,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("validator blocks unknown candidateId for selection_resolution", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "selection_resolution",
        candidateId: "unknown-item-999",
        reason: "Select this item.",
        confidence: 0.7
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SELECTION_CANDIDATES
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
    }
});
(0, test_1.test)("validator blocks invisible candidate for selection_resolution", () => {
    const invisibleCandidates = [
        {
            candidateId: "hidden-item",
            role: "button",
            name: "Hidden Product",
            text: "Not visible",
            visible: false,
            enabled: true,
            clickable: false,
            sensitive: false
        }
    ];
    const decision = {
        decision: "repaired_plan",
        repairType: "selection_resolution",
        candidateId: "hidden-item",
        reason: "Select hidden item.",
        confidence: 0.6
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: invisibleCandidates,
        mustUseVisibleCandidate: true
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_CANDIDATE_NOT_VISIBLE");
    }
});
(0, test_1.test)("validator blocks sensitive candidate for selection_resolution", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "selection_resolution",
        candidateId: "sensitive-item",
        reason: "Confirm payment selection.",
        confidence: 0.75
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SENSITIVE_SELECTION_CANDIDATES,
        blockSensitiveActions: true
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
    }
});
(0, test_1.test)("validator blocks invented selector fields", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "selection_resolution",
        candidateId: "item-1",
        reason: "Select using getByRole.",
        confidence: 0.8,
        locator: "getByRole('button', { name: 'Product A' })"
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SELECTION_CANDIDATES
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_SELECTOR_INVENTED");
    }
});
(0, test_1.test)("context-pack redacts secrets in selection fields", () => {
    const pack = (0, repair_context_pack_1.buildRepairContextPack)({
        appSlug: "test-app",
        failure: "ambiguous_selection",
        currentStep: "select product",
        currentUrl: "https://example.com/products",
        candidates: SELECTION_CANDIDATES,
        selectionTarget: "password-protected item",
        selectionIntent: "select item with password123",
        selectionCandidates: [
            {
                candidateId: "item-secret",
                role: "button",
                name: "Secret Product",
                text: "Product with password123",
                visible: true,
                enabled: true,
                clickable: true,
                sensitive: false
            }
        ],
        currentScreen: {
            url: "https://example.com/products",
            title: "Products - password required",
            visibleLists: ["password list"]
        },
        maxChars: 30000
    });
    const serialized = JSON.stringify(pack);
    (0, test_1.expect)(serialized.toLowerCase()).not.toContain("password123");
    (0, test_1.expect)(pack.selectionTarget).toBeDefined();
    (0, test_1.expect)(pack.selectionTarget?.toLowerCase()).not.toContain("password");
});
(0, test_1.test)("orchestrator returns valid repaired_plan with selection_resolution", async () => {
    const fakeProvider = {
        providerType: "fake",
        providerName: "fake-selection",
        model: "fake",
        completeJson: async () => ({
            rawText: JSON.stringify({
                decision: "repaired_plan",
                repairType: "selection_resolution",
                candidateId: "item-1",
                selectionStatus: "selected",
                reason: "Candidate best matches the requested option.",
                confidence: 0.82
            }),
            parsedJson: {
                decision: "repaired_plan",
                repairType: "selection_resolution",
                candidateId: "item-1",
                selectionStatus: "selected",
                reason: "Candidate best matches the requested option.",
                confidence: 0.82
            },
            model: "fake",
            providerName: "fake-selection",
            durationMs: 10
        })
    };
    const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
        appSlug: "test-app",
        failure: "ambiguous_selection",
        failureType: "ambiguous_selection",
        currentStep: "select product",
        currentUrl: "https://example.com/products",
        candidates: SELECTION_CANDIDATES,
        selectionCandidates: SELECTION_CANDIDATES,
        selectionTarget: "Product A",
        selectionIntent: "select the first product",
        constraints: ["Do not invent selectors", "Must use existing candidateId"],
        provider: fakeProvider
    });
    (0, test_1.expect)(result.status).toBe("repaired_plan");
    (0, test_1.expect)(result.decision?.repairType).toBe("selection_resolution");
    (0, test_1.expect)(result.decision?.candidateId).toBe("item-1");
    (0, test_1.expect)(result.decision?.selectionStatus).toBe("selected");
    (0, test_1.expect)(result.diagnostics.repairType).toBe("selection_resolution");
    (0, test_1.expect)(result.diagnostics.failureType).toBe("ambiguous_selection");
    (0, test_1.expect)(result.diagnostics.selectedCandidateId).toBe("item-1");
    (0, test_1.expect)(result.diagnostics.candidateCount).toBe(3);
});
(0, test_1.test)("orchestrator handles no_safe_action for selection_resolution", async () => {
    const fakeProvider = {
        providerType: "fake",
        providerName: "fake-selection",
        model: "fake",
        completeJson: async () => ({
            rawText: JSON.stringify({
                decision: "no_safe_action",
                repairType: "selection_resolution",
                reason: "No candidate can be safely selected without user confirmation.",
                confidence: 0.7
            }),
            parsedJson: {
                decision: "no_safe_action",
                repairType: "selection_resolution",
                reason: "No candidate can be safely selected without user confirmation.",
                confidence: 0.7
            },
            model: "fake",
            providerName: "fake-selection",
            durationMs: 10
        })
    };
    const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
        appSlug: "test-app",
        failure: "ambiguous_selection",
        failureType: "ambiguous_selection",
        currentStep: "select payment option",
        currentUrl: "https://example.com/payment",
        candidates: SENSITIVE_SELECTION_CANDIDATES,
        selectionCandidates: SENSITIVE_SELECTION_CANDIDATES,
        selectionTarget: "payment method",
        constraints: ["Do not select sensitive options"],
        provider: fakeProvider
    });
    (0, test_1.expect)(result.status).toBe("no_safe_action");
    (0, test_1.expect)(result.decision?.repairType).toBe("selection_resolution");
    (0, test_1.expect)(result.decision?.candidateId).toBeUndefined();
});
(0, test_1.test)("orchestrator blocks unknown candidateId", async () => {
    const fakeProvider = {
        providerType: "fake",
        providerName: "fake-selection",
        model: "fake",
        completeJson: async () => ({
            rawText: JSON.stringify({
                decision: "repaired_plan",
                repairType: "selection_resolution",
                candidateId: "unknown-xyz",
                reason: "Select unknown item.",
                confidence: 0.6
            }),
            parsedJson: {
                decision: "repaired_plan",
                repairType: "selection_resolution",
                candidateId: "unknown-xyz",
                reason: "Select unknown item.",
                confidence: 0.6
            },
            model: "fake",
            providerName: "fake-selection",
            durationMs: 10
        })
    };
    const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
        appSlug: "test-app",
        failure: "ambiguous_selection",
        failureType: "ambiguous_selection",
        currentStep: "select item",
        currentUrl: "https://example.com/items",
        candidates: SELECTION_CANDIDATES,
        selectionCandidates: SELECTION_CANDIDATES,
        selectionTarget: "any item",
        provider: fakeProvider
    });
    (0, test_1.expect)(result.status).toBe("invalid_response");
    (0, test_1.expect)(result.diagnostics.errorCode).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
});
(0, test_1.test)("metrics count selection_resolution repairType", () => {
    const summary = (0, ai_repair_metrics_1.createEmptyCaseSummary)();
    summary.repairTypeCounts.selection_resolution++;
    summary.repairTypeCounts.target_resolution++;
    summary.repairTypeCounts.route_recovery++;
    summary.repairTypeCounts.assertion_resolution++;
    (0, test_1.expect)(summary.repairTypeCounts.selection_resolution).toBe(1);
    (0, test_1.expect)(summary.repairTypeCounts.target_resolution).toBe(1);
    (0, test_1.expect)(summary.repairTypeCounts.route_recovery).toBe(1);
    (0, test_1.expect)(summary.repairTypeCounts.assertion_resolution).toBe(1);
    (0, test_1.expect)(summary.repairTypeCounts.unknown).toBe(0);
});
