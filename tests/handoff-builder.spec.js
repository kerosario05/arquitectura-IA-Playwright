"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const handoff_builder_1 = require("../src/agent/handoff-builder");
const dataContext = {
    entries: [{ key: "username", value: "demo", source: "test_data", sensitive: false }],
    counts: { total: 1, sensitive: 0, nonSensitive: 1 }
};
const plan = {
    version: "1.0",
    source: "manual",
    status: "draft",
    scenario: { source: "manual", title: "sample" },
    requiredData: [],
    steps: [{ index: 1, action: "noop" }],
    createdAt: new Date().toISOString()
};
(0, test_1.test)("includes all constraints as true", () => {
    const request = (0, handoff_builder_1.buildAgentHandoffRequest)({ kind: "plan_repair", goal: "Fix plan", currentPlan: plan, dataContext });
    (0, test_1.expect)(request.constraints.noApiKey).toBe(true);
    (0, test_1.expect)(request.constraints.noPlaywrightExecution).toBe(true);
    (0, test_1.expect)(request.constraints.doNotModifyStableRegistry).toBe(true);
});
(0, test_1.test)("includes action registry supported actions", () => {
    const request = (0, handoff_builder_1.buildAgentHandoffRequest)({ kind: "plan_repair", goal: "Fix plan", dataContext });
    (0, test_1.expect)(request.actionRegistry.supportedActions.length).toBeGreaterThan(0);
});
(0, test_1.test)("includes safe summary without values", () => {
    const request = (0, handoff_builder_1.buildAgentHandoffRequest)({ kind: "plan_repair", goal: "Fix plan", dataContext });
    (0, test_1.expect)(request.dataContextSummary.availableKeys[0]).toHaveProperty("key");
    (0, test_1.expect)(request.dataContextSummary.availableKeys[0].value).toBeUndefined();
});
(0, test_1.test)("does not mutate source plan", () => {
    const original = JSON.parse(JSON.stringify(plan));
    void (0, handoff_builder_1.buildAgentHandoffRequest)({ kind: "plan_repair", goal: "Fix plan", currentPlan: plan, dataContext });
    (0, test_1.expect)(plan).toEqual(original);
});
