"use strict";
/**
 * AI Repair Assertion Resolution Tests
 *
 * Tests for assertion_resolution repair type:
 * - Schema accepts assertion_resolution with valid evidenceId
 * - Validator accepts existing, visible, non-sensitive evidence
 * - Validator blocks unknown evidenceId
 * - Validator blocks sensitive evidence
 * - Validator blocks invented text
 * - Validator blocks invented selectors
 * - Context-pack redacts secrets in assertion fields
 * - Orchestrator returns valid repaired_plan with assertion_resolution
 * - Orchestrator handles no_safe_action
 * - Orchestrator blocks unknown evidence
 * - Metrics count assertion_resolution repairType
 */
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_decision_validator_1 = require("../src/ai/repair/repair-decision-validator");
const repair_context_pack_1 = require("../src/ai/repair/repair-context-pack");
const ai_repair_orchestrator_1 = require("../src/ai/repair/ai-repair-orchestrator");
const ai_repair_metrics_1 = require("../src/ai/repair/ai-repair-metrics");
const SAFE_EVIDENCE = [
    {
        evidenceId: "ev-feedback-1",
        type: "feedback_message",
        text: "Product added to cart successfully",
        visible: true,
        source: "feedbackEvidence",
        confidence: 0.95,
        sensitive: false
    },
    {
        evidenceId: "ev-text-1",
        type: "text_visible",
        text: "Welcome to the store",
        visible: true,
        source: "runtimeEvidenceTrace",
        confidence: 0.9,
        sensitive: false
    },
    {
        evidenceId: "ev-structural-1",
        type: "structural",
        text: "Cart button visible in header",
        visible: true,
        source: "structuralEvidence",
        confidence: 0.85,
        sensitive: false
    }
];
const SENSITIVE_EVIDENCE = [
    {
        evidenceId: "ev-sensitive-1",
        type: "form_field",
        text: "Password: ********",
        visible: true,
        source: "runtimeEvidenceTrace",
        confidence: 0.9,
        sensitive: true
    }
];
const SAFE_CANDIDATES = [
    {
        candidateId: "el-1",
        role: "button",
        name: "Add to cart",
        text: "Add to cart",
        visible: true,
        enabled: true,
        clickable: true,
        editable: false,
        sensitive: false
    }
];
(0, test_1.test)("schema accepts assertion_resolution with valid evidenceId", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "assertion_resolution",
        evidenceId: "ev-feedback-1",
        assertionStatus: "satisfied_by_existing_evidence",
        reason: "Evidence confirms the assertion is satisfied.",
        confidence: 0.9
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SAFE_CANDIDATES,
        evidenceCandidates: SAFE_EVIDENCE,
        mustReturnExistingCandidateId: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
    if (result.valid) {
        (0, test_1.expect)(result.decision.repairType).toBe("assertion_resolution");
        (0, test_1.expect)(result.decision.evidenceId).toBe("ev-feedback-1");
        (0, test_1.expect)(result.decision.assertionStatus).toBe("satisfied_by_existing_evidence");
    }
});
(0, test_1.test)("validator accepts evidenceId existing, visible, non-sensitive", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "assertion_resolution",
        evidenceId: "ev-text-1",
        assertionStatus: "satisfied_by_existing_evidence",
        reason: "Text is visible on screen confirming assertion.",
        confidence: 0.85
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SAFE_CANDIDATES,
        evidenceCandidates: SAFE_EVIDENCE,
        mustUseVisibleCandidate: true
    });
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("validator blocks unknown evidenceId", () => {
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
    }
});
(0, test_1.test)("validator blocks sensitive evidence", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "assertion_resolution",
        evidenceId: "ev-sensitive-1",
        assertionStatus: "satisfied_by_existing_evidence",
        reason: "Password field confirms login.",
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
(0, test_1.test)("validator blocks invented text patterns", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "assertion_resolution",
        evidenceId: "ev-feedback-1",
        assertionStatus: "satisfied_by_existing_evidence",
        reason: "I think the evidence probably shows the assertion is satisfied.",
        confidence: 0.6
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SAFE_CANDIDATES,
        evidenceCandidates: SAFE_EVIDENCE
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_ASSERTION_TEXT_INVENTED");
    }
});
(0, test_1.test)("validator blocks invented selector fields", () => {
    const decision = {
        decision: "repaired_plan",
        repairType: "assertion_resolution",
        evidenceId: "ev-feedback-1",
        assertionStatus: "satisfied_by_existing_evidence",
        reason: "Evidence confirms assertion.",
        confidence: 0.85,
        locator: "getByRole('button', { name: 'Submit' })"
    };
    const result = (0, repair_decision_validator_1.validateRepairDecision)(decision, {
        candidates: SAFE_CANDIDATES,
        evidenceCandidates: SAFE_EVIDENCE
    });
    (0, test_1.expect)(result.valid).toBe(false);
    if (!result.valid) {
        (0, test_1.expect)(result.code).toBe("AI_REPAIR_SELECTOR_INVENTED");
    }
});
(0, test_1.test)("context-pack redacts secrets in assertion fields", () => {
    const pack = (0, repair_context_pack_1.buildRepairContextPack)({
        appSlug: "test-app",
        failure: "assertion_not_satisfied",
        currentStep: "verify password entered",
        currentUrl: "https://example.com/login",
        candidates: SAFE_CANDIDATES,
        assertionTarget: "password field should contain value",
        assertionText: "password=secret123",
        evidenceCandidates: [
            {
                evidenceId: "ev-password",
                type: "form_field",
                text: "password=mysecretpassword",
                visible: true,
                source: "runtimeEvidenceTrace",
                sensitive: true
            }
        ],
        currentScreen: {
            url: "https://example.com/login",
            title: "Login - password form",
            visibleTextSummary: ["Enter your password"],
            visibleDialogs: ["password required"]
        },
        maxChars: 30000
    });
    const serialized = JSON.stringify(pack);
    (0, test_1.expect)(serialized.toLowerCase()).not.toContain("mysecretpassword");
    (0, test_1.expect)(serialized.toLowerCase()).not.toContain("secret123");
    (0, test_1.expect)(pack.assertionTarget).toBeDefined();
    (0, test_1.expect)(pack.assertionTarget?.toLowerCase()).not.toContain("password");
});
(0, test_1.test)("orchestrator returns valid repaired_plan with assertion_resolution", async () => {
    const fakeProvider = {
        providerType: "fake",
        providerName: "fake-assertion",
        model: "fake",
        completeJson: async () => ({
            rawText: JSON.stringify({
                decision: "repaired_plan",
                repairType: "assertion_resolution",
                evidenceId: "ev-feedback-1",
                assertionStatus: "satisfied_by_existing_evidence",
                reason: "Feedback message confirms assertion is satisfied.",
                confidence: 0.9
            }),
            parsedJson: {
                decision: "repaired_plan",
                repairType: "assertion_resolution",
                evidenceId: "ev-feedback-1",
                assertionStatus: "satisfied_by_existing_evidence",
                reason: "Feedback message confirms assertion is satisfied.",
                confidence: 0.9
            },
            model: "fake",
            providerName: "fake-assertion",
            durationMs: 10
        })
    };
    const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
        appSlug: "test-app",
        failure: "assertion_not_satisfied",
        failureType: "assertion_not_satisfied",
        currentStep: "verify success message",
        currentUrl: "https://example.com/cart",
        candidates: SAFE_CANDIDATES,
        evidenceCandidates: SAFE_EVIDENCE,
        assertionTarget: "success message visible",
        constraints: ["Do not invent evidence", "Must use existing evidenceId"],
        provider: fakeProvider
    });
    (0, test_1.expect)(result.status).toBe("repaired_plan");
    (0, test_1.expect)(result.decision?.repairType).toBe("assertion_resolution");
    (0, test_1.expect)(result.decision?.evidenceId).toBe("ev-feedback-1");
    (0, test_1.expect)(result.decision?.assertionStatus).toBe("satisfied_by_existing_evidence");
    (0, test_1.expect)(result.diagnostics.repairType).toBe("assertion_resolution");
    (0, test_1.expect)(result.diagnostics.failureType).toBe("assertion_not_satisfied");
});
(0, test_1.test)("orchestrator handles no_safe_action for assertion_resolution", async () => {
    const fakeProvider = {
        providerType: "fake",
        providerName: "fake-assertion",
        model: "fake",
        completeJson: async () => ({
            rawText: JSON.stringify({
                decision: "no_safe_action",
                repairType: "assertion_resolution",
                reason: "No existing evidence can satisfy this assertion safely.",
                confidence: 0.7
            }),
            parsedJson: {
                decision: "no_safe_action",
                repairType: "assertion_resolution",
                reason: "No existing evidence can satisfy this assertion safely.",
                confidence: 0.7
            },
            model: "fake",
            providerName: "fake-assertion",
            durationMs: 10
        })
    };
    const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
        appSlug: "test-app",
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
    (0, test_1.expect)(result.status).toBe("no_safe_action");
    (0, test_1.expect)(result.decision?.repairType).toBe("assertion_resolution");
    (0, test_1.expect)(result.decision?.evidenceId).toBeUndefined();
});
(0, test_1.test)("orchestrator blocks unknown evidenceId", async () => {
    const fakeProvider = {
        providerType: "fake",
        providerName: "fake-assertion",
        model: "fake",
        completeJson: async () => ({
            rawText: JSON.stringify({
                decision: "repaired_plan",
                repairType: "assertion_resolution",
                evidenceId: "ev-unknown-999",
                assertionStatus: "satisfied_by_existing_evidence",
                reason: "Evidence confirms assertion.",
                confidence: 0.8
            }),
            parsedJson: {
                decision: "repaired_plan",
                repairType: "assertion_resolution",
                evidenceId: "ev-unknown-999",
                assertionStatus: "satisfied_by_existing_evidence",
                reason: "Evidence confirms assertion.",
                confidence: 0.8
            },
            model: "fake",
            providerName: "fake-assertion",
            durationMs: 10
        })
    };
    const result = await (0, ai_repair_orchestrator_1.runAiRepairOrchestrator)({
        appSlug: "test-app",
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
(0, test_1.test)("metrics count assertion_resolution repairType", () => {
    const summary = (0, ai_repair_metrics_1.createEmptyCaseSummary)();
    summary.repairTypeCounts.assertion_resolution++;
    summary.repairTypeCounts.target_resolution++;
    summary.repairTypeCounts.route_recovery++;
    (0, test_1.expect)(summary.repairTypeCounts.assertion_resolution).toBe(1);
    (0, test_1.expect)(summary.repairTypeCounts.target_resolution).toBe(1);
    (0, test_1.expect)(summary.repairTypeCounts.route_recovery).toBe(1);
    (0, test_1.expect)(summary.repairTypeCounts.unknown).toBe(0);
});
