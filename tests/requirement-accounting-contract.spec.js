"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
(0, test_1.test)("canonical requirement accounting contract preserves optional dependencies", () => {
    const legacy = {
        sourceIssueKey: "ISSUE-1",
        category: "action",
        sourceText: "source",
        expectedBehavior: "behavior",
    };
    const dependent = {
        ...legacy,
        requirementId: "req-B",
        prerequisiteRequirementIds: ["req-A"],
    };
    const scenario = {
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
                requirementId: dependent.requirementId,
                prerequisiteRequirementIds: dependent.prerequisiteRequirementIds,
            }],
    };
    (0, test_1.expect)(legacy.requirementId).toBeUndefined();
    (0, test_1.expect)(scenario.requirementDependencies).toEqual([{ requirementId: "req-B", prerequisiteRequirementIds: ["req-A"] }]);
});
