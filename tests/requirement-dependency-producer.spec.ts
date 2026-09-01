import { test, expect } from "@playwright/test";
import { buildRequirementAccounting } from "../src/scenarios/scenario-functional-quality";

test("produces structured source IDs without inventing dependencies", () => {
  const result = buildRequirementAccounting([], [
    {
      branchId: "branch-1",
      sourceRequirementId: "req-branch-1",
      sourceLabel: "branch label A",
      actionIntent: "click",
      accessIntent: "public",
      evidenceSource: "user_story",
    },
    {
      branchId: "branch-2",
      sourceRequirementId: "req-branch-2",
      sourceLabel: "branch label B",
      actionIntent: "click",
      accessIntent: "public",
      evidenceSource: "user_story",
    },
  ], "Antes de continuar, seleccionar una opcion. Cada rama debe validar su resultado.", "ISSUE-1");
  const branches = result.requirements.filter((r) => r.category === "branch");
  expect(branches.map((r) => r.sourceRequirementId)).toEqual(["req-branch-1", "req-branch-2"]);
  expect(branches.every((r) => r.prerequisiteRequirementIds?.length === 1)).toBe(true);
  expect(branches[0].prerequisiteRequirementIds).toEqual(["prerequisite:1"]);
  expect(branches[1].prerequisiteRequirementIds).toEqual(["prerequisite:1"]);
});

test("bridges accounting dependencies to scenarios by branch ID only", () => {
  const scenario: any = {
    functionalBranch: { branchId: "branch-1" },
  };
  const accounting = buildRequirementAccounting([scenario], [
    {
      branchId: "branch-1",
      sourceRequirementId: "req-branch-1",
      sourceLabel: "branch label",
      actionIntent: "click",
      accessIntent: "public",
      evidenceSource: "user_story",
    },
  ], "Antes de continuar, seleccionar una opcion.", "ISSUE-1");
  expect(accounting.requirements.find((r) => r.category === "branch")?.prerequisiteRequirementIds).toEqual(["prerequisite:1"]);
  expect(scenario.requirementDependencies).toEqual([{
    requirementId: "req-branch-1",
    prerequisiteRequirementIds: ["prerequisite:1"],
  }]);
});
