"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const execution_plan_validator_1 = require("../src/plans/execution-plan-validator");
function createValidPlan() {
    return {
        version: "1.0",
        source: "manual",
        status: "draft",
        scenario: { source: "manual", title: "Basic scenario" },
        requiredData: [{ key: "username", required: true, resolved: true }],
        steps: [{ index: 1, action: "navigate", target: "APP_BASE_URL" }],
        createdAt: new Date().toISOString()
    };
}
(0, test_1.test)("valid minimum plan", () => {
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(createValidPlan());
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("fill without target is invalid", () => {
    const plan = createValidPlan();
    plan.steps = [{ index: 1, action: "fill", value: "abc" }];
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    (0, test_1.expect)(result.valid).toBe(false);
});
(0, test_1.test)("fill without value and valueKey is invalid", () => {
    const plan = createValidPlan();
    plan.steps = [{ index: 1, action: "fill", target: { strategy: "css", value: "#x" } }];
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    (0, test_1.expect)(result.valid).toBe(false);
});
(0, test_1.test)("assertText without expected is invalid", () => {
    const plan = createValidPlan();
    plan.steps = [{ index: 1, action: "assertText", target: { strategy: "text", value: "hello" } }];
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    (0, test_1.expect)(result.valid).toBe(false);
});
(0, test_1.test)("duplicated step indexes are invalid", () => {
    const plan = createValidPlan();
    plan.steps = [
        { index: 1, action: "navigate", target: "APP_BASE_URL" },
        { index: 1, action: "screenshot" }
    ];
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    (0, test_1.expect)(result.valid).toBe(false);
});
(0, test_1.test)("unresolved requiredData with validated status is invalid", () => {
    const plan = createValidPlan();
    plan.status = "validated";
    plan.requiredData = [{ key: "otp", required: true, resolved: false }];
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    (0, test_1.expect)(result.valid).toBe(false);
});
(0, test_1.test)("valueKey not declared in requiredData raises warning", () => {
    const plan = createValidPlan();
    plan.steps = [{ index: 1, action: "fill", target: { strategy: "css", value: "#u" }, valueKey: "missingKey" }];
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.issues.some((issue) => issue.level === "warning" && issue.code === "STEP_VALUEKEY_NOT_DECLARED")).toBe(true);
});
(0, test_1.test)("unsupported status allows empty steps", () => {
    const plan = createValidPlan();
    plan.status = "unsupported";
    plan.steps = [];
    const result = (0, execution_plan_validator_1.validateExecutionPlan)(plan);
    (0, test_1.expect)(result.valid).toBe(true);
});
