"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
(0, test_1.test)("validates step requirement references by ID and reports missing prerequisites", () => {
    const requirements = [
        { id: "prerequisite:1", requirementId: "prerequisite:1", sourceIssueKey: "I", category: "prerequisite", sourceText: "x", expectedBehavior: "x" },
        { id: "req-branch-1", requirementId: "req-branch-1", sourceIssueKey: "I", category: "branch", sourceText: "y", expectedBehavior: "y", associatedBranchId: "branch-1", prerequisiteRequirementIds: ["prerequisite:1"] },
    ];
    const valid = (0, scenario_functional_quality_1.validateStepRequirementRefs)({
        steps: ["changed text", "branch text"],
        requirementDependencies: [{ requirementId: "req-branch-1", prerequisiteRequirementIds: ["prerequisite:1"] }],
        stepRequirementRefs: [
            { stepIndex: 0, requirementId: "prerequisite:1" },
            { stepIndex: 1, requirementId: "req-branch-1", prerequisiteRequirementIds: ["prerequisite:1"] },
            { stepIndex: 1, requirementId: "invented-id" },
        ],
    }, requirements);
    (0, test_1.expect)(valid.stepRequirementRefs).toHaveLength(2);
    (0, test_1.expect)(valid.missingPrerequisiteRequirementIds).toEqual([]);
    (0, test_1.expect)((0, scenario_functional_quality_1.validateStepRequirementRefs)({
        steps: ["branch"],
        requirementDependencies: [{ requirementId: "req-branch-1", prerequisiteRequirementIds: ["prerequisite:1"] }],
        stepRequirementRefs: [{ stepIndex: 0, requirementId: "req-branch-1" }],
    }, requirements).missingPrerequisiteRequirementIds).toEqual(["prerequisite:1"]);
});
