import { expect, test } from "@playwright/test";
import { normalizeAgentHandoffResponse, validateAgentHandoffResponse } from "../src/agent/agent-response-validator";

function validPlan() {
  return {
    version: "1.0",
    source: "manual",
    status: "validated",
    scenario: { source: "manual", title: "ok" },
    requiredData: [{ key: "username", required: true, resolved: true }],
    steps: [{ index: 1, action: "navigate", target: "APP_BASE_URL" }],
    createdAt: new Date().toISOString()
  };
}

function validResponse(): any {
  return {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    plans: [validPlan()],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["ok"]
  };
}

test("valid response with valid plan", () => {
  const result = validateAgentHandoffResponse(validResponse());
  expect(result.valid).toBe(true);
});

test("invalid when plans is not array", () => {
  const response = { ...validResponse(), plans: {} };
  const result = validateAgentHandoffResponse(response);
  expect(result.valid).toBe(false);
});

test("invalid when plan is invalid", () => {
  const response = validResponse();
  response.plans[0].steps = [];
  const result = validateAgentHandoffResponse(response);
  expect(result.valid).toBe(false);
});

test("valueKey not available raises error", () => {
  const response = validResponse();
  response.plans[0].steps = [{ index: 1, action: "fill", target: { strategy: "label", value: "User" }, valueKey: "k2" }];
  const result = validateAgentHandoffResponse(response, { availableDataKeys: ["k1"] });
  expect(result.valid).toBe(false);
  expect(result.issues.some((issue) => issue.code === "PLAN_VALUEKEY_NOT_AVAILABLE")).toBe(true);
});

test("low confidence proposed object gives warning", () => {
  const response = validResponse();
  response.proposedObjects = [{ key: "x", name: "x", type: "input", locator: {}, reason: "maybe", confidence: 0.5 }];
  const result = validateAgentHandoffResponse(response);
  expect(result.issues.some((issue) => issue.level === "warning" && issue.code === "PROPOSED_OBJECT_LOW_CONFIDENCE")).toBe(true);
});

test("proposed objects are only validated, not applied", () => {
  const response = validResponse();
  response.proposedObjects = [{ key: "x", name: "x", type: "input", locator: {}, reason: "proposal", confidence: 0.9 }];
  const result = validateAgentHandoffResponse(response);
  expect(result.valid).toBe(true);
});

test("normalizes a bare execution plan into a valid handoff response", () => {
  const normalized = normalizeAgentHandoffResponse(validPlan()) as ReturnType<typeof validResponse>;
  expect(normalized.plans).toHaveLength(1);
  expect(normalized.proposedObjects).toEqual([]);
  expect(normalized.unresolvedQuestions).toEqual([]);
  expect(normalized.rationale.length).toBeGreaterThan(0);
});

test("bare execution plan is accepted via normalization", () => {
  const result = validateAgentHandoffResponse(validPlan());
  expect(result.valid).toBe(true);
});

test("empty response with all zeros is not actionable", () => {
  const response = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: []
  };

  const result = validateAgentHandoffResponse(response);

  expect(result.valid).toBe(false);
  expect(result.issues.some((issue) => issue.code === "RESPONSE_NOT_ACTIONABLE")).toBe(true);
  expect(result.issues.some((issue) => issue.code === "RESPONSE_PLANS_EMPTY")).toBe(true);
});

test("response with empty plans array is invalid", () => {
  const response = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [],
    rationale: ["some rationale"]
  };

  const result = validateAgentHandoffResponse(response);

  expect(result.valid).toBe(false);
  expect(result.issues.some((issue) => issue.code === "RESPONSE_PLANS_EMPTY")).toBe(true);
});

test("response with at least one valid plan is actionable", () => {
  const response = validResponse();
  const result = validateAgentHandoffResponse(response);

  expect(result.valid).toBe(true);
  expect(result.issues.some((issue) => issue.code === "RESPONSE_NOT_ACTIONABLE")).toBe(false);
});

test("response with unresolved questions is actionable even with empty plans", () => {
  const response = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    plans: [],
    proposedObjects: [],
    unresolvedQuestions: [{ question: "Need more info", context: "test" }],
    rationale: ["Agent could not complete"]
  };

  const result = validateAgentHandoffResponse(response);

  expect(result.issues.some((issue) => issue.code === "RESPONSE_PLANS_EMPTY")).toBe(true);
});
