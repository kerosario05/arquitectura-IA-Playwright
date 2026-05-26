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

import { test, expect } from "@playwright/test";
import { validateRepairDecision, type RepairEvidenceForValidation } from "../../src/ai/repair/repair-decision-validator";
import { runAiRepairOrchestrator } from "../../src/ai/repair/ai-repair-orchestrator";
import type { RepairEvidence } from "../../src/ai/repair/repair-context-pack";

const SAFE_EVIDENCE: RepairEvidence[] = [
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

const SENSITIVE_EVIDENCE: RepairEvidence[] = [
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

test.describe("AI Assertion Resolution Smoke", () => {
  test("assertion satisfied with existing visible evidence", async () => {
    const decision = {
      decision: "repaired_plan" as const,
      repairType: "assertion_resolution" as const,
      evidenceId: "ev-success-msg",
      assertionStatus: "satisfied_by_existing_evidence" as const,
      reason: "Success feedback message confirms item was added to cart.",
      confidence: 0.95
    };

    const result = validateRepairDecision(decision, {
      candidates: SAFE_CANDIDATES,
      evidenceCandidates: SAFE_EVIDENCE,
      mustUseVisibleCandidate: true,
      blockSensitiveActions: true
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.decision.repairType).toBe("assertion_resolution");
      expect(result.decision.evidenceId).toBe("ev-success-msg");
      expect(result.decision.assertionStatus).toBe("satisfied_by_existing_evidence");
    }
  });

  test("no safe action when only sensitive evidence available", async () => {
    const decision = {
      decision: "no_safe_action" as const,
      repairType: "assertion_resolution" as const,
      reason: "Cannot satisfy assertion without using sensitive evidence (password/OTP fields).",
      confidence: 0.8
    };

    const result = validateRepairDecision(decision, {
      candidates: SAFE_CANDIDATES,
      evidenceCandidates: SENSITIVE_EVIDENCE,
      blockAuthSecrets: true
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.decision.decision).toBe("no_safe_action");
      expect(result.decision.repairType).toBe("assertion_resolution");
      expect(result.decision.evidenceId).toBeUndefined();
    }
  });

  test("blocks unknown evidenceId", async () => {
    const decision = {
      decision: "repaired_plan" as const,
      repairType: "assertion_resolution" as const,
      evidenceId: "ev-unknown-999",
      assertionStatus: "satisfied_by_existing_evidence" as const,
      reason: "Evidence confirms assertion.",
      confidence: 0.8
    };

    const result = validateRepairDecision(decision, {
      candidates: SAFE_CANDIDATES,
      evidenceCandidates: SAFE_EVIDENCE
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("AI_REPAIR_UNKNOWN_EVIDENCE");
      expect(result.message).toContain("ev-unknown-999");
    }
  });

  test("blocks sensitive evidence for assertion", async () => {
    const decision = {
      decision: "repaired_plan" as const,
      repairType: "assertion_resolution" as const,
      evidenceId: "ev-password-field",
      assertionStatus: "satisfied_by_existing_evidence" as const,
      reason: "Password field confirms user entered credentials.",
      confidence: 0.75
    };

    const result = validateRepairDecision(decision, {
      candidates: SAFE_CANDIDATES,
      evidenceCandidates: SENSITIVE_EVIDENCE,
      blockAuthSecrets: true
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("AI_REPAIR_SENSITIVE_ASSERTION_BLOCKED");
    }
  });

  test("orchestrator returns valid assertion_resolution with fake provider", async () => {
    // Fake provider que devuelve respuesta controlada
    const fakeProvider = {
      providerType: "fake" as const,
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

    const result = await runAiRepairOrchestrator({
      appSlug: "arquitectura-automatizacion",
      failure: "assertion_not_satisfied",
      failureType: "assertion_not_satisfied" as any,
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

    expect(result.status).toBe("repaired_plan");
    expect(result.decision?.repairType).toBe("assertion_resolution");
    expect(result.decision?.evidenceId).toBe("ev-cart-count");
    expect(result.decision?.assertionStatus).toBe("satisfied_by_existing_evidence");
    expect(result.diagnostics.repairType).toBe("assertion_resolution");
    expect(result.diagnostics.failureType).toBe("assertion_not_satisfied");
    expect(result.diagnostics.selectedEvidenceId).toBe("ev-cart-count");
    expect(result.diagnostics.evidenceType).toBe("text_visible");
  });

  test("orchestrator blocks unknown evidenceId from AI", async () => {
    // Fake provider que devuelve evidenceId inexistente
    const fakeProvider = {
      providerType: "fake" as const,
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

    const result = await runAiRepairOrchestrator({
      appSlug: "arquitectura-automatizacion",
      failure: "assertion_not_satisfied",
      failureType: "assertion_not_satisfied" as any,
      currentStep: "verify message",
      currentUrl: "https://example.com/page",
      candidates: SAFE_CANDIDATES,
      evidenceCandidates: SAFE_EVIDENCE,
      assertionTarget: "message visible",
      provider: fakeProvider
    });

    expect(result.status).toBe("invalid_response");
    expect(result.diagnostics.errorCode).toBe("AI_REPAIR_UNKNOWN_EVIDENCE");
  });

  test("orchestrator blocks sensitive evidence from AI", async () => {
    // Fake provider que devuelve sensitive evidence
    const fakeProvider = {
      providerType: "fake" as const,
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

    const result = await runAiRepairOrchestrator({
      appSlug: "arquitectura-automatizacion",
      failure: "assertion_not_satisfied",
      failureType: "assertion_not_satisfied" as any,
      currentStep: "verify OTP entered",
      currentUrl: "https://example.com/otp",
      candidates: SAFE_CANDIDATES,
      evidenceCandidates: SENSITIVE_EVIDENCE,
      assertionTarget: "OTP field should contain code",
      constraints: ["Do not use sensitive evidence"],
      provider: fakeProvider
    });

    expect(result.status).toBe("invalid_response");
    expect(result.diagnostics.errorCode).toBe("AI_REPAIR_SENSITIVE_ASSERTION_BLOCKED");
  });
});
