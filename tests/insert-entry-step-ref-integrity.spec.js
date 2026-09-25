"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
(0, test_1.test)("insertEntrySteps remaps refs and protects referenced legacy entry steps", () => {
    const result = (0, scenario_preview_service_1.insertEntrySteps)({
        steps: ["1. Clic en \"entry\".", "2. A", "3. B"],
        stepRequirementRefs: [
            { stepIndex: 1, requirementId: "R-A" },
            { stepIndex: 2, requirementId: "R-B" },
        ],
    }, ["entry"]);
    (0, test_1.expect)(result.steps).toEqual(["1. Clic en \"entry\".", "2. A", "3. B"]);
    (0, test_1.expect)(result.stepRequirementRefs).toEqual([
        { stepIndex: 1, requirementId: "R-A" },
        { stepIndex: 2, requirementId: "R-B" },
    ]);
    const shifted = (0, scenario_preview_service_1.insertEntrySteps)({
        steps: ["A", "B"],
        stepRequirementRefs: [{ stepIndex: 1, requirementId: "R1" }],
    }, ["ENTRY"]);
    (0, test_1.expect)(shifted.stepRequirementRefs).toEqual([{ stepIndex: 2, requirementId: "R1" }]);
    const mixed = (0, scenario_preview_service_1.insertEntrySteps)({
        steps: ["1. Clic en \"entry-a\".", "2. branch"],
        stepRequirementRefs: [{ stepIndex: 0, requirementId: "R1" }],
    }, ["entry-a", "entry-b"]);
    (0, test_1.expect)(mixed.steps).toEqual(["1. Clic en \"entry-a\".", "2. Clic en \"entry-b\".", "3. branch"]);
    (0, test_1.expect)(mixed.stepRequirementRefs).toEqual([{ stepIndex: 0, requirementId: "R1" }]);
});
