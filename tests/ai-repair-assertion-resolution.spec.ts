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

import { test, expect } from "@playwright/test";
import { validateRepairDecision, type RepairEvidenceForValidation } from "../src/ai/repair/repair-decision-validator";
import { buildRepairContextPack, type RepairEvidence } from "../src/ai/repair/repair-context-pack";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";
import { createEmptyCaseSummary } from "../src/ai/repair/ai-repair-metrics";

const SAFE_EVIDENCE: RepairEvidence[] = [
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

const SENSITIVE_EVIDENCE: RepairEvidence[] = [
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

test("schema accepts assertion_resolution with valid evidenceId", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "assertion_resolution" as const,
    evidenceId: "ev-feedback-1",
    assertionStatus: "satisfied_by_existing_evidence" as const,
    reason: "Evidence confirms the assertion is satisfied.",
    confidence: 0.9
  };

  const result = validateRepairDecision(decision, {
    candidates: SAFE_CANDIDATES,
    evidenceCandidates: SAFE_EVIDENCE,
    mustReturnExistingCandidateId: true
  });

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.decision.repairType).toBe("assertion_resolution");
    expect(result.decision.evidenceId).toBe("ev-feedback-1");
    expect(result.decision.assertionStatus).toBe("satisfied_by_existing_evidence");
  }
});

test("validator accepts evidenceId existing, visible, non-sensitive", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "assertion_resolution" as const,
    evidenceId: "ev-text-1",
    assertionStatus: "satisfied_by_existing_evidence" as const,
    reason: "Text is visible on screen confirming assertion.",
    confidence: 0.85
  };

  const result = validateRepairDecision(decision, {
    candidates: SAFE_CANDIDATES,
    evidenceCandidates: SAFE_EVIDENCE,
    mustUseVisibleCandidate: true
  });

  expect(result.valid).toBe(true);
});

test("validator blocks unknown evidenceId", () => {
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
  }
});

test("validator blocks sensitive evidence", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "assertion_resolution" as const,
    evidenceId: "ev-sensitive-1",
    assertionStatus: "satisfied_by_existing_evidence" as const,
    reason: "Password field confirms login.",
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

test("validator blocks invented text patterns", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "assertion_resolution" as const,
    evidenceId: "ev-feedback-1",
    assertionStatus: "satisfied_by_existing_evidence" as const,
    reason: "I think the evidence probably shows the assertion is satisfied.",
    confidence: 0.6
  };

  const result = validateRepairDecision(decision, {
    candidates: SAFE_CANDIDATES,
    evidenceCandidates: SAFE_EVIDENCE
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_ASSERTION_TEXT_INVENTED");
  }
});

test("validator blocks invented selector fields", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "assertion_resolution" as const,
    evidenceId: "ev-feedback-1",
    assertionStatus: "satisfied_by_existing_evidence" as const,
    reason: "Evidence confirms assertion.",
    confidence: 0.85,
    locator: "getByRole('button', { name: 'Submit' })"
  };

  const result = validateRepairDecision(decision, {
    candidates: SAFE_CANDIDATES,
    evidenceCandidates: SAFE_EVIDENCE
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_SELECTOR_INVENTED");
  }
});

test("context-pack redacts secrets in assertion fields", () => {
  const pack = buildRepairContextPack({
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
  expect(serialized.toLowerCase()).not.toContain("mysecretpassword");
  expect(serialized.toLowerCase()).not.toContain("secret123");
  expect(pack.assertionTarget).toBeDefined();
  expect(pack.assertionTarget?.toLowerCase()).not.toContain("password");
});

test("orchestrator returns valid repaired_plan with assertion_resolution", async () => {
  const fakeProvider = {
    providerType: "fake" as const,
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

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "assertion_not_satisfied",
    failureType: "assertion_not_satisfied" as any,
    currentStep: "verify success message",
    currentUrl: "https://example.com/cart",
    candidates: SAFE_CANDIDATES,
    evidenceCandidates: SAFE_EVIDENCE,
    assertionTarget: "success message visible",
    constraints: ["Do not invent evidence", "Must use existing evidenceId"],
    provider: fakeProvider
  });

  expect(result.status).toBe("repaired_plan");
  expect(result.decision?.repairType).toBe("assertion_resolution");
  expect(result.decision?.evidenceId).toBe("ev-feedback-1");
  expect(result.decision?.assertionStatus).toBe("satisfied_by_existing_evidence");
  expect(result.diagnostics.repairType).toBe("assertion_resolution");
  expect(result.diagnostics.failureType).toBe("assertion_not_satisfied");
});

test("orchestrator handles no_safe_action for assertion_resolution", async () => {
  const fakeProvider = {
    providerType: "fake" as const,
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

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
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

  expect(result.status).toBe("no_safe_action");
  expect(result.decision?.repairType).toBe("assertion_resolution");
  expect(result.decision?.evidenceId).toBeUndefined();
});

test("orchestrator blocks unknown evidenceId", async () => {
  const fakeProvider = {
    providerType: "fake" as const,
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

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
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

test("metrics count assertion_resolution repairType", () => {
  const summary = createEmptyCaseSummary();
  
  summary.repairTypeCounts.assertion_resolution++;
  summary.repairTypeCounts.target_resolution++;
  summary.repairTypeCounts.route_recovery++;

  expect(summary.repairTypeCounts.assertion_resolution).toBe(1);
  expect(summary.repairTypeCounts.target_resolution).toBe(1);
  expect(summary.repairTypeCounts.route_recovery).toBe(1);
  expect(summary.repairTypeCounts.unknown).toBe(0);
});
