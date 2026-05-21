import { test, expect } from "@playwright/test";
import { validateRouteRecoveryPlan } from "../src/agent/agent-response-validator";

const validPack = {
  topVisibleCandidates: [
    { id: "btn-login" },
    { id: "inp-user" }
  ],
  topKnownObjects: [
    { key: "obj-login" },
    { key: "obj-user" }
  ],
  topKnownRoutes: [
    { sourcePlanId: "plan-login" }
  ],
  topKnownPlans: [
    { id: "plan-1" },
    { id: "plan-2" }
  ],
  budget: {
    maxProposedActions: 5,
    maxRationaleChars: 1200,
    maxUnresolvedQuestions: 5
  }
};

// --- repaired_plan validation tests ---

test("validateRouteRecoveryPlan accepts valid repaired_plan", () => {
  const result = validateRouteRecoveryPlan({
    decision: "repaired_plan",
    actions: [
      { actionType: "click", candidateId: "btn-login", confidence: 0.8, rationale: "Found login button" }
    ],
    rationale: ["Short rationale"]
  }, validPack);
  expect(result.valid).toBe(true);
  expect(result.decision).toBe("repaired_plan");
});

test("validateRouteRecoveryPlan rejects nonexistent candidateId", () => {
  const result = validateRouteRecoveryPlan({
    decision: "repaired_plan",
    actions: [
      { actionType: "click", candidateId: "nonexistent", confidence: 0.8 }
    ]
  }, validPack);
  expect(result.valid).toBe(false);
  const issue = result.issues.find((i) => i.code === "CANDIDATE_ID_NOT_FOUND");
  expect(issue).toBeDefined();
});

test("validateRouteRecoveryPlan rejects nonexistent objectId", () => {
  const result = validateRouteRecoveryPlan({
    decision: "repaired_plan",
    actions: [
      { actionType: "click", objectId: "no-such-obj", confidence: 0.8 }
    ]
  }, validPack);
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "OBJECT_ID_NOT_FOUND")).toBe(true);
});

test("validateRouteRecoveryPlan accepts no_safe_action without actions", () => {
  const result = validateRouteRecoveryPlan({
    decision: "no_safe_action",
    rationale: ["No route found"]
  }, validPack);
  expect(result.valid).toBe(true);
  expect(result.decision).toBe("no_safe_action");
});

test("validateRouteRecoveryPlan accepts needs_more_context without actions", () => {
  const result = validateRouteRecoveryPlan({
    decision: "needs_more_context",
    unresolvedQuestions: ["Need more snapshot data"],
    rationale: ["Missing context"]
  }, validPack);
  expect(result.valid).toBe(true);
  expect(result.decision).toBe("needs_more_context");
});

test("validateRouteRecoveryPlan rejects decision string not in enum", () => {
  const result = validateRouteRecoveryPlan({
    decision: "invalid_decision"
  }, validPack);
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "INVALID_DECISION")).toBe(true);
});

test("validateRouteRecoveryPlan rejects over maxProposedActions", () => {
  const result = validateRouteRecoveryPlan({
    decision: "repaired_plan",
    actions: Array.from({ length: 6 }, (_, i) => ({
      actionType: "click", candidateId: "btn-login", confidence: 0.8
    }))
  }, validPack);
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "MAX_ACTIONS_EXCEEDED")).toBe(true);
});

test("validateRouteRecoveryPlan rejects sensitive action without metadata", () => {
  const result = validateRouteRecoveryPlan({
    decision: "repaired_plan",
    actions: [
      { actionType: "submit", candidateId: "btn-login", confidence: 0.8 }
    ]
  }, validPack);
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "SENSITIVE_MISSING_METADATA")).toBe(true);
});

test("validateRouteRecoveryPlan accepts sensitive action with metadata", () => {
  const result = validateRouteRecoveryPlan({
    decision: "repaired_plan",
    actions: [
      { actionType: "submit", candidateId: "btn-login", confidence: 0.8, sensitive: true }
    ]
  }, validPack);
  expect(result.valid).toBe(true);
});

test("validateRouteRecoveryPlan warns on low confidence", () => {
  const result = validateRouteRecoveryPlan({
    decision: "repaired_plan",
    actions: [
      { actionType: "click", candidateId: "btn-login", confidence: 0.2 }
    ]
  }, validPack);
  expect(result.valid).toBe(true);
  expect(result.issues.some((i) => i.code === "LOW_CONFIDENCE" && i.level === "warning")).toBe(true);
});

test("validateRouteRecoveryPlan warns on too many unresolved questions", () => {
  const result = validateRouteRecoveryPlan({
    decision: "repaired_plan",
    actions: [
      { actionType: "click", candidateId: "btn-login", confidence: 0.8 }
    ],
    unresolvedQuestions: ["q1", "q2", "q3", "q4", "q5", "q6"]
  }, validPack);
  expect(result.issues.some((i) => i.code === "TOO_MANY_UNRESOLVED" && i.level === "warning")).toBe(true);
});

test("validateRouteRecoveryPlan rejects non-object response", () => {
  const result = validateRouteRecoveryPlan("invalid", validPack);
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "RESPONSE_NOT_OBJECT")).toBe(true);
});

// --- validateAgentHandoffResponse with recoveryDecision ---

import { validateAgentHandoffResponse } from "../src/agent/agent-response-validator";

test("validateAgentHandoffResponse accepts no_safe_action with empty plans", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "no_safe_action",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["No safe action available"]
  });
  expect(result.valid).toBe(true);
});

test("validateAgentHandoffResponse accepts needs_more_context with empty plans", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "needs_more_context",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: ["Need more context"],
    rationale: ["Missing data"]
  });
  expect(result.valid).toBe(true);
});

test("validateAgentHandoffResponse rejects empty plans without recoveryDecision", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: []
  });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "RESPONSE_PLANS_EMPTY")).toBe(true);
});

test("validateAgentHandoffResponse accepts empty plans with recoveryDecision no_safe_action even when all empty", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "no_safe_action",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: []
  });
  // no_safe_action with all empty is valid because the decision itself is actionable
  expect(result.valid).toBe(true);
});

test("validateAgentHandoffResponse rejects plans empty with no recoveryDecision even with rationale", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["Some rationale"]
  });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "RESPONSE_PLANS_EMPTY")).toBe(true);
});

// --- compact-route-recovery specific validation tests ---

test("compact-route-recovery rejects plans=[] and no recoveryDecision", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: []
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "RESPONSE_MISSING_RECOVERY_DECISION")).toBe(true);
});

test("compact-route-recovery accepts no_safe_action with rationale", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "no_safe_action",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["No safe action available"]
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(true);
});

test("compact-route-recovery rejects no_safe_action without rationale", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "no_safe_action",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: []
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "NO_SAFE_ACTION_NO_RATIONALE")).toBe(true);
});

test("compact-route-recovery accepts needs_more_context with unresolvedQuestions", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "needs_more_context",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: ["Cannot determine the current screen state."],
    rationale: ["More context needed"]
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(true);
});

test("compact-route-recovery rejects needs_more_context without unresolvedQuestions", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "needs_more_context",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["Missing data"]
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "NEEDS_MORE_NO_QUESTIONS")).toBe(true);
});

test("compact-route-recovery rejects repaired_plan with empty plans", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "repaired_plan",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["Attempted repair but no plans"]
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "REPAIRED_PLAN_EMPTY")).toBe(true);
});

test("compact-route-recovery accepts repaired_plan with valid plans", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "repaired_plan",
    plans: [{
      version: "1.0",
      source: "ai_generated",
      status: "validated",
      scenario: { source: "testrail", caseId: 1, title: "Test" },
      requiredData: [],
      steps: [{ index: 1, action: "click", target: { strategy: "id", value: "btn-login" } }],
      createdAt: new Date().toISOString()
    }],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["Found login button"]
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(true);
});

// --- Schema validation ---

import { agentHandoffResponseJsonSchema } from "../src/agent/agent-response.schema";

test("agent-response.schema requires recoveryDecision", () => {
  const schema = agentHandoffResponseJsonSchema;
  expect(schema.required).toContain("recoveryDecision");
  expect(schema.properties).toHaveProperty("recoveryDecision");
  const rdProp = schema.properties.recoveryDecision;
  expect(rdProp).toBeDefined();
  const rdEnum = (rdProp as Record<string, unknown>).enum as readonly string[];
  expect(rdEnum).toContain("repaired_plan");
  expect(rdEnum).toContain("no_safe_action");
  expect(rdEnum).toContain("needs_more_context");
});

test("agent-response.schema requires generatedAt with minLength", () => {
  const schema = agentHandoffResponseJsonSchema;
  expect(schema.required).toContain("generatedAt");
  const gaProp = schema.properties.generatedAt;
  expect(gaProp).toBeDefined();
  expect((gaProp as Record<string, unknown>).minLength).toBeGreaterThanOrEqual(1);
});

// --- generatedAt empty / placeholder validation ---

test("validateAgentHandoffResponse rejects empty generatedAt", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: "",
    recoveryDecision: "no_safe_action",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["Something"]
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "GENERATED_AT_EMPTY")).toBe(true);
});

test("validateAgentHandoffResponse detects placeholder in target value", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: new Date().toISOString(),
    recoveryDecision: "repaired_plan",
    plans: [{
      version: "1.0",
      source: "ai_generated",
      status: "validated",
      scenario: { source: "testrail", caseId: 1, title: "Test" },
      requiredData: [],
      steps: [{ index: 1, action: "click", target: { strategy: "id", value: "<candidateId from route-recovery-pack.json>" } }],
      createdAt: new Date().toISOString()
    }],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["Selected candidate"]
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "PLACEHOLDER_NOT_REPLACED")).toBe(true);
});

test("validateAgentHandoffResponse detects <iso timestamp> placeholder in generatedAt", () => {
  const result = validateAgentHandoffResponse({
    version: "1.0",
    generatedAt: "<iso timestamp>",
    recoveryDecision: "no_safe_action",
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["No safe option"]
  }, { promptMode: "compact-route-recovery" });
  expect(result.valid).toBe(false);
  expect(result.issues.some((i) => i.code === "PLACEHOLDER_NOT_REPLACED")).toBe(true);
});
