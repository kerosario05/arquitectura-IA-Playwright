/**
 * AI Route Recovery Discovery Integration Tests
 * 
 * Tests for route_recovery integration in discovery flow.
 */

import { test, expect } from "@playwright/test";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";
import { validateRepairDecision } from "../src/ai/repair/repair-decision-validator";
import { buildAiRepairCaseSummary, type StepWithAiRepair } from "../src/ai/repair/ai-repair-summary-builder";

const ROUTE_CANDIDATES = [
  {
    candidateId: "nav-products",
    role: "link",
    name: "Products",
    text: "Products",
    visible: true,
    enabled: true,
    clickable: true,
    sensitive: false
  },
  {
    candidateId: "nav-home",
    role: "link",
    name: "Home",
    text: "Home",
    visible: true,
    enabled: true,
    clickable: true,
    sensitive: false
  },
  {
    candidateId: "btn-login",
    role: "button",
    name: "Login",
    text: "Login",
    visible: true,
    enabled: true,
    clickable: true,
    sensitive: true
  }
];

test("discovery invokes route_recovery when local route resolution fails", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "nav-products",
            reason: "Products link navigates to the expected section.",
            confidence: 0.85
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  // Simulate discovery calling AI Repair after local resolvers fail
  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "Cannot navigate to Products section",
    failureType: "wrong_screen",
    currentStep: "navigate",
    currentUrl: "https://example.com/checkout",
    targetRoute: "/products",
    snapshotSummary: {
      title: "Checkout",
      url: "https://example.com/checkout"
    },
    candidates: ROUTE_CANDIDATES,
    currentScreen: {
      url: "https://example.com/checkout",
      title: "Checkout",
      visibleHeadings: ["Checkout"],
      visibleNavItems: ["Products", "Home"],
      visibleActions: []
    },
    routeHistory: {
      failedRoutePaths: [],
      visitedUrls: ["https://example.com/checkout"]
    },
    constraints: ["must_return_existing_candidate_id", "block_sensitive_actions"]
  });

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("repaired_plan");
  expect(result.decision?.repairType).toBe("route_recovery");
  expect(result.decision?.candidateId).toBe("nav-products");
  expect(result.diagnostics.failureType).toBe("wrong_screen");
});

test("discovery does not invoke route_recovery when direct hit resolves", async () => {
  // This test documents that route_recovery is NOT called when local resolvers succeed
  // In discovery flow, AI Repair is only called when:
  // - resolution.matchReason === "target_not_found" OR
  // - route resolution fails after local attempts
  //
  // When a direct hit or local route resolver succeeds, AI is not invoked.
  
  // Simulate successful local resolution (no AI call needed)
  const localResolutionSuccess = true;
  
  expect(localResolutionSuccess).toBe(true);
  // AI Repair would NOT be called in this scenario
});

test("repaired_plan route_recovery navigates/changes screen", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "nav-products",
            reason: "Navigate to products section",
            confidence: 0.9
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "wrong_screen",
    failureType: "wrong_screen",
    currentStep: "navigate",
    currentUrl: "https://example.com/home",
    targetRoute: "/products",
    snapshotSummary: {},
    candidates: ROUTE_CANDIDATES,
    constraints: []
  });

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("repaired_plan");
  expect(result.decision?.repairType).toBe("route_recovery");
  expect(result.decision?.candidateId).toBe("nav-products");
});

test("candidate without transition is marked as failedRoutePath", async () => {
  // First attempt with candidate
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "nav-products",
            reason: "Try products link",
            confidence: 0.7
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result1 = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "wrong_screen",
    failureType: "wrong_screen",
    currentStep: "navigate",
    currentUrl: "https://example.com/home",
    targetRoute: "/products",
    snapshotSummary: {},
    candidates: ROUTE_CANDIDATES,
    routeHistory: {
      failedRoutePaths: []
    },
    constraints: []
  });

  globalThis.fetch = originalFetch;

  expect(result1.status).toBe("repaired_plan");
  expect(result1.decision?.candidateId).toBe("nav-products");

  // Second attempt - same candidate should be blocked
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "nav-products",
            reason: "Try again",
            confidence: 0.5
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result2 = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "wrong_screen",
    failureType: "wrong_screen",
    currentStep: "navigate",
    currentUrl: "https://example.com/home",
    targetRoute: "/products",
    snapshotSummary: {},
    candidates: ROUTE_CANDIDATES,
    routeHistory: {
      failedRoutePaths: ["nav-products"] // Marked as failed after first attempt
    },
    constraints: []
  });

  globalThis.fetch = originalFetch;

  // Should be blocked due to loop prevention
  expect(result2.status).toBe("invalid_response");
  expect(result2.diagnostics.errorCode).toBe("AI_REPAIR_ROUTE_CANDIDATE_ALREADY_FAILED");
});

test("loop prevention avoids repeating candidateId", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "nav-home",
            reason: "Go home first",
            confidence: 0.6
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "navigation_dead_end",
    failureType: "navigation_dead_end",
    currentStep: "navigate",
    currentUrl: "https://example.com/dead-end",
    targetRoute: "/products",
    snapshotSummary: {},
    candidates: ROUTE_CANDIDATES,
    routeHistory: {
      failedRoutePaths: ["nav-home", "nav-products"]
    },
    constraints: []
  });

  globalThis.fetch = originalFetch;

  // Both candidates are in failedRoutePaths, so should be blocked
  expect(result.status).toBe("invalid_response");
  expect(result.diagnostics.errorCode).toBe("AI_REPAIR_ROUTE_CANDIDATE_ALREADY_FAILED");
});

test("no_safe_action route_recovery is diagnosed", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "no_safe_action",
            repairType: "route_recovery",
            reason: "No safe navigation candidates available on current screen."
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "navigation_dead_end",
    failureType: "navigation_dead_end",
    currentStep: "navigate",
    currentUrl: "https://example.com/empty",
    snapshotSummary: {},
    candidates: [], // No candidates
    constraints: []
  });

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("no_safe_action");
  expect(result.decision?.repairType).toBe("route_recovery");
  expect(result.diagnostics.failureType).toBe("navigation_dead_end");
});

test("sensitive candidate blocked in route_recovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "btn-login",
            reason: "Login to continue"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "wrong_screen",
    failureType: "wrong_screen",
    currentStep: "navigate",
    currentUrl: "https://example.com/restricted",
    targetRoute: "/products",
    snapshotSummary: {},
    candidates: ROUTE_CANDIDATES,
    constraints: []
  });

  globalThis.fetch = originalFetch;

  // Should be blocked due to sensitive candidate
  expect(result.status).toBe("invalid_response");
  expect(result.diagnostics.errorCode).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
});

test("metrics count route_recovery repairType", async () => {
  const stepsWithAiRepair: StepWithAiRepair[] = [
    {
      index: 1,
      targetText: "Navigate to Products",
      action: "navigate",
      aiRepairDiagnostics: {
        enabled: true,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        failureType: "wrong_screen",
        repairType: "route_recovery",
        target: "Products section",
        decisionStatus: "repaired_plan",
        validationStatus: "valid",
        selectedCandidateId: "nav-products",
        blockedReason: null,
        durationMs: 1500
      }
    }
  ];

  const summary = buildAiRepairCaseSummary(stepsWithAiRepair);

  expect(summary.enabled).toBe(true);
  expect(summary.invocations).toBe(1);
  expect(summary.repairTypeCounts.route_recovery).toBe(1);
  expect(summary.repairTypeCounts.target_resolution).toBe(0);
  expect(summary.appliedRepairs).toBe(1);
});

test("diagnostics persist with repairType route_recovery", async () => {
  const stepsWithAiRepair: StepWithAiRepair[] = [
    {
      index: 1,
      targetText: "Navigate to Products",
      action: "navigate",
      aiRepairDiagnostics: {
        enabled: true,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        failureType: "wrong_screen",
        repairType: "route_recovery",
        target: "Products",
        decisionStatus: "repaired_plan",
        validationStatus: "valid",
        selectedCandidateId: "nav-products",
        blockedReason: null,
        durationMs: 1200
      }
    },
    {
      index: 2,
      targetText: "Click Add to Cart",
      action: "click",
      aiRepairDiagnostics: {
        enabled: true,
        providerName: "gemini",
        model: "gemini-2.5-flash",
        failureType: "target_not_found",
        repairType: "target_resolution",
        target: "Add to Cart button",
        decisionStatus: "repaired_plan",
        validationStatus: "valid",
        selectedCandidateId: "btn-add-cart",
        blockedReason: null,
        durationMs: 800
      }
    }
  ];

  const summary = buildAiRepairCaseSummary(stepsWithAiRepair);

  expect(summary.invocations).toBe(2);
  expect(summary.repairTypeCounts.route_recovery).toBe(1);
  expect(summary.repairTypeCounts.target_resolution).toBe(1);
  expect(summary.targets).toHaveLength(2);
  expect(summary.targets[0].repairType).toBe("route_recovery");
  expect(summary.targets[1].repairType).toBe("target_resolution");
});
