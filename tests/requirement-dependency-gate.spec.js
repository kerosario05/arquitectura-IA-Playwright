"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
const scenario = (dependencies, refs) => ({ requirementDependencies: dependencies, stepRequirementRefs: refs });
const dependency = (id, prerequisites) => ({ requirementId: id, prerequisiteRequirementIds: prerequisites });
const ref = (id, stepIndex) => ({ requirementId: id, stepIndex });
(0, test_1.test)("enforces canonical requirement dependency ordering", () => {
    const canonical = new Map([["R1", []], ["R2", ["R1"]], ["R3", ["R1", "R2"]]]);
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateRequirementDependencyGate)(scenario([dependency("R2", ["R1"])], [ref("R1", 0), ref("R2", 2)]), canonical).dependencySatisfied).toBe(true);
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateRequirementDependencyGate)(scenario([dependency("R2", ["R1"])], [ref("R2", 2)]), canonical).dependencySatisfied).toBe(false);
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateRequirementDependencyGate)(scenario([dependency("R2", ["R1"])], [ref("R1", 3), ref("R2", 1)]), canonical).dependencySatisfied).toBe(false);
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateRequirementDependencyGate)(scenario([dependency("R2", ["RX"])], [ref("R1", 0), ref("R2", 2)]), canonical).dependencySatisfied).toBe(true);
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateRequirementDependencyGate)(scenario([], []), new Map()).dependencySatisfied).toBe(true);
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateRequirementDependencyGate)(scenario([dependency("R3", ["R1", "R2"])], [ref("R1", 0), ref("R2", 1), ref("R3", 3)]), canonical).dependencySatisfied).toBe(true);
    (0, test_1.expect)((0, scenario_preview_service_1.evaluateRequirementDependencyGate)(scenario([dependency("R2", ["R1"])], [ref("R2", 1)]), new Map()).dependencySatisfied).toBe(false);
});
