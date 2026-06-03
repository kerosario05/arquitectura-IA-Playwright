"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const plan_repair_goal_1 = require("../src/cases/plan-repair-goal");
(0, test_1.test)("plan repair goal requires AgentHandoffResponse wrapper", () => {
    const goal = (0, plan_repair_goal_1.buildPlanRepairGoal)({
        caseId: 37618,
        scenarioTitle: "Repair sample",
        pendingSteps: [
            { index: 2, action: "noop", description: "Resolve field target" },
            { index: 3, action: "noop", description: "Resolve submit action" }
        ]
    });
    (0, test_1.expect)(goal).toContain("AgentHandoffResponse");
    (0, test_1.expect)(goal).toContain("top-level plans array");
    (0, test_1.expect)(goal).not.toContain("Return a valid ExecutionPlan JSON");
});
