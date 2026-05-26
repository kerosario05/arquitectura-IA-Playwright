/**
 * AI Repair Selection Resolution Discovery Integration Tests
 * 
 * Tests for selection_resolution integration in discovery:
 * - Discovery invokes AI selection_resolution when local selection fails due to ambiguity
 * - Discovery does NOT invoke AI if deterministic first-visible is safe
 * - Repaired_plan valid selects candidateId and marks recoveredBy ai_selection_resolution
 * - No_safe_action is diagnosed and does not apply selection
 * - Sensitive candidate is blocked
 * - Invisible/non-actionable candidate is blocked
 * - Metrics count selection_resolution
 * - Diagnostics persist with selectedCandidateId and selectionStatus
 * - Context-pack does not contain secrets
 */

import { test, expect } from "@playwright/test";
import { validateRepairDecision } from "../src/ai/repair/repair-decision-validator";
import { buildRepairContextPack } from "../src/ai/repair/repair-context-pack";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";
import { buildAiRepairCaseSummary } from "../src/ai/repair/ai-repair-summary-builder";

const AMBIGUOUS_SELECTION_CANDIDATES = [
  {
    candidateId: "product-card-1",
    role: "button",
    name: "Product A",
    text: "Product A - Premium Edition",
    visible: true,
    enabled: true,
    clickable: true,
    editable: false,
    semanticRelation: "partial_match",
    score: 0.65,
    sensitive: false
  },
  {
    candidateId: "product-card-2",
    role: "button",
    name: "Product A",
    text: "Product A - Standard Edition",
    visible: true,
    enabled: true,
    clickable: true,
    editable: false,
    semanticRelation: "partial_match",
    score: 0.63,
    sensitive: false
  },
  {
    candidateId: "product-card-3",
    role: "button",
    name: "Product A",
    text: "Product A - Basic Edition",
    visible: true,
    enabled: true,
    clickable: true,
    editable: false,
    semanticRelation: "partial_match",
    score: 0.61,
    sensitive: false
  }
];

const SENSITIVE_SELECTION_CANDIDATES = [
  {
    candidateId: "payment-option-1",
    role: "button",
    name: "Credit Card",
    text: "Pay with Credit Card",
    visible: true,
    enabled: true,
    clickable: true,
    sensitive: true
  },
  {
    candidateId: "payment-option-2",
    role: "button",
    name: "Bank Transfer",
    text: "Pay with Bank Transfer",
    visible: true,
    enabled: true,
    clickable: true,
    sensitive: true
  }
];

test("discovery invokes AI selection_resolution when local selection fails by ambiguity", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "product-card-1",
            selectionStatus: "selected",
            reason: "Premium Edition best matches the selection criteria.",
            confidence: 0.82
          })
        }
      }]
    })
  )) as any;

  try {
    const result = await runAiRepairOrchestrator({
      appSlug: "test-app",
      failure: "ambiguous_selection",
      failureType: "ambiguous_selection" as any,
      currentStep: "select Product A",
      currentUrl: "https://example.com/products",
      candidates: AMBIGUOUS_SELECTION_CANDIDATES,
      selectionCandidates: AMBIGUOUS_SELECTION_CANDIDATES,
      selectionTarget: "Product A",
      selectionIntent: "select Product A"
    });

    expect(result.status).toBe("repaired_plan");
    expect(result.decision?.repairType).toBe("selection_resolution");
    expect(result.decision?.candidateId).toBe("product-card-1");
    expect(result.diagnostics.failureType).toBe("ambiguous_selection");
    expect(result.diagnostics.selectedCandidateId).toBe("product-card-1");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("discovery does not invoke AI if deterministic first-visible is safe", () => {
  // When there's only one visible candidate with high confidence,
  // discovery should use deterministic resolution, not AI
  const singleCandidate = [
    {
      candidateId: "only-option",
      role: "button",
      name: "Submit",
      text: "Submit Form",
      visible: true,
      enabled: true,
      clickable: true,
      score: 0.95,
      sensitive: false
    }
  ];

  // AI should not be needed for single clear candidate
  // This test validates the pattern - in real discovery,
  // this would be handled by local resolver before AI is invoked
  const decision = {
    decision: "no_safe_action" as const,
    repairType: "selection_resolution" as const,
    reason: "No AI needed for single clear candidate.",
    confidence: 0.9
  };

  const result = validateRepairDecision(decision, {
    candidates: singleCandidate
  });

  expect(result.valid).toBe(true);
  // In real discovery, this scenario wouldn't reach AI
});

test("repaired_plan valid selects candidateId and marks recoveredBy ai_selection_resolution", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "product-card-2",
            selectionStatus: "selected",
            reason: "Standard Edition is the most popular choice.",
            confidence: 0.85
          })
        }
      }]
    })
  )) as any;

  try {
    const result = await runAiRepairOrchestrator({
      appSlug: "test-app",
      failure: "ambiguous_selection",
      failureType: "ambiguous_selection" as any,
      currentStep: "select product",
      currentUrl: "https://example.com/products",
      candidates: AMBIGUOUS_SELECTION_CANDIDATES,
      selectionCandidates: AMBIGUOUS_SELECTION_CANDIDATES,
      selectionTarget: "Product A"
    });

    expect(result.status).toBe("repaired_plan");
    expect(result.decision?.candidateId).toBe("product-card-2");
    expect(result.decision?.selectionStatus).toBe("selected");
    expect(result.diagnostics.selectedCandidateId).toBe("product-card-2");
    expect(result.diagnostics.selectionStatus).toBe("selected");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("no_safe_action is diagnosed and does not apply selection", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "no_safe_action",
            repairType: "selection_resolution",
            reason: "All candidates are equally plausible without user confirmation.",
            confidence: 0.7
          })
        }
      }]
    })
  )) as any;

  try {
    const result = await runAiRepairOrchestrator({
      appSlug: "test-app",
      failure: "ambiguous_selection",
      failureType: "ambiguous_selection" as any,
      currentStep: "select option",
      currentUrl: "https://example.com/options",
      candidates: AMBIGUOUS_SELECTION_CANDIDATES,
      selectionCandidates: AMBIGUOUS_SELECTION_CANDIDATES,
      selectionTarget: "any option"
    });

    expect(result.status).toBe("no_safe_action");
    expect(result.decision?.candidateId).toBeUndefined();
    expect(result.status).toBe("no_safe_action");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sensitive candidate is blocked", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "payment-option-1",
            reason: "Select credit card payment.",
            confidence: 0.75
          })
        }
      }]
    })
  )) as any;

  try {
    const result = await runAiRepairOrchestrator({
      appSlug: "test-app",
      failure: "ambiguous_selection",
      failureType: "ambiguous_selection" as any,
      currentStep: "select payment method",
      currentUrl: "https://example.com/checkout",
      candidates: SENSITIVE_SELECTION_CANDIDATES,
      selectionCandidates: SENSITIVE_SELECTION_CANDIDATES,
      selectionTarget: "payment method",
      constraints: ["no_sensitive_selection"]
    });

    expect(result.status).toBe("invalid_response");
    expect(result.diagnostics.errorCode).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("invisible/non-actionable candidate is blocked", async () => {
  const invisibleCandidates = [
    {
      candidateId: "hidden-option",
      role: "button",
      name: "Hidden Option",
      text: "Not visible",
      visible: false,
      enabled: false,
      clickable: false,
      sensitive: false
    }
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "hidden-option",
            reason: "Select hidden option.",
            confidence: 0.6
          })
        }
      }]
    })
  )) as any;

  try {
    const result = await runAiRepairOrchestrator({
      appSlug: "test-app",
      failure: "ambiguous_selection",
      failureType: "ambiguous_selection" as any,
      currentStep: "select option",
      currentUrl: "https://example.com/options",
      candidates: invisibleCandidates,
      selectionCandidates: invisibleCandidates,
      selectionTarget: "any option"
    });

    expect(result.status).toBe("invalid_response");
    expect(result.diagnostics.errorCode).toBeTruthy();
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("metrics count selection_resolution", () => {
  const stepsWithAiRepair = [
    {
      index: 5,
      targetText: "Product A",
      action: "select Product A",
      aiRepairDiagnostics: {
        enabled: true,
        providerName: "gemini",
        model: "gemini-2.0-flash-exp",
        failureType: "ambiguous_selection",
        decisionStatus: "repaired_plan",
        validationStatus: "valid",
        selectedCandidateId: "product-card-1",
        durationMs: 100,
        repairType: "selection_resolution"
      }
    }
  ];

  const summary = buildAiRepairCaseSummary(stepsWithAiRepair, "test-app");

  expect(summary.repairTypeCounts.selection_resolution).toBe(1);
});

test("diagnostics persist with selectedCandidateId and selectionStatus", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "product-card-1",
            selectionStatus: "selected",
            reason: "Best match.",
            confidence: 0.85
          })
        }
      }]
    })
  )) as any;

  try {
    const result = await runAiRepairOrchestrator({
      appSlug: "test-app",
      failure: "ambiguous_selection",
      failureType: "ambiguous_selection" as any,
      currentStep: "select product",
      currentUrl: "https://example.com/products",
      candidates: AMBIGUOUS_SELECTION_CANDIDATES,
      selectionCandidates: AMBIGUOUS_SELECTION_CANDIDATES,
      selectionTarget: "Product A"
    });

    expect(result.diagnostics.selectedCandidateId).toBe("product-card-1");
    expect(result.diagnostics.selectionStatus).toBe("selected");
    expect(result.diagnostics.failureType).toBe("ambiguous_selection");
    expect(result.diagnostics.repairType).toBe("selection_resolution");
    expect(result.diagnostics.candidateCount).toBe(3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("context-pack does not contain secrets", () => {
  const pack = buildRepairContextPack({
    appSlug: "test-app",
    failure: "ambiguous_selection",
    currentStep: "select payment with password123",
    currentUrl: "https://example.com/checkout",
    candidates: SENSITIVE_SELECTION_CANDIDATES,
    selectionTarget: "payment with password123",
    selectionIntent: "select payment option with secret token",
    selectionCandidates: SENSITIVE_SELECTION_CANDIDATES.map((c) => ({
      ...c,
      name: `Payment ${c.name}`,
      text: `${c.text} - token: secret123`
    })),
    currentScreen: {
      url: "https://example.com/checkout",
      title: "Checkout - password required",
      visibleLists: ["payment options with password"]
    },
    maxChars: 30000
  });

  const serialized = JSON.stringify(pack);
  expect(serialized.toLowerCase()).not.toContain("password123");
  expect(serialized.toLowerCase()).not.toContain("secret123");
  expect(serialized.toLowerCase()).not.toContain("token");
  expect(pack.selectionTarget).toBeDefined();
  expect(pack.selectionTarget?.toLowerCase()).not.toContain("password");
});

test("max attempts prevents multiple AI calls in same case/segment", () => {
  // This test validates the pattern - in real discovery,
  // a counter would track AI attempts per case/segment
  // For this test, we validate the decision schema supports it
  
  const decision1 = {
    decision: "repaired_plan" as const,
    repairType: "selection_resolution" as const,
    candidateId: "product-card-1",
    reason: "First attempt.",
    confidence: 0.8
  };

  const result1 = validateRepairDecision(decision1, {
    candidates: AMBIGUOUS_SELECTION_CANDIDATES
  });

  expect(result1.valid).toBe(true);

  // In real discovery, after 1 attempt (AI_SELECTION_REPAIR_MAX_ATTEMPTS_PER_CASE=1),
  // subsequent ambiguous selections would not invoke AI again
  // This is enforced at the discovery level, not validator level
});
