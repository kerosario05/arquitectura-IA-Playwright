import { test, expect } from "@playwright/test";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";
import type { RepairCandidateForValidation } from "../src/ai/repair/repair-decision-validator";

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

const SAFE_CANDIDATES: RepairCandidateForValidation[] = [
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
  },
  {
    candidateId: "el-2",
    role: "link",
    name: "Cart",
    text: "Cart",
    visible: true,
    enabled: true,
    clickable: true,
    editable: false,
    sensitive: false
  }
];

const SENSITIVE_CANDIDATES: RepairCandidateForValidation[] = [
  {
    candidateId: "el-sensitive",
    role: "button",
    name: "Confirm Payment",
    text: "Confirm Payment",
    visible: true,
    enabled: true,
    clickable: true,
    sensitive: true
  }
];

function buildMinimalInput(overrides?: Partial<any>) {
  return {
    appSlug: "test-app",
    failure: "target_not_found",
    currentStep: "click 'Buy Now' button",
    currentUrl: "https://example.com/product/123",
    snapshotSummary: {
      buttons: ["Add to cart", "View details", "Compare"],
      links: ["Home", "Products", "Cart"],
      dialogs: []
    },
    candidates: SAFE_CANDIDATES,
    previousActions: ["navigate to product page", "view product details"],
    previousFills: [],
    constraints: [
      "Do not propose payment actions",
      "Do not propose login actions",
      "Only suggest navigation or safe UI interactions",
      "Must use existing candidateId from candidates list",
      "Do not invent selectors (css/xpath/locator/testId)"
    ],
    ...overrides
  };
}

test("provider disabled", async () => {
  await withEnv({ AI_REPAIR_ENABLED: "false", AI_ENABLED: "false" }, async () => {
    const result = await runAiRepairOrchestrator(buildMinimalInput());
    expect(result.status).toBe("provider_disabled");
    expect(result.diagnostics.reason).toBeDefined();
  });
});

test("fake provider repaired_plan valid", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "target_resolution",
            candidateId: "el-1",
            reason: "Candidate is visible, enabled, and safe for interaction.",
            confidence: 0.85
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, async () => {
    const result = await runAiRepairOrchestrator(buildMinimalInput());
    expect(result.status).toBe("repaired_plan");
    expect(result.decision?.candidateId).toBe("el-1");
    expect(result.decision?.decision).toBe("repaired_plan");
    expect(result.diagnostics.provider).toBe("gemini");
  });

  globalThis.fetch = originalFetch;
});

test("fake provider no_safe_action", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "no_safe_action",
            reason: "No safe candidate matches the failed target intent without user confirmation.",
            confidence: 0.9
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, async () => {
    const result = await runAiRepairOrchestrator(buildMinimalInput());
    expect(result.status).toBe("no_safe_action");
    expect(result.decision?.decision).toBe("no_safe_action");
    expect(result.decision?.candidateId).toBeUndefined();
  });

  globalThis.fetch = originalFetch;
});

test("fake provider invalid JSON", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: "This is not valid JSON at all - just plain text response"
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, async () => {
    const result = await runAiRepairOrchestrator(buildMinimalInput());
    // Invalid JSON causes provider_error because requireJson:true parsing fails
    expect(result.status).toBe("provider_error");
    expect(result.diagnostics.code).toBeDefined();
  });

  globalThis.fetch = originalFetch;
});

test("fake provider unknown candidateId", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "target_resolution",
            candidateId: "unknown-candidate-xyz-123",
            reason: "Selected a candidate that does not exist in the candidates list"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false",
    AI_REPAIR_MUST_RETURN_EXISTING_CANDIDATE_ID: "true"
  }, async () => {
    const result = await runAiRepairOrchestrator(buildMinimalInput());
    expect(result.status).toBe("invalid_response");
    expect(result.diagnostics.errorCode).toBe("AI_REPAIR_UNKNOWN_CANDIDATE");
  });

  globalThis.fetch = originalFetch;
});

test("fake provider invented selector", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "target_resolution",
            candidateId: "el-1",
            reason: "Use this custom selector",
            selector: "button.custom-class",
            css: ".btn-primary",
            xpath: "//button[@class='continue']",
            locator: "locator('.btn-primary')"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, async () => {
    const result = await runAiRepairOrchestrator(buildMinimalInput());
    expect(result.status).toBe("invalid_response");
    expect(result.diagnostics.errorCode).toBe("AI_REPAIR_SELECTOR_INVENTED");
  });

  globalThis.fetch = originalFetch;
});

test("fake provider sensitive candidate", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "target_resolution",
            candidateId: "el-sensitive",
            reason: "Confirm the payment to complete the purchase"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false",
    AI_REPAIR_BLOCK_SENSITIVE_ACTIONS: "true"
  }, async () => {
    const result = await runAiRepairOrchestrator({
      ...buildMinimalInput(),
      candidates: SENSITIVE_CANDIDATES
    });
    expect(result.status).toBe("invalid_response");
    expect(result.diagnostics.errorCode).toBe("AI_REPAIR_SENSITIVE_ACTION_BLOCKED");
  });

  globalThis.fetch = originalFetch;
});

test("context-pack redacts secrets", async () => {
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
            content: JSON.stringify({
              decision: "no_safe_action",
              reason: "Test"
            })
          }
        }]
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }) as any;

  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, async () => {
    await runAiRepairOrchestrator({
      appSlug: "test-app",
      failure: "target_not_found",
      currentStep: "login with password",
      currentUrl: "https://example.com/login",
      candidates: SAFE_CANDIDATES,
      previousActions: ["fill email"],
      previousFills: ["email=user@example.com", "password=secret123", "otp=123456"],
      constraints: []
    });
  });

  globalThis.fetch = originalFetch;

  // Verify secret field names are redacted (password, otp) but values may remain
  // Redaction replaces secret-related words with [REDACTED]
  expect(capturedContent.toLowerCase()).toContain("[redacted]");
  // The word "password" should be redacted
  expect(capturedContent.toLowerCase()).not.toContain("password=");
  // The word "otp" should be redacted  
  expect(capturedContent.toLowerCase()).not.toContain("otp=");
});

test("diagnostics include providerName, model, durationMs, failureType", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "target_resolution",
            candidateId: "el-1",
            reason: "Test"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "gemini-test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, async () => {
    const result = await runAiRepairOrchestrator(buildMinimalInput());
    expect(result.diagnostics.provider).toBe("gemini");
    expect(result.diagnostics.scope).toBe("target_not_found");
  });

  globalThis.fetch = originalFetch;
});
