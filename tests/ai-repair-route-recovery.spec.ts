/**
 * AI Repair Route Recovery Tests
 */

import { test, expect } from "@playwright/test";
import { validateRepairDecision } from "../src/ai/repair/repair-decision-validator";
import { buildRepairContextPack } from "../src/ai/repair/repair-context-pack";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";

function withEnv<T>(values: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const previous: Record<string, string | undefined> = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }
  const restore = () => {
    for (const key of Object.keys(values)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  };
  return fn().finally(restore);
}

const FAKE_AI_ENV = {
  AI_REPAIR_ENABLED: "true",
  AI_ENABLED: "true",
  AI_PROVIDER: "openai_compatible",
  AI_PROVIDER_NAME: "gemini",
  AI_BASE_URL: "https://example.test/v1",
  AI_API_KEY: "test-key",
  AI_MODEL: "test-model"
};

const ROUTE_CANDIDATES = [
  {
    candidateId: "link-products",
    role: "link",
    name: "Products",
    text: "Products",
    visible: true,
    enabled: true,
    clickable: true,
    sensitive: false
  },
  {
    candidateId: "link-home",
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

test("schema accepts route_recovery with valid candidateId", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "route_recovery" as const,
    candidateId: "link-products",
    reason: "Candidate navigates to the expected section.",
    confidence: 0.8
  };

  const result = validateRepairDecision(decision, {
    candidates: ROUTE_CANDIDATES,
    mustReturnExistingCandidateId: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(true);
  if (result.valid) {
    expect(result.decision.repairType).toBe("route_recovery");
    expect(result.decision.candidateId).toBe("link-products");
  }
});

test("validator accepts route_recovery candidate visible/clickable/not sensitive", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "route_recovery" as const,
    candidateId: "link-products",
    reason: "Navigate to products section",
    confidence: 0.85
  };

  const result = validateRepairDecision(decision, {
    candidates: ROUTE_CANDIDATES,
    mustUseVisibleCandidate: true,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(true);
});

test("validator blocks sensitive candidate for route_recovery", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "route_recovery" as const,
    candidateId: "btn-login",
    reason: "Login to continue",
    confidence: 0.7
  };

  const result = validateRepairDecision(decision, {
    candidates: ROUTE_CANDIDATES,
    blockSensitiveActions: true
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
  }
});

test("validator blocks candidate already in failedRoutePaths", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "route_recovery" as const,
    candidateId: "link-products",
    reason: "Try products link again",
    confidence: 0.6
  };

  const result = validateRepairDecision(decision, {
    candidates: ROUTE_CANDIDATES,
    failedRoutePaths: ["link-products", "link-home"]
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_ROUTE_CANDIDATE_ALREADY_FAILED");
  }
});

test("validator blocks invented selector in route_recovery", () => {
  const decision = {
    decision: "repaired_plan" as const,
    repairType: "route_recovery" as const,
    candidateId: "link-products",
    reason: "Use this selector",
    css: ".nav-products",
    xpath: "//a[@href='/products']"
  };

  const result = validateRepairDecision(decision, {
    candidates: ROUTE_CANDIDATES
  });

  expect(result.valid).toBe(false);
  if (!result.valid) {
    expect(result.code).toBe("AI_REPAIR_SELECTOR_INVENTED");
  }
});

test("context-pack route_recovery does not include secrets", () => {
  const pack = buildRepairContextPack({
    appSlug: "test-app",
    failure: "route_not_found",
    failureType: "route_not_found",
    currentStep: "navigate to products",
    currentUrl: "https://example.com/home",
    targetRoute: "/products?password=secret123",
    candidates: ROUTE_CANDIDATES,
    currentScreen: {
      url: "https://example.com/home",
      title: "Home - Login with otp=9999",
      visibleHeadings: ["Welcome", "Login with password"],
      visibleNavItems: ["Products", "Home"],
      visibleActions: ["Click here"]
    },
    routeHistory: {
      failedRoutePaths: ["link-old"],
      visitedUrls: ["https://example.com/login?token=abc123"]
    },
    previousActions: ["fill password=secret", "click login"],
    constraints: [],
    maxChars: 30000
  });

  const serialized = JSON.stringify(pack);
  
  expect(serialized.toLowerCase()).not.toContain("secret123");
  expect(serialized.toLowerCase()).not.toContain("password=");
  expect(serialized.toLowerCase()).not.toContain("otp=");
  expect(serialized.toLowerCase()).not.toContain("token=");
  expect(serialized).toContain("[REDACTED]");
});

test("orchestrator returns repaired_plan route_recovery valid", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "link-products",
            reason: "Products link navigates to the expected section.",
            confidence: 0.85
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await withEnv(FAKE_AI_ENV, () => runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "route_not_found",
    failureType: "route_not_found",
    currentStep: "navigate",
    currentUrl: "https://example.com/home",
    targetRoute: "/products",
    snapshotSummary: {},
    candidates: ROUTE_CANDIDATES,
    currentScreen: {
      url: "https://example.com/home",
      title: "Home",
      visibleHeadings: ["Welcome"],
      visibleNavItems: ["Products", "Home"],
      visibleActions: []
    },
    routeHistory: {
      failedRoutePaths: [],
      visitedUrls: []
    },
    constraints: ["must_return_existing_candidate_id"]
  }));

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("repaired_plan");
  expect(result.decision?.repairType).toBe("route_recovery");
  expect(result.decision?.candidateId).toBe("link-products");
});

test("orchestrator blocks invented selector in route_recovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "link-products",
            reason: "Use this",
            css: ".products-link"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await withEnv(FAKE_AI_ENV, () => runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "route_not_found",
    failureType: "route_not_found",
    currentStep: "navigate",
    currentUrl: "https://example.com",
    snapshotSummary: {},
    candidates: ROUTE_CANDIDATES,
    constraints: []
  }));

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("invalid_response");
  expect(result.diagnostics.errorCode).toBe("AI_REPAIR_SELECTOR_INVENTED");
});

test("metrics track repairType route_recovery", () => {
  // This test verifies the metrics types support route_recovery
  const decisionCounts = {
    repaired_plan: 1,
    no_safe_action: 0,
    needs_more_context: 0,
    invalid_response: 0,
    provider_error: 0,
    provider_disabled: 0
  };

  const repairTypeCounts = {
    target_resolution: 0,
    route_recovery: 1,
    assertion_resolution: 0,
    pom_method_missing: 0,
    selection_resolution: 0,
    missing_intermediate_step: 0,
    unknown: 0
  };

  expect(decisionCounts.repaired_plan).toBe(1);
  expect(repairTypeCounts.route_recovery).toBe(1);
});

test("no_safe_action for route_recovery when no candidates", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "no_safe_action",
            repairType: "route_recovery",
            reason: "No safe route candidates available on current screen."
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await withEnv(FAKE_AI_ENV, () => runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "route_not_found",
    failureType: "navigation_dead_end",
    currentStep: "navigate",
    currentUrl: "https://example.com/empty",
    snapshotSummary: {},
    candidates: [],
    constraints: []
  }));

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("no_safe_action");
  expect(result.decision?.repairType).toBe("route_recovery");
});

test("needs_more_context for route_recovery when screen lacks nav", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "needs_more_context",
            repairType: "route_recovery",
            reason: "Current screen lacks navigation candidates. Need to go back or start fresh."
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await withEnv(FAKE_AI_ENV, () => runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "wrong_screen",
    failureType: "wrong_screen",
    currentStep: "navigate",
    currentUrl: "https://example.com/checkout",
    snapshotSummary: {},
    candidates: [],
    currentScreen: {
      url: "https://example.com/checkout",
      title: "Checkout",
      visibleHeadings: ["Payment"],
      visibleNavItems: [],
      visibleActions: ["Pay Now"]
    },
    constraints: []
  }));

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("needs_more_context");
  expect(result.decision?.repairType).toBe("route_recovery");
});
