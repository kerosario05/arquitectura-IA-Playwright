/**
 * Smoke test for AI Repair Runtime with target_not_found scenario
 * 
 * Usage:
 *   npx tsx scripts/test-ai-repair-runtime.ts --mode <mode>
 *   npx tsx scripts/test-ai-repair-runtime.ts --real-provider
 * 
 * Modes:
 *   - repaired_plan_valid: Test valid repaired_plan response
 *   - no_safe_action: Test no_safe_action response
 *   - invalid_json: Test invalid JSON response
 *   - unknown_candidate: Test unknown candidateId
 *   - invented_selector: Test invented selector fields
 *   - sensitive_candidate: Test sensitive candidate blocking
 *   - assertion_resolution_valid: Test assertion_resolution with valid evidenceId
 *   - assertion_resolution_no_safe_action: Test assertion_resolution no_safe_action
 *   - assertion_resolution_unknown_evidence: Test unknown evidenceId blocking
 *   - assertion_resolution_sensitive_evidence: Test sensitive evidence blocking
 *   - selection_resolution_valid: Test selection_resolution with valid candidateId
 *   - selection_resolution_no_safe_action: Test selection_resolution no_safe_action
 *   - selection_resolution_unknown_candidate: Test unknown candidateId blocking
 *   - selection_resolution_sensitive_candidate: Test sensitive candidate blocking
 *   - all: Run all fake provider tests (default)
 *   - real: Run real provider test (same as --real-provider)
 * 
 * Tests:
 * 1. Real provider call (Gemini via openai_compatible)
 * 2. Fake provider scenarios for validation
 */

import "dotenv/config";
import { runAiRepairOrchestrator } from "../src/ai/repair/ai-repair-orchestrator";
import type { RepairCandidateForValidation } from "../src/ai/repair/repair-decision-validator";

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

function buildMinimalContextPack(overrides?: Partial<any>) {
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

function printResult(testName: string, result: Awaited<ReturnType<typeof runAiRepairOrchestrator>>, durationMs: number) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`TEST: ${testName}`);
  console.log(`${"=".repeat(60)}`);
  console.log(`  providerName: ${result.diagnostics.provider ?? "N/A"}`);
  console.log(`  status:       ${result.status}`);
  console.log(`  decision:     ${result.decision?.decision ?? "N/A"}`);
  console.log(`  candidateId:  ${result.decision?.candidateId ?? "N/A"}`);
  console.log(`  reason:       ${result.decision?.reason?.slice(0, 80) ?? "N/A"}${result.decision?.reason && result.decision.reason.length > 80 ? "..." : ""}`);
  console.log(`  durationMs:   ${durationMs}`);
  if (result.diagnostics.errorCode) {
    console.log(`  errorCode:    ${result.diagnostics.errorCode}`);
    console.log(`  errorMessage: ${result.diagnostics.errorMessage}`);
  }
  console.log();
}

function printJsonResult(testName: string, result: Awaited<ReturnType<typeof runAiRepairOrchestrator>>, durationMs: number) {
  const jsonResult = {
    enabled: true,
    providerName: result.diagnostics.provider ?? "N/A",
    model: process.env.AI_MODEL ?? "N/A",
    failureType: "target_not_found",
    status: result.status,
    decision: result.decision?.decision ?? "N/A",
    validationStatus: result.status === "invalid_response" ? "invalid" : result.status === "provider_error" ? "error" : "valid",
    selectedCandidateId: result.decision?.candidateId ?? null,
    durationMs,
    diagnostics: result.diagnostics
  };
  console.log(JSON.stringify(jsonResult, null, 2));
}

async function testRealProvider() {
  const testName = "REAL_PROVIDER_GEMINI";
  console.log(`\n>>> Starting ${testName}...`);
  
  const input = buildMinimalContextPack({
    appSlug: "arquitectura-automatizacion",
    currentStep: "click 'Confirm Purchase' button",
    currentUrl: "https://example.com/order/confirmation",
    snapshotSummary: {
      buttons: ["Continue Shopping", "Home", "Contact Support"],
      links: ["Home", "Products", "About"],
      dialogs: []
    },
    previousActions: ["fill email", "fill password", "click login", "add product to cart", "click checkout"],
    previousFills: ["email=user@example.com", "password=***"],
    constraints: [
      "Do not propose payment actions",
      "Do not propose login actions",
      "Only suggest navigation or safe UI interactions",
      "Prefer candidates that continue shopping flow"
    ]
  });

  const start = Date.now();
  const apiKey = process.env.AI_API_KEY || process.env.GEMINI_API_KEY;
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://generativelanguage.googleapis.com/v1beta/openai",
    AI_API_KEY: apiKey,
    AI_MODEL: process.env.AI_MODEL ?? "gemini-2.5-flash",
    AI_REQUIRE_JSON_SCHEMA: "true",
    AI_REPAIR_BLOCK_SENSITIVE_ACTIONS: "true",
    AI_REPAIR_BLOCK_AUTH_SECRETS: "true",
    AI_REPAIR_BLOCK_PAYMENTS: "true",
    AI_REPAIR_BLOCK_TRANSFERS: "true",
    AI_REPAIR_MUST_USE_VISIBLE_CANDIDATE: "true",
    AI_REPAIR_MUST_RETURN_EXISTING_CANDIDATE_ID: "true"
  }, () => runAiRepairOrchestrator(input));
  const durationMs = Date.now() - start;

  printResult(testName, result, durationMs);

  const success = result.status === "repaired_plan" || result.status === "no_safe_action" || result.status === "needs_more_context";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"} (status=${result.status})`);
  return { success, result, durationMs };
}

async function testFakeRepairedPlan() {
  const testName = "FAKE_PROVIDER_REPAIRED_PLAN_VALID";
  console.log(`\n>>> Starting ${testName}...`);
  
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

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator(buildMinimalContextPack()));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  const success = result.status === "repaired_plan" && result.decision?.candidateId === "el-1";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeNoSafeAction() {
  const testName = "FAKE_PROVIDER_NO_SAFE_ACTION";
  console.log(`\n>>> Starting ${testName}...`);
  
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

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator(buildMinimalContextPack()));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  const success = result.status === "no_safe_action" && !result.decision?.candidateId;
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeInvalidJson() {
  const testName = "FAKE_PROVIDER_INVALID_JSON";
  console.log(`\n>>> Starting ${testName}...`);
  
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

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator(buildMinimalContextPack()));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  // Invalid JSON causes provider_error because requireJson:true parsing fails
  const success = result.status === "provider_error";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeUnknownCandidate() {
  const testName = "FAKE_PROVIDER_UNKNOWN_CANDIDATE";
  console.log(`\n>>> Starting ${testName}...`);
  
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

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false",
    AI_REPAIR_MUST_RETURN_EXISTING_CANDIDATE_ID: "true"
  }, () => runAiRepairOrchestrator(buildMinimalContextPack()));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  const success = result.status === "invalid_response" && result.diagnostics.errorCode === "AI_REPAIR_UNKNOWN_CANDIDATE";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeInventedSelector() {
  const testName = "FAKE_PROVIDER_INVENTED_SELECTOR";
  console.log(`\n>>> Starting ${testName}...`);
  
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

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator(buildMinimalContextPack()));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  const success = result.status === "invalid_response" && result.diagnostics.errorCode === "AI_REPAIR_SELECTOR_INVENTED";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeSensitiveCandidate() {
  const testName = "FAKE_PROVIDER_SENSITIVE_CANDIDATE";
  console.log(`\n>>> Starting ${testName}...`);
  
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

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false",
    AI_REPAIR_BLOCK_SENSITIVE_ACTIONS: "true"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack(),
    candidates: SENSITIVE_CANDIDATES
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  const success = result.status === "invalid_response" && result.diagnostics.errorCode === "AI_REPAIR_SENSITIVE_ACTION_BLOCKED";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testProviderDisabled() {
  const testName = "PROVIDER_DISABLED";
  console.log(`\n>>> Starting ${testName}...`);
  
  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "false",
    AI_ENABLED: "false"
  }, () => runAiRepairOrchestrator(buildMinimalContextPack()));
  const durationMs = Date.now() - start;

  printResult(testName, result, durationMs);

  const success = result.status === "provider_disabled";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeRouteRecoveryValid() {
  const testName = "FAKE_PROVIDER_ROUTE_RECOVERY_VALID";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "el-2",
            reason: "Cart link navigates to the expected section.",
            confidence: 0.85
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack(),
    failureType: "route_not_found",
    targetRoute: "/cart",
    currentScreen: {
      url: "https://example.com/home",
      title: "Home",
      visibleHeadings: ["Welcome"],
      visibleNavItems: ["Products", "Cart"],
      visibleActions: []
    }
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  const success = result.status === "repaired_plan" && result.decision?.repairType === "route_recovery";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeRouteRecoveryNoSafeAction() {
  const testName = "FAKE_PROVIDER_ROUTE_RECOVERY_NO_SAFE_ACTION";
  console.log(`\n>>> Starting ${testName}...`);
  
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

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack(),
    failureType: "navigation_dead_end",
    candidates: []
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  const success = result.status === "no_safe_action" && result.decision?.repairType === "route_recovery";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeRouteRecoveryFailedCandidate() {
  const testName = "FAKE_PROVIDER_ROUTE_RECOVERY_FAILED_CANDIDATE";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "route_recovery",
            candidateId: "el-1",
            reason: "Try this candidate again"
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false",
    AI_REPAIR_MUST_RETURN_EXISTING_CANDIDATE_ID: "true"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack(),
    failureType: "route_not_found",
    routeHistory: {
      failedRoutePaths: ["el-1"]
    }
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printResult(testName, result, durationMs);

  const success = result.status === "invalid_response" && result.diagnostics.errorCode === "AI_REPAIR_ROUTE_CANDIDATE_ALREADY_FAILED";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

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

async function testFakeAssertionResolutionValid() {
  const testName = "FAKE_PROVIDER_ASSERTION_RESOLUTION_VALID";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "assertion_resolution",
            evidenceId: "ev-feedback-1",
            assertionStatus: "satisfied_by_existing_evidence",
            reason: "Feedback message confirms assertion is satisfied.",
            confidence: 0.9
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack({
      failureType: "assertion_not_satisfied",
      failure: "assertion_not_satisfied",
      currentStep: "verify success message"
    }),
    evidenceCandidates: SAFE_EVIDENCE,
    assertionTarget: "success message visible"
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printJsonResult(testName, result, durationMs);

  const success = result.status === "repaired_plan" && 
                  result.decision?.repairType === "assertion_resolution" &&
                  result.decision?.evidenceId === "ev-feedback-1" &&
                  result.decision?.assertionStatus === "satisfied_by_existing_evidence";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeAssertionResolutionNoSafeAction() {
  const testName = "FAKE_PROVIDER_ASSERTION_RESOLUTION_NO_SAFE_ACTION";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "no_safe_action",
            repairType: "assertion_resolution",
            reason: "No existing evidence can satisfy this assertion safely.",
            confidence: 0.7
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack({
      failureType: "assertion_not_satisfied",
      failure: "assertion_not_satisfied",
      currentStep: "verify OTP entered"
    }),
    evidenceCandidates: SENSITIVE_EVIDENCE,
    assertionTarget: "OTP field should contain code"
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printJsonResult(testName, result, durationMs);

  const success = result.status === "no_safe_action" && 
                  result.decision?.repairType === "assertion_resolution" &&
                  !result.decision?.evidenceId;
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeAssertionResolutionUnknownEvidence() {
  const testName = "FAKE_PROVIDER_ASSERTION_RESOLUTION_UNKNOWN_EVIDENCE";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "assertion_resolution",
            evidenceId: "ev-unknown-999",
            assertionStatus: "satisfied_by_existing_evidence",
            reason: "Evidence confirms assertion.",
            confidence: 0.8
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack({
      failureType: "assertion_not_satisfied",
      failure: "assertion_not_satisfied",
      currentStep: "verify message"
    }),
    evidenceCandidates: SAFE_EVIDENCE,
    assertionTarget: "message visible"
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printJsonResult(testName, result, durationMs);

  const success = result.status === "invalid_response" && 
                  result.diagnostics.errorCode === "AI_REPAIR_UNKNOWN_EVIDENCE";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeAssertionResolutionSensitiveEvidence() {
  const testName = "FAKE_PROVIDER_ASSERTION_RESOLUTION_SENSITIVE_EVIDENCE";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "assertion_resolution",
            evidenceId: "ev-sensitive-1",
            assertionStatus: "satisfied_by_existing_evidence",
            reason: "Password field confirms login.",
            confidence: 0.75
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false",
    AI_REPAIR_BLOCK_AUTH_SECRETS: "true"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack({
      failureType: "assertion_not_satisfied",
      failure: "assertion_not_satisfied",
      currentStep: "verify password entered"
    }),
    evidenceCandidates: SENSITIVE_EVIDENCE,
    assertionTarget: "password field should contain value"
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printJsonResult(testName, result, durationMs);

  const success = result.status === "invalid_response" && 
                  result.diagnostics.errorCode === "AI_REPAIR_SENSITIVE_ASSERTION_BLOCKED";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

const SELECTION_CANDIDATES: RepairCandidateForValidation[] = [
  {
    candidateId: "item-1",
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
    candidateId: "item-2",
    role: "button",
    name: "Product B",
    text: "Product B - $20",
    visible: true,
    enabled: true,
    clickable: true,
    editable: false,
    sensitive: false
  }
];

const SENSITIVE_SELECTION_CANDIDATES: RepairCandidateForValidation[] = [
  {
    candidateId: "sensitive-item",
    role: "button",
    name: "Confirm Payment",
    text: "Pay $100",
    visible: true,
    enabled: true,
    clickable: true,
    sensitive: true
  }
];

async function testFakeSelectionResolutionValid() {
  const testName = "FAKE_PROVIDER_SELECTION_RESOLUTION_VALID";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "item-1",
            selectionStatus: "selected",
            reason: "Candidate best matches the requested option.",
            confidence: 0.82
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack({
      failureType: "ambiguous_selection",
      failure: "ambiguous_selection",
      currentStep: "select product"
    }),
    candidates: SELECTION_CANDIDATES,
    selectionCandidates: SELECTION_CANDIDATES,
    selectionTarget: "Product A",
    selectionIntent: "select the first product"
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printJsonResult(testName, result, durationMs);

  const success = result.status === "repaired_plan" && 
                  result.decision?.repairType === "selection_resolution" &&
                  result.decision?.candidateId === "item-1" &&
                  result.diagnostics.candidateCount === 2;
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeSelectionResolutionNoSafeAction() {
  const testName = "FAKE_PROVIDER_SELECTION_RESOLUTION_NO_SAFE_ACTION";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "no_safe_action",
            repairType: "selection_resolution",
            reason: "No candidate can be safely selected without user confirmation.",
            confidence: 0.7
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack({
      failureType: "ambiguous_selection",
      failure: "ambiguous_selection",
      currentStep: "select payment option"
    }),
    candidates: SENSITIVE_SELECTION_CANDIDATES,
    selectionCandidates: SENSITIVE_SELECTION_CANDIDATES,
    selectionTarget: "payment method"
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printJsonResult(testName, result, durationMs);

  const success = result.status === "no_safe_action" && 
                  result.decision?.repairType === "selection_resolution" &&
                  !result.decision?.candidateId;
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeSelectionResolutionUnknownCandidate() {
  const testName = "FAKE_PROVIDER_SELECTION_RESOLUTION_UNKNOWN_CANDIDATE";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "unknown-xyz",
            reason: "Select unknown item.",
            confidence: 0.6
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack({
      failureType: "ambiguous_selection",
      failure: "ambiguous_selection",
      currentStep: "select item"
    }),
    candidates: SELECTION_CANDIDATES,
    selectionCandidates: SELECTION_CANDIDATES,
    selectionTarget: "any item"
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printJsonResult(testName, result, durationMs);

  const success = result.status === "invalid_response" && 
                  result.diagnostics.errorCode === "AI_REPAIR_UNKNOWN_CANDIDATE";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function testFakeSelectionResolutionSensitiveCandidate() {
  const testName = "FAKE_PROVIDER_SELECTION_RESOLUTION_SENSITIVE_CANDIDATE";
  console.log(`\n>>> Starting ${testName}...`);
  
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(
    JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            decision: "repaired_plan",
            repairType: "selection_resolution",
            candidateId: "sensitive-item",
            reason: "Confirm payment selection.",
            confidence: 0.75
          })
        }
      }]
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  )) as any;

  const start = Date.now();
  const result = await withEnv({
    AI_REPAIR_ENABLED: "true",
    AI_ENABLED: "true",
    AI_PROVIDER: "openai_compatible",
    AI_PROVIDER_NAME: "gemini",
    AI_BASE_URL: "https://example.com/v1",
    AI_API_KEY: "test-key",
    AI_MODEL: "test-model",
    AI_REQUIRE_JSON_SCHEMA: "false",
    AI_REPAIR_BLOCK_SENSITIVE_ACTIONS: "true"
  }, () => runAiRepairOrchestrator({
    ...buildMinimalContextPack({
      failureType: "ambiguous_selection",
      failure: "ambiguous_selection",
      currentStep: "select payment"
    }),
    candidates: SENSITIVE_SELECTION_CANDIDATES,
    selectionCandidates: SENSITIVE_SELECTION_CANDIDATES,
    selectionTarget: "payment option"
  }));
  const durationMs = Date.now() - start;

  globalThis.fetch = originalFetch;

  printJsonResult(testName, result, durationMs);

  const success = result.status === "invalid_response" && 
                  result.diagnostics.errorCode === "AI_REPAIR_SENSITIVE_ACTION_BLOCKED";
  console.log(`>>> ${testName}: ${success ? "PASSED" : "FAILED"}`);
  return { success, result, durationMs };
}

async function main() {
  const args = process.argv.slice(2);
  const modeIndex = args.indexOf("--mode");
  const mode = modeIndex >= 0 ? args[modeIndex + 1] : "all";
  const realProvider = args.includes("--real-provider");

  console.log("\n" + "=".repeat(60));
  console.log("AI REPAIR RUNTIME SMOKE TEST");
  console.log("=".repeat(60));
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log(`Mode: ${realProvider ? "real-provider" : mode}`);
  console.log(`AI_PROVIDER: ${process.env.AI_PROVIDER ?? "undefined"}`);
  console.log(`AI_PROVIDER_NAME: ${process.env.AI_PROVIDER_NAME ?? "undefined"}`);
  console.log(`AI_REPAIR_ENABLED: ${process.env.AI_REPAIR_ENABLED ?? "undefined"}`);
  console.log(`AI_MODEL: ${process.env.AI_MODEL ?? "undefined"}`);
  const apiKeySource = process.env.AI_API_KEY ? "AI_API_KEY" : (process.env.GEMINI_API_KEY ? "GEMINI_API_KEY (fallback)" : "not set");
  console.log(`AI_API_KEY: ${apiKeySource}`);

  const tests: { name: string; fn: () => Promise<{ success: boolean; result: any; durationMs: number }> }[] = [
    { name: "REAL_PROVIDER_GEMINI", fn: testRealProvider },
    { name: "FAKE_PROVIDER_REPAIRED_PLAN_VALID", fn: testFakeRepairedPlan },
    { name: "FAKE_PROVIDER_NO_SAFE_ACTION", fn: testFakeNoSafeAction },
    { name: "FAKE_PROVIDER_INVALID_JSON", fn: testFakeInvalidJson },
    { name: "FAKE_PROVIDER_UNKNOWN_CANDIDATE", fn: testFakeUnknownCandidate },
    { name: "FAKE_PROVIDER_INVENTED_SELECTOR", fn: testFakeInventedSelector },
    { name: "FAKE_PROVIDER_SENSITIVE_CANDIDATE", fn: testFakeSensitiveCandidate },
    { name: "PROVIDER_DISABLED", fn: testProviderDisabled },
    { name: "FAKE_PROVIDER_ROUTE_RECOVERY_VALID", fn: testFakeRouteRecoveryValid },
    { name: "FAKE_PROVIDER_ROUTE_RECOVERY_NO_SAFE_ACTION", fn: testFakeRouteRecoveryNoSafeAction },
    { name: "FAKE_PROVIDER_ROUTE_RECOVERY_FAILED_CANDIDATE", fn: testFakeRouteRecoveryFailedCandidate },
    { name: "FAKE_PROVIDER_ASSERTION_RESOLUTION_VALID", fn: testFakeAssertionResolutionValid },
    { name: "FAKE_PROVIDER_ASSERTION_RESOLUTION_NO_SAFE_ACTION", fn: testFakeAssertionResolutionNoSafeAction },
    { name: "FAKE_PROVIDER_ASSERTION_RESOLUTION_UNKNOWN_EVIDENCE", fn: testFakeAssertionResolutionUnknownEvidence },
    { name: "FAKE_PROVIDER_ASSERTION_RESOLUTION_SENSITIVE_EVIDENCE", fn: testFakeAssertionResolutionSensitiveEvidence },
    { name: "FAKE_PROVIDER_SELECTION_RESOLUTION_VALID", fn: testFakeSelectionResolutionValid },
    { name: "FAKE_PROVIDER_SELECTION_RESOLUTION_NO_SAFE_ACTION", fn: testFakeSelectionResolutionNoSafeAction },
    { name: "FAKE_PROVIDER_SELECTION_RESOLUTION_UNKNOWN_CANDIDATE", fn: testFakeSelectionResolutionUnknownCandidate },
    { name: "FAKE_PROVIDER_SELECTION_RESOLUTION_SENSITIVE_CANDIDATE", fn: testFakeSelectionResolutionSensitiveCandidate }
  ];

  const filteredTests = realProvider
    ? tests.filter(t => t.name === "REAL_PROVIDER_GEMINI")
    : mode === "all"
      ? tests.filter(t => t.name !== "REAL_PROVIDER_GEMINI")
      : tests.filter(t => t.name.toLowerCase().includes(mode.toLowerCase()));

  const results: { name: string; passed: boolean; result?: any; durationMs?: number }[] = [];

  for (const test of filteredTests) {
    try {
      const r = await test.fn();
      results.push({ name: test.name, passed: r.success, result: r.result, durationMs: r.durationMs });
    } catch (error) {
      console.error(`>>> ${test.name}: FAILED with error: ${error instanceof Error ? error.message : String(error)}`);
      results.push({ name: test.name, passed: false });
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("SUMMARY");
  console.log("=".repeat(60));
  for (const r of results) {
    const icon = r.passed ? "PASS" : "FAIL";
    const duration = r.durationMs !== undefined ? ` (${r.durationMs}ms)` : "";
    console.log(`  [${icon}] ${r.name}${duration}`);
  }
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  console.log(`\nTotal: ${passed}/${total} passed`);
  console.log(`Completed at: ${new Date().toISOString()}`);

  // Print JSON summary for CI/CD
  console.log("\n" + "=".repeat(60));
  console.log("JSON SUMMARY");
  console.log("=".repeat(60));
  const summary = {
    timestamp: new Date().toISOString(),
    mode: realProvider ? "real-provider" : mode,
    total,
    passed,
    failed: total - passed,
    tests: results.map(r => ({
      name: r.name,
      passed: r.passed,
      durationMs: r.durationMs,
      status: r.result?.status,
      decision: r.result?.decision?.decision,
      candidateId: r.result?.decision?.candidateId,
      providerName: r.result?.diagnostics?.provider
    }))
  };
  console.log(JSON.stringify(summary, null, 2));

  if (passed < total) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
