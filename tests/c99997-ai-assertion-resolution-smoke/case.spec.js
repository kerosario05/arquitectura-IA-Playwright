"use strict";
/**
 * AI Assertion Resolution Smoke Test
 *
 * Technical smoke test for AI assertion_resolution repair type.
 * Tests that AI can select existing evidenceId to satisfy assertions,
 * without inventing evidence, selectors, or text.
 *
 * Scenarios:
 * 1. Valid assertion_resolution with existing visible evidence
 * 2. No safe action when only sensitive evidence available
 * 3. Unknown evidenceId is blocked
 * 4. Sensitive evidence is blocked
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_decision_validator_1 = require("../../src/ai/repair/repair-decision-validator");
const ai_repair_orchestrator_1 = require("../../src/ai/repair/ai-repair-orchestrator");
const SAFE_EVIDENCE = [
    {
        evidenceId: "ev-success-msg",
        type: "feedback_message",
        text: "Item added to cart successfully",
        visible: true,
        source: "feedbackEvidence",
        confidence: 0.95,
        sensitive: false
    },
    {
        evidenceId: "ev-cart-count",
        type: "text_visible",
        text: "Cart: 1 item",
        visible: true,
        source: "runtimeEvidenceTrace",
        confidence: 0.9,
        sensitive: false
    },
    {
        evidenceId: "ev-header-cart",
        type: "structural",
        text: "Cart icon visible in header",
        visible: true,
        source: "structuralEvidence",
        confidence: 0.85,
        sensitive: false
    }
];
const SENSITIVE_EVIDENCE = [
    {
        evidenceId: "ev-password-field",
        type: "form_field",
        text: "Password: ********",
        visible: true,
        source: "runtimeEvidenceTrace",
        confidence: 0.9,
        sensitive: true
    },
    {
        evidenceId: "ev-otp-field",
        type: "form_field",
        text: "OTP: 123456",
        visible: true,
        source: "runtimeEvidenceTrace",
        confidence: 0.9,
        sensitive: true
    }
];
const SAFE_CANDIDATES = [
    {
        candidateId: "btn-view-cart",
        role: "button",
        name: "View Cart",
        text: "View Cart",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    }
];
test_1.test.describe("AI Assertion Resolution Smoke", () => {
    (0, test_1.test)("assertion satisfied with existing visible evidence", async () => {
        const decision = {
            decision: "repaired_plan",
            repairType: "assertion_resolution",
            evidenceId: "ev-success-msg",
            assertionStatus: "satisfied_by_existing_evidence",
            reason: "Success feedback message confirms item was added to cart.",
            confidence: 0.95
        };
        const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
            candidates: SAFE_CANDIDATES,
            evidenceCandidates: SAFE_EVIDENCE,
            mustUseVisibleCandidate: true,
            blockSensitiveActions: true
        });
        (0, test_1.expect)(result.valid).toBe(true);
        if (result.valid) {
            (0, test_1.expect)(result.decision.repairType).toBe("assertion_resolution");
            (0, test_1.expect)(result.decision.evidenceId).toBe("ev-success-msg");
            (0, test_1.expect)(result.decision.assertionStatus).toBe("satisfied_by_existing_evidence");
        }
    });
    (0, test_1.test)("no safe action when only sensitive evidence available", async () => {
        const decision = {
            decision: "no_safe_action",
            repairType: "assertion_resolution",
            reason: "Cannot satisfy assertion without using sensitive evidence (password/OTP fields).",
            confidence: 0.8
        };
        const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
            candidates: SAFE_CANDIDATES,
            evidenceCandidates: SENSITIVE_EVIDENCE,
            blockAuthSecrets: true
        });
        (0, test_1.expect)(result.valid).toBe(true);
        if (result.valid) {
            (0, test_1.expect)(result.decision.decision).toBe("no_safe_action");
            (0, test_1.expect)(result.decision.repairType).toBe("assertion_resolution");
            (0, test_1.expect)(result.decision.evidenceId).toBeUndefined();
        }
    });
    (0, test_1.test)("blocks unknown evidenceId", async () => {
        const decision = {
            decision: "repaired_plan",
            repairType: "assertion_resolution",
            evidenceId: "ev-unknown-999",
            assertionStatus: "satisfied_by_existing_evidence",
            reason: "Evidence confirms assertion.",
            confidence: 0.8
        };
        const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
            candidates: SAFE_CANDIDATES,
            evidenceCandidates: SAFE_EVIDENCE
        });
        (0, test_1.expect)(result.valid).toBe(false);
        if (!result.valid) {
            (0, test_1.expect)(result.code).toBe("AI_REPAIR_UNKNOWN_EVIDENCE");
            (0, test_1.expect)(result.message).toContain("ev-unknown-999");
        }
    });
    (0, test_1.test)("blocks sensitive evidence for assertion", async () => {
        const decision = {
            decision: "repaired_plan",
            repairType: "assertion_resolution",
            evidenceId: "ev-password-field",
            assertionStatus: "satisfied_by_existing_evidence",
            reason: "Password field confirms user entered credentials.",
            confidence: 0.75
        };
        const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
            candidates: SAFE_CANDIDATES,
            evidenceCandidates: SENSITIVE_EVIDENCE,
            blockAuthSecrets: true
        });
        (0, test_1.expect)(result.valid).toBe(false);
        if (!result.valid) {
            (0, test_1.expect)(result.code).toBe("AI_REPAIR_SENSITIVE_ASSERTION_BLOCKED");
        }
    });
    (0, test_1.test)("orchestrator returns valid assertion_resolution with fake provider", async () => {
        // Fake provider que devuelve respuesta controlada
        const fakeProvider = {
            providerType: "fake",
            providerName: "fake-assertion",
            model: "fake",
            completeJson: async () => ({
                rawText: JSON.stringify({
                    decision: "repaired_plan",
                    repairType: "assertion_resolution",
                    evidenceId: "ev-cart-count",
                    assertionStatus: "satisfied_by_existing_evidence",
                    reason: "Cart count text confirms item was added.",
                    confidence: 0.9
                }),
                parsedJson: {
                    decision: "repaired_plan",
                    repairType: "assertion_resolution",
                    evidenceId: "ev-cart-count",
                    assertionStatus: "satisfied_by_existing_evidence",
                    reason: "Cart count text confirms item was added.",
                    confidence: 0.9
                },
                model: "fake",
                providerName: "fake-assertion",
                durationMs: 10
            })
        };
        const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
            appSlug: "arquitectura-automatizacion",
            failure: "assertion_not_satisfied",
            failureType: "assertion_not_satisfied",
            currentStep: "verify cart count updated",
            currentUrl: "https://example.com/products",
            candidates: SAFE_CANDIDATES,
            evidenceCandidates: SAFE_EVIDENCE,
            assertionTarget: "cart count should show 1 item",
            constraints: [
                "Do not invent evidence",
                "Must use existing evidenceId from evidenceCandidates",
                "Do not use sensitive evidence"
            ],
            provider: fakeProvider
        });
        (0, test_1.expect)(result.status).toBe("repaired_plan");
        (0, test_1.expect)(result.decision?.repairType).toBe("assertion_resolution");
        (0, test_1.expect)(result.decision?.evidenceId).toBe("ev-cart-count");
        (0, test_1.expect)(result.decision?.assertionStatus).toBe("satisfied_by_existing_evidence");
        (0, test_1.expect)(result.diagnostics.repairType).toBe("assertion_resolution");
        (0, test_1.expect)(result.diagnostics.failureType).toBe("assertion_not_satisfied");
        (0, test_1.expect)(result.diagnostics.selectedEvidenceId).toBe("ev-cart-count");
        (0, test_1.expect)(result.diagnostics.evidenceType).toBe("text_visible");
    });
    (0, test_1.test)("orchestrator blocks unknown evidenceId from AI", async () => {
        // Fake provider que devuelve evidenceId inexistente
        const fakeProvider = {
            providerType: "fake",
            providerName: "fake-assertion",
            model: "fake",
            completeJson: async () => ({
                rawText: JSON.stringify({
                    decision: "repaired_plan",
                    repairType: "assertion_resolution",
                    evidenceId: "ev-invented-xyz",
                    assertionStatus: "satisfied_by_existing_evidence",
                    reason: "Invented evidence confirms assertion.",
                    confidence: 0.7
                }),
                parsedJson: {
                    decision: "repaired_plan",
                    repairType: "assertion_resolution",
                    evidenceId: "ev-invented-xyz",
                    assertionStatus: "satisfied_by_existing_evidence",
                    reason: "Invented evidence confirms assertion.",
                    confidence: 0.7
                },
                model: "fake",
                providerName: "fake-assertion",
                durationMs: 10
            })
        };
        const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
            appSlug: "arquitectura-automatizacion",
            failure: "assertion_not_satisfied",
            failureType: "assertion_not_satisfied",
            currentStep: "verify message",
            currentUrl: "https://example.com/page",
            candidates: SAFE_CANDIDATES,
            evidenceCandidates: SAFE_EVIDENCE,
            assertionTarget: "message visible",
            provider: fakeProvider
        });
        (0, test_1.expect)(result.status).toBe("invalid_response");
        (0, test_1.expect)(result.diagnostics.errorCode).toBe("AI_REPAIR_UNKNOWN_EVIDENCE");
    });
    (0, test_1.test)("orchestrator blocks sensitive evidence from AI", async () => {
        // Fake provider que devuelve sensitive evidence
        const fakeProvider = {
            providerType: "fake",
            providerName: "fake-assertion",
            model: "fake",
            completeJson: async () => ({
                rawText: JSON.stringify({
                    decision: "repaired_plan",
                    repairType: "assertion_resolution",
                    evidenceId: "ev-otp-field",
                    assertionStatus: "satisfied_by_existing_evidence",
                    reason: "OTP field confirms code was entered.",
                    confidence: 0.75
                }),
                parsedJson: {
                    decision: "repaired_plan",
                    repairType: "assertion_resolution",
                    evidenceId: "ev-otp-field",
                    assertionStatus: "satisfied_by_existing_evidence",
                    reason: "OTP field confirms code was entered.",
                    confidence: 0.75
                },
                model: "fake",
                providerName: "fake-assertion",
                durationMs: 10
            })
        };
        const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
            appSlug: "arquitectura-automatizacion",
            failure: "assertion_not_satisfied",
            failureType: "assertion_not_satisfied",
            currentStep: "verify OTP entered",
            currentUrl: "https://example.com/otp",
            candidates: SAFE_CANDIDATES,
            evidenceCandidates: SENSITIVE_EVIDENCE,
            assertionTarget: "OTP field should contain code",
            constraints: ["Do not use sensitive evidence"],
            provider: fakeProvider
        });
        (0, test_1.expect)(result.status).toBe("invalid_response");
        (0, test_1.expect)(result.diagnostics.errorCode).toBe("AI_REPAIR_SENSITIVE_ASSERTION_BLOCKED");
    });
});
