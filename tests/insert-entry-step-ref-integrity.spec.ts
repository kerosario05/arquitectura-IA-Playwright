import { test, expect } from "@playwright/test";
import { insertEntrySteps } from "../src/scenarios/scenario-preview.service";

test("insertEntrySteps remaps refs and protects referenced legacy entry steps", () => {
  const result = insertEntrySteps({
    steps: ["1. Clic en \"entry\".", "2. A", "3. B"],
    stepRequirementRefs: [
      { stepIndex: 1, requirementId: "R-A" },
      { stepIndex: 2, requirementId: "R-B" },
    ],
  } as any, ["entry"]);

  expect(result.steps).toEqual(["1. Clic en \"entry\".", "2. A", "3. B"]);
  expect(result.stepRequirementRefs).toEqual([
    { stepIndex: 1, requirementId: "R-A" },
    { stepIndex: 2, requirementId: "R-B" },
  ]);

  const shifted = insertEntrySteps({
    steps: ["A", "B"],
    stepRequirementRefs: [{ stepIndex: 1, requirementId: "R1" }],
  } as any, ["ENTRY"]);
  expect(shifted.stepRequirementRefs).toEqual([{ stepIndex: 2, requirementId: "R1" }]);

  const mixed = insertEntrySteps({
    steps: ["1. Clic en \"entry-a\".", "2. branch"],
    stepRequirementRefs: [{ stepIndex: 0, requirementId: "R1" }],
  } as any, ["entry-a", "entry-b"]);
  expect(mixed.steps).toEqual(["1. Clic en \"entry-a\".", "2. Clic en \"entry-b\".", "3. branch"]);
  expect(mixed.stepRequirementRefs).toEqual([{ stepIndex: 0, requirementId: "R1" }]);
});
