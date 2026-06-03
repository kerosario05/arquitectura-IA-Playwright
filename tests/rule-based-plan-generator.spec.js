"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const rule_based_plan_generator_1 = require("../src/plans/rule-based-plan-generator");
const execution_plan_validator_1 = require("../src/plans/execution-plan-validator");
function createScenario() {
    return {
        source: "testrail",
        externalId: "C321",
        caseId: 321,
        title: "Transfer flow",
        steps: [
            { index: 1, action: "Ingresar cedula", expected: "Aceptado", dataHints: ["cedula"] },
            { index: 2, action: "Ingresar codigo", expected: "Continuar", dataHints: ["codigo"] }
        ]
    };
}
(0, test_1.test)("generates initial navigate step", () => {
    const plan = (0, rule_based_plan_generator_1.generateRuleBasedExecutionPlan)(createScenario());
    (0, test_1.expect)(plan.steps[0].action).toBe("navigate");
    (0, test_1.expect)(plan.steps[0].target).toBe("APP_BASE_URL");
});
(0, test_1.test)("generates login step when includeLogin=true", () => {
    const plan = (0, rule_based_plan_generator_1.generateRuleBasedExecutionPlan)(createScenario(), { includeLogin: true });
    (0, test_1.expect)(plan.steps.some((step) => step.action === "login")).toBe(true);
});
(0, test_1.test)("converts scenario steps to noop", () => {
    const plan = (0, rule_based_plan_generator_1.generateRuleBasedExecutionPlan)(createScenario());
    const noopSteps = plan.steps.filter((step) => step.action === "noop");
    (0, test_1.expect)(noopSteps).toHaveLength(2);
    (0, test_1.expect)(noopSteps[0].description).toBe("Ingresar cedula");
});
(0, test_1.test)("converts dataHints to requiredData", () => {
    const plan = (0, rule_based_plan_generator_1.generateRuleBasedExecutionPlan)(createScenario());
    (0, test_1.expect)(plan.requiredData.map((item) => item.key)).toEqual(test_1.expect.arrayContaining(["cedula", "codigo"]));
    (0, test_1.expect)(plan.requiredData.every((item) => item.required && !item.resolved)).toBe(true);
});
(0, test_1.test)("generated draft plan is valid", () => {
    const plan = (0, rule_based_plan_generator_1.generateRuleBasedExecutionPlan)(createScenario());
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.status).toBe("draft");
});
