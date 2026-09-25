"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const codex_scenario_generator_1 = require("../src/scenarios/codex-scenario-generator");
(0, test_1.test)("preserves referenced steps and remaps refs after quality cleanup", () => {
    const result = (0, codex_scenario_generator_1.applyScenarioQualityGate)([{
            sourceIssueKey: "I",
            title: "Scenario",
            steps: ['1. Clic en "Start".', '2. Clic en "Start".', '3. Clic en "Branch".'],
            stepRequirementRefs: [{ stepIndex: 0, requirementId: "R1" }, { stepIndex: 2, requirementId: "R2" }],
        }], [{ key: "I", summary: "", description: "", acceptanceCriteria: "", labels: [], components: [], status: "", issueType: "" }], { visibleControls: ["Start"] });
    (0, test_1.expect)(result.scenarios[0].steps).toHaveLength(2);
    (0, test_1.expect)(result.scenarios[0].stepRequirementRefs).toEqual([
        { stepIndex: 0, requirementId: "R1" },
        { stepIndex: 1, requirementId: "R2" },
    ]);
});
