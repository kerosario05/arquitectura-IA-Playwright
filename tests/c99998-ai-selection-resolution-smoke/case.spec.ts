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

import { test, expect } from "@playwright/test";
import { validateRepairDecision } from "../../src/ai/repair/repair-decision-validator";
import { runAiRepairOrchestrator } from "../../src/ai/repair/ai-repair-orchestrator";
import type { RepairCandidateForValidation } from "../../src/ai/repair/repair-decision-validator";

const SELECTION_CANDIDATES: RepairCandidateForValidation[] = [
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

const SENSITIVE_SELECTION_CANDIDATES: RepairCandidateForValidation[] = [
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

test.describe("AI Selection Resolution Smoke", () => {
  test("selection resolved with existing visible candidate", async () => {
    const decision = {
      decision: "repaired_plan" as const,
      repairType: "selection_resolution" as const,
      candidateId: "product-a",
      selectionStatus: "selected" as const,
      reason: "Candidate best matches the requested product.",
      confidence: 0.85
    };

    const result = validateRepairDecision(decision, {
      candidates: SELECTION_CANDIDATES,
      mustUseVisibleCandidate: true,
      blockSensitiveActions: true
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.decision.repairType).toBe("selection_resolution");
      expect(result.decision.candidateId).toBe("product-a");
      expect(result.decision.selectionStatus).toBe("selected");
    }
  });

  test("no safe action when only sensitive candidates available", async () => {
    const decision = {
      decision: "no_safe_action" as const,
      repairType: "selection_resolution" as const,
      reason: "Cannot safely select sensitive payment/terms options without user confirmation.",
      confidence: 0.8
    };

    const result = validateRepairDecision(decision, {
      candidates: SENSITIVE_SELECTION_CANDIDATES,
      blockSensitiveActions: true
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.decision.decision).toBe("no_safe_action");
      expect(result.decision.repairType).toBe("selection_resolution");
      expect(result.decision.candidateId).toBeUndefined();
    }
  });

  test("blocks unknown candidateId", async () => {
    const decision = {
      decision: "repaired_plan" as const,
      repairType: "selection_resolution" as const,
      candidateId: "unknown-product-999",
      reason: "Select this product.",
      confidence: 0.7
    };

    const result = validateRepairDecision(decision, {
      candidates: SELECTION_CANDIDATES
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
      expect(result.message).toContain("unknown-product-999");
    }
  });

  test("blocks sensitive candidate for selection", async () => {
    const decision = {
      decision: "repaired_plan" as const,
      repairType: "selection_resolution" as const,
      candidateId: "payment-confirm",
      reason: "Confirm payment selection.",
      confidence: 0.75
    };

    const result = validateRepairDecision(decision, {
      candidates: SENSITIVE_SELECTION_CANDIDATES,
      blockSensitiveActions: true
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
    }
  });

  test("orchestrator returns valid selection_resolution with fake provider", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              decision: "repaired_plan",
              repairType: "selection_resolution",
              candidateId: "product-b",
              selectionStatus: "selected",
              reason: "Product B best matches the selection criteria.",
              confidence: 0.82
            })
          }
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as any;

    try {
      const result = await runAiRepairOrchestrator({
        appSlug: "arquitectura-automatizacion",
        failure: "ambiguous_selection",
        failureType: "ambiguous_selection" as any,
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
        ]
      });

      expect(result.status).toBe("repaired_plan");
      expect(result.decision?.repairType).toBe("selection_resolution");
      expect(result.decision?.candidateId).toBe("product-b");
      expect(result.decision?.selectionStatus).toBe("selected");
      expect(result.diagnostics.repairType).toBe("selection_resolution");
      expect(result.diagnostics.failureType).toBe("ambiguous_selection");
      expect(result.diagnostics.selectedCandidateId).toBe("product-b");
      expect(result.diagnostics.candidateCount).toBe(3);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("orchestrator blocks unknown candidateId from AI", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              decision: "repaired_plan",
              repairType: "selection_resolution",
              candidateId: "ai-invented-product",
              reason: "Select invented product.",
              confidence: 0.6
            })
          }
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as any;

    try {
      const result = await runAiRepairOrchestrator({
        appSlug: "arquitectura-automatizacion",
        failure: "ambiguous_selection",
        failureType: "ambiguous_selection" as any,
        currentStep: "select product",
        currentUrl: "https://example.com/products",
        candidates: SELECTION_CANDIDATES,
        selectionCandidates: SELECTION_CANDIDATES,
        selectionTarget: "any product"
      });

      expect(result.status).toBe("invalid_response");
      expect(result.diagnostics.errorCode).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("orchestrator blocks sensitive candidate from AI", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              decision: "repaired_plan",
              repairType: "selection_resolution",
              candidateId: "terms-accept",
              reason: "Accept terms to continue.",
              confidence: 0.75
            })
          }
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    )) as any;

    try {
      const result = await runAiRepairOrchestrator({
        appSlug: "arquitectura-automatizacion",
        failure: "ambiguous_selection",
        failureType: "ambiguous_selection" as any,
        currentStep: "accept terms",
        currentUrl: "https://example.com/checkout",
        candidates: SENSITIVE_SELECTION_CANDIDATES,
        selectionCandidates: SENSITIVE_SELECTION_CANDIDATES,
        selectionTarget: "terms acceptance",
        constraints: ["Do not select sensitive options"]
      });

      expect(result.status).toBe("invalid_response");
      expect(result.diagnostics.errorCode).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
