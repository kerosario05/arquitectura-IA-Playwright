import { expect, test } from "@playwright/test";
import { buildAgentHandoffRequest } from "../src/agent/handoff-builder";
import type { DataContext } from "../src/data/data-context";
import type { ExecutionPlan } from "../src/types/execution-plan.types";

const dataContext: DataContext = {
  entries: [{ key: "username", value: "demo", source: "test_data", sensitive: false }],
  counts: { total: 1, sensitive: 0, nonSensitive: 1 }
};

const plan: ExecutionPlan = {
  version: "1.0",
  source: "manual",
  status: "draft",
  scenario: { source: "manual", title: "sample" },
  requiredData: [],
  steps: [{ index: 1, action: "noop" }],
  createdAt: new Date().toISOString()
};

test("includes all constraints as true", () => {
  const request = buildAgentHandoffRequest({ kind: "plan_repair", goal: "Fix plan", currentPlan: plan, dataContext });
  expect(request.constraints.noApiKey).toBe(true);
  expect(request.constraints.noPlaywrightExecution).toBe(true);
  expect(request.constraints.doNotModifyStableRegistry).toBe(true);
});

test("includes action registry supported actions", () => {
  const request = buildAgentHandoffRequest({ kind: "plan_repair", goal: "Fix plan", dataContext });
  expect(request.actionRegistry.supportedActions.length).toBeGreaterThan(0);
});

test("includes safe summary without values", () => {
  const request = buildAgentHandoffRequest({ kind: "plan_repair", goal: "Fix plan", dataContext });
  expect(request.dataContextSummary.availableKeys[0]).toHaveProperty("key");
  expect((request.dataContextSummary.availableKeys[0] as unknown as { value?: string }).value).toBeUndefined();
});

test("does not mutate source plan", () => {
  const original = JSON.parse(JSON.stringify(plan));
  void buildAgentHandoffRequest({ kind: "plan_repair", goal: "Fix plan", currentPlan: plan, dataContext });
  expect(plan).toEqual(original);
});
