"use strict";
/**
 * AI Selection Resolution Smoke Test
 *
 * Technical smoke test for AI selection_resolution repair type.
 * Tests that AI can select existing candidateId for ambiguous selections,
 * without inventing selectors or selecting sensitive options.
 *
 * Scenarios:
 * 1. Valid selection_resolution with existing visible candidate
 * 2. No safe action when only sensitive candidates available
 * 3. Unknown candidateId is blocked
 * 4. Sensitive candidate is blocked
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_decision_validator_1 = require("../../src/ai/repair/repair-decision-validator");
const ai_repair_orchestrator_1 = require("../../src/ai/repair/ai-repair-orchestrator");
const SELECTION_CANDIDATES = [
    {
        candidateId: "product-a",
        role: "button",
        name: "Product A",
        text: "Product A - $10",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    },
    {
        candidateId: "product-b",
        role: "button",
        name: "Product B",
        text: "Product B - $20",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    },
    {
        candidateId: "product-c",
        role: "button",
        name: "Product C",
        text: "Product C - $30",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    }
];
const SENSITIVE_SELECTION_CANDIDATES = [
    {
        candidateId: "payment-confirm",
        role: "button",
        name: "Confirm Payment",
        text: "Pay $100",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: true
    },
    {
        candidateId: "terms-accept",
        role: "checkbox",
        name: "Accept Terms",
        text: "I accept the terms and conditions",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: true
    }
];
test_1.test.describe("AI Selection Resolution Smoke", () => {
    (0, test_1.test)("selection resolved with existing visible candidate", async () => {
        const decision = {
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "product-a",
            selectionStatus: "selected",
            reason: "Candidate best matches the requested product.",
            confidence: 0.85
        };
        const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
            candidates: SELECTION_CANDIDATES,
            mustUseVisibleCandidate: true,
            blockSensitiveActions: true
        });
        (0, test_1.expect)(result.valid).toBe(true);
        if (result.valid) {
            (0, test_1.expect)(result.decision.repairType).toBe("selection_resolution");
            (0, test_1.expect)(result.decision.candidateId).toBe("product-a");
            (0, test_1.expect)(result.decision.selectionStatus).toBe("selected");
        }
    });
    (0, test_1.test)("no safe action when only sensitive candidates available", async () => {
        const decision = {
            decision: "no_safe_action",
            repairType: "selection_resolution",
            reason: "Cannot safely select sensitive payment/terms options without user confirmation.",
            confidence: 0.8
        };
        const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
            candidates: SENSITIVE_SELECTION_CANDIDATES,
            blockSensitiveActions: true
        });
        (0, test_1.expect)(result.valid).toBe(true);
        if (result.valid) {
            (0, test_1.expect)(result.decision.decision).toBe("no_safe_action");
            (0, test_1.expect)(result.decision.repairType).toBe("selection_resolution");
            (0, test_1.expect)(result.decision.candidateId).toBeUndefined();
        }
    });
    (0, test_1.test)("blocks unknown candidateId", async () => {
        const decision = {
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "unknown-product-999",
            reason: "Select this product.",
            confidence: 0.7
        };
        const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
            candidates: SELECTION_CANDIDATES
        });
        (0, test_1.expect)(result.valid).toBe(false);
        if (!result.valid) {
            (0, test_1.expect)(result.code).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
            (0, test_1.expect)(result.message).toContain("unknown-product-999");
        }
    });
    (0, test_1.test)("blocks sensitive candidate for selection", async () => {
        const decision = {
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "payment-confirm",
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
    (0, test_1.test)("orchestrator returns valid selection_resolution with fake provider", async () => {
        // Fake provider que devuelve respuesta controlada
        const fakeProvider = {
            providerType: "fake",
            providerName: "fake-selection",
            model: "fake",
            completeJson: async () => ({
                rawText: JSON.stringify({
                    decision: "repaired_plan",
                    repairType: "selection_resolution",
                    candidateId: "product-b",
                    selectionStatus: "selected",
                    reason: "Product B best matches the selection criteria.",
                    confidence: 0.82
                }),
                parsedJson: {
                    decision: "repaired_plan",
                    repairType: "selection_resolution",
                    candidateId: "product-b",
                    selectionStatus: "selected",
                    reason: "Product B best matches the selection criteria.",
                    confidence: 0.82
                },
                model: "fake",
                providerName: "fake-selection",
                durationMs: 10
            })
        };
        const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
            appSlug: "arquitectura-automatizacion",
            failure: "ambiguous_selection",
            failureType: "ambiguous_selection",
            currentStep: "select product",
            currentUrl: "https://example.com/products",
            candidates: SELECTION_CANDIDATES,
            selectionCandidates: SELECTION_CANDIDATES,
            selectionTarget: "Product B",
            selectionIntent: "select the mid-range product",
            constraints: [
                "Do not invent selectors",
                "Must use existing candidateId from candidates list",
                "Do not select sensitive options"
            ],
            provider: fakeProvider
        });
        (0, test_1.expect)(result.status).toBe("repaired_plan");
        (0, test_1.expect)(result.decision?.repairType).toBe("selection_resolution");
        (0, test_1.expect)(result.decision?.candidateId).toBe("product-b");
        (0, test_1.expect)(result.decision?.selectionStatus).toBe("selected");
        (0, test_1.expect)(result.diagnostics.repairType).toBe("selection_resolution");
        (0, test_1.expect)(result.diagnostics.failureType).toBe("ambiguous_selection");
        (0, test_1.expect)(result.diagnostics.selectedCandidateId).toBe("product-b");
        (0, test_1.expect)(result.diagnostics.candidateCount).toBe(3);
    });
    (0, test_1.test)("orchestrator blocks unknown candidateId from AI", async () => {
        // Fake provider que devuelve candidateId inexistente
        const fakeProvider = {
            providerType: "fake",
            providerName: "fake-selection",
            model: "fake",
            completeJson: async () => ({
                rawText: JSON.stringify({
                    decision: "repaired_plan",
                    repairType: "selection_resolution",
                    candidateId: "ai-invented-product",
                    reason: "Select invented product.",
                    confidence: 0.6
                }),
                parsedJson: {
                    decision: "repaired_plan",
                    repairType: "selection_resolution",
                    candidateId: "ai-invented-product",
                    reason: "Select invented product.",
                    confidence: 0.6
                },
                model: "fake",
                providerName: "fake-selection",
                durationMs: 10
            })
        };
        const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
            appSlug: "arquitectura-automatizacion",
            failure: "ambiguous_selection",
            failureType: "ambiguous_selection",
            currentStep: "select product",
            currentUrl: "https://example.com/products",
            candidates: SELECTION_CANDIDATES,
            selectionCandidates: SELECTION_CANDIDATES,
            selectionTarget: "any product",
            provider: fakeProvider
        });
        (0, test_1.expect)(result.status).toBe("invalid_response");
        (0, test_1.expect)(result.diagnostics.errorCode).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
    });
    (0, test_1.test)("orchestrator blocks sensitive candidate from AI", async () => {
        // Fake provider que devuelve sensitive candidate
        const fakeProvider = {
            providerType: "fake",
            providerName: "fake-selection",
            model: "fake",
            completeJson: async () => ({
                rawText: JSON.stringify({
                    decision: "repaired_plan",
                    repairType: "selection_resolution",
                    candidateId: "terms-accept",
                    reason: "Accept terms to continue.",
                    confidence: 0.75
                }),
                parsedJson: {
                    decision: "repaired_plan",
                    repairType: "selection_resolution",
                    candidateId: "terms-accept",
                    reason: "Accept terms to continue.",
                    confidence: 0.75
                },
                model: "fake",
                providerName: "fake-selection",
                durationMs: 10
            })
        };
        const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
            appSlug: "arquitectura-automatizacion",
            failure: "ambiguous_selection",
            failureType: "ambiguous_selection",
            currentStep: "accept terms",
            currentUrl: "https://example.com/checkout",
            candidates: SENSITIVE_SELECTION_CANDIDATES,
            selectionCandidates: SENSITIVE_SELECTION_CANDIDATES,
            selectionTarget: "terms acceptance",
            constraints: ["Do not select sensitive options"],
            provider: fakeProvider
        });
        (0, test_1.expect)(result.status).toBe("invalid_response");
        (0, test_1.expect)(result.diagnostics.errorCode).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
    });
});
