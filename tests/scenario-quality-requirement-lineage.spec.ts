import { test, expect } from "@playwright/test";
import { applyScenarioQualityGate } from "../src/scenarios/codex-scenario-generator";

test("preserves referenced steps and remaps refs after quality cleanup", () => {
  const result = applyScenarioQualityGate([{
    sourceIssueKey: "I",
    title: "Scenario",
    steps: ['1. Clic en "Start".', '2. Clic en "Start".', '3. Clic en "Branch".'],
    stepRequirementRefs: [{ stepIndex: 0, requirementId: "R1" }, { stepIndex: 2, requirementId: "R2" }],
  }], [{ key: "I", summary: "", description: "", acceptanceCriteria: "", labels: [], components: [], status: "", issueType: "" }], { visibleControls: ["Start"] } as any);

  expect(result.scenarios[0].steps).toHaveLength(2);
  expect(result.scenarios[0].stepRequirementRefs).toEqual([
    { stepIndex: 0, requirementId: "R1" },
    { stepIndex: 1, requirementId: "R2" },
  ]);
});
