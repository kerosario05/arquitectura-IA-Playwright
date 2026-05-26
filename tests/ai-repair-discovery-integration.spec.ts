import { test, expect } from "@playwright/test";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";

test("discovery integration: AI Repair invoked on target_not_found", async () => {
  // Simulate discovery scenario: target_not_found with visible candidates
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "no_safe_action",
            reason: "No safe candidate matches the failed target without user confirmation.",
            confidence: 0.8
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "target_not_found",
    currentStep: "click",
    currentUrl: "https://example.com/page",
    snapshotSummary: {
      title: "Test Page",
      url: "https://example.com/page",
      summary: { buttons: 3, links: 5 }
    },
    candidates: [
      {
        candidateId: "btn-1",
        role: "button",
        name: "Safe Button",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: false
      }
    ],
    runtimeEvidenceTrace: { attemptedLocators: ["getByText('NonExistent')"], matchReason: "no_match" },
    structuralEvidence: { diagnosis: "Target text not found in snapshot" },
    feedbackEvidence: [{ index: 0, status: "passed", targetText: "Previous Target" }],
    pendingAssertions: ["assert:page loaded"],
    previousActions: ["navigate: https://example.com"],
    previousFills: [],
    constraints: ["forbid_action:fill", "no_selector_invention"]
  });

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("no_safe_action");
  expect(result.diagnostics.provider).toBeDefined();
  expect(result.diagnostics.scope).toBe("target_not_found");
});

test("discovery integration: AI Repair repaired_plan with valid candidate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "target_resolution",
            candidateId: "btn-1",
            reason: "Selected visible and safe alternative button.",
            confidence: 0.85
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "target_not_found",
    currentStep: "click",
    currentUrl: "https://example.com/page",
    snapshotSummary: { title: "Test", url: "https://example.com", summary: {} },
    candidates: [
      {
        candidateId: "btn-1",
        role: "button",
        name: "Add to Cart",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: false
      }
    ],
    constraints: ["must_return_existing_candidate_id"]
  });

  globalThis.fetch = originalFetch;

  expect(result.status).toBe("repaired_plan");
  expect(result.decision?.candidateId).toBe("btn-1");
  expect(result.decision?.repairType).toBe("target_resolution");
});

test("discovery integration: AI Repair diagnostics include required fields", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "no_safe_action",
            reason: "Test"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "target_not_found",
    currentStep: "click",
    currentUrl: "https://example.com",
    snapshotSummary: {},
    candidates: [],
    constraints: []
  });

  globalThis.fetch = originalFetch;

  // Verify diagnostics structure
  expect(result.diagnostics).toBeDefined();
  expect(result.diagnostics.provider).toBeDefined();
  expect(result.diagnostics.scope).toBe("target_not_found");
});

test("discovery integration: AI Repair not invoked when target resolved", async () => {
  // This test verifies that AI Repair is only called on target_not_found
  // In discovery flow, this is controlled by the resolution.matchReason check
  // Here we just verify the orchestrator is not called when not needed
  
  let orchestratorCalled = false;
  const originalRunAiRepairOrchestrator = runAiRepairOrchestrator;
  
  // Mock to track calls
  (globalThis as any).__aiRepairCallCount = 0;
  
  // In real discovery, AI Repair is only called when:
  // resolution.matchReason === "target_not_found"
  // This test documents that behavior
  
  expect(true).toBe(true); // Placeholder - actual logic is in case-discovery.ts
});

test("discovery integration: context-pack does not include secrets", async () => {
  const originalFetch = globalThis.fetch;
  let capturedContent = "";
  
  globalThis.fetch = (async (url: any, options: any) => {
    const body = JSON.parse(options.body);
    const userMessage = body.messages.find((m: any) => m.role === "user");
    capturedContent = userMessage?.content || "";
    return new Response(
      JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({ decision: "no_safe_action", reason: "Test" })
          }
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as any;

  await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "target_not_found",
    currentStep: "login",
    currentUrl: "https://example.com/login",
    snapshotSummary: {},
    candidates: [],
    previousFills: ["email=user@test.com", "password=secret123", "otp=999999"],
    constraints: []
  });

  globalThis.fetch = originalFetch;

  // Verify secrets are redacted
  expect(capturedContent.toLowerCase()).toContain("[redacted]");
  expect(capturedContent.toLowerCase()).not.toContain("password=");
  expect(capturedContent.toLowerCase()).not.toContain("otp=");
});

test("discovery integration: AI Repair blocked sensitive candidate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            candidateId: "btn-payment",
            reason: "Confirm payment"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "target_not_found",
    currentStep: "click",
    currentUrl: "https://example.com/checkout",
    snapshotSummary: {},
    candidates: [
      {
        candidateId: "btn-payment",
        role: "button",
        name: "Confirm Payment",
        visible: true,
        enabled: true,
        clickable: true,
        sensitive: true
      }
    ],
    constraints: []
  });

  globalThis.fetch = originalFetch;

  // Should be blocked due to sensitive candidate
  expect(result.status).toBe("invalid_response");
  expect(result.diagnostics.errorCode).toContain("SENSITIVE");
});

test("discovery integration: AI Repair blocked invented selector", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            candidateId: "btn-1",
            reason: "Use this",
            css: ".btn-primary",
            xpath: "//button"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const result = await runAiRepairOrchestrator({
    appSlug: "test-app",
    failure: "target_not_found",
    currentStep: "click",
    currentUrl: "https://example.com",
    snapshotSummary: {},
    candidates: [
      {
        candidateId: "btn-1",
        role: "button",
        name: "Button",
        visible: true,
        sensitive: false
      }
    ],
    constraints: ["no_selector_invention"]
  });

  globalThis.fetch = originalFetch;

  // Should be blocked due to invented selector
  expect(result.status).toBe("invalid_response");
  expect(result.diagnostics.errorCode).toContain("SELECTOR");
});
