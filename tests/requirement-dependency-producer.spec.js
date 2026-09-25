"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
(0, test_1.test)("produces structured source IDs without inventing dependencies", () => {
    const result = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [
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
    (0, test_1.expect)(branches.map((r) => r.sourceRequirementId)).toEqual(["req-branch-1", "req-branch-2"]);
    (0, test_1.expect)(branches.every((r) => r.prerequisiteRequirementIds?.length === 1)).toBe(true);
    (0, test_1.expect)(branches[0].prerequisiteRequirementIds).toEqual(["prerequisite:1"]);
    (0, test_1.expect)(branches[1].prerequisiteRequirementIds).toEqual(["prerequisite:1"]);
});
(0, test_1.test)("bridges accounting dependencies to scenarios by branch ID only", () => {
    const scenario = {
        functionalBranch: { branchId: "branch-1" },
    };
    const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([scenario], [
        {
            branchId: "branch-1",
            sourceRequirementId: "req-branch-1",
            sourceLabel: "branch label",
            actionIntent: "click",
            accessIntent: "public",
            evidenceSource: "user_story",
        },
    ], "Antes de continuar, seleccionar una opcion.", "ISSUE-1");
    (0, test_1.expect)(accounting.requirements.find((r) => r.category === "branch")?.prerequisiteRequirementIds).toEqual(["prerequisite:1"]);
    (0, test_1.expect)(scenario.requirementDependencies).toEqual([{
            requirementId: "req-branch-1",
            prerequisiteRequirementIds: ["prerequisite:1"],
        }]);
});
