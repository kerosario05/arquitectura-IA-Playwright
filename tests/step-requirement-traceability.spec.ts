import { test, expect } from "@playwright/test";
import { validateStepRequirementRefs } from "../src/scenarios/scenario-functional-quality";

test("validates step requirement references by ID and reports missing prerequisites", () => {
  const requirements = [
    { id: "prerequisite:1", requirementId: "prerequisite:1", sourceIssueKey: "I", category: "prerequisite", sourceText: "x", expectedBehavior: "x" },
    { id: "req-branch-1", requirementId: "req-branch-1", sourceIssueKey: "I", category: "branch", sourceText: "y", expectedBehavior: "y", associatedBranchId: "branch-1", prerequisiteRequirementIds: ["prerequisite:1"] },
  ] as any;
  const valid = validateStepRequirementRefs({
    steps: ["changed text", "branch text"],
    requirementDependencies: [{ requirementId: "req-branch-1", prerequisiteRequirementIds: ["prerequisite:1"] }],
    stepRequirementRefs: [
      { stepIndex: 0, requirementId: "prerequisite:1" },
      { stepIndex: 1, requirementId: "req-branch-1", prerequisiteRequirementIds: ["prerequisite:1"] },
      { stepIndex: 1, requirementId: "invented-id" },
    ],
  } as any, requirements);
  expect(valid.stepRequirementRefs).toHaveLength(2);
  expect(valid.missingPrerequisiteRequirementIds).toEqual([]);
  expect(validateStepRequirementRefs({
    steps: ["branch"],
    requirementDependencies: [{ requirementId: "req-branch-1", prerequisiteRequirementIds: ["prerequisite:1"] }],
    stepRequirementRefs: [{ stepIndex: 0, requirementId: "req-branch-1" }],
  } as any, requirements).missingPrerequisiteRequirementIds).toEqual(["prerequisite:1"]);
});
