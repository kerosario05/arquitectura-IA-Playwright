import { expect, test } from "@playwright/test";
import { buildPlanRepairGoal } from "../src/cases/plan-repair-goal";

test("plan repair goal requires AgentHandoffResponse wrapper", () => {
  const goal = buildPlanRepairGoal({
    caseId: 37618,
    scenarioTitle: "Repair sample",
    pendingSteps: [
      { index: 2, action: "noop", description: "Resolve field target" },
      { index: 3, action: "noop", description: "Resolve submit action" }
    ]
  });

  expect(goal).toContain("AgentHandoffResponse");
  expect(goal).toContain("top-level plans array");
  expect(goal).not.toContain("Return a valid ExecutionPlan JSON");
});
