import { test, expect } from "@playwright/test";
import type { FunctionalRequirementAccount, McpScenario } from "../src/scenarios/scenario-types";

test("canonical requirement accounting contract preserves optional dependencies", () => {
  const legacy: FunctionalRequirementAccount = {
    sourceIssueKey: "ISSUE-1",
    category: "action",
    sourceText: "source",
    expectedBehavior: "behavior",
  };
  const dependent: FunctionalRequirementAccount = {
    ...legacy,
    requirementId: "req-B",
    prerequisiteRequirementIds: ["req-A"],
  };
  const scenario: McpScenario = {
    sourceIssueKey: "ISSUE-1",
    title: "scenario",
    steps: [],
    preconditions: [],
    expectedResult: "",
    type: "functional",
    database: "",
    isConverted: 0,
    automationType: "ui",
    setupStrategy: "none",
    appSlug: "app",
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    requirementDependencies: [{
      requirementId: dependent.requirementId!,
      prerequisiteRequirementIds: dependent.prerequisiteRequirementIds,
    }],
  };
  expect(legacy.requirementId).toBeUndefined();
  expect(scenario.requirementDependencies).toEqual([{ requirementId: "req-B", prerequisiteRequirementIds: ["req-A"] }]);
});
