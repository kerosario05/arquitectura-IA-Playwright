"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const repair_decision_schema_1 = require("../src/ai/repair/repair-decision.schema");
(0, test_1.test)("schema bloquea campos inventados css/xpath/locator/testId", () => {
    (0, test_1.expect)((0, repair_decision_schema_1.hasForbiddenRepairDecisionFields)({ decision: "no_safe_action", reason: "x", css: "#app" })).toBe(true);
    (0, test_1.expect)((0, repair_decision_schema_1.hasForbiddenRepairDecisionFields)({ decision: "no_safe_action", reason: "x", xpath: "//div" })).toBe(true);
    (0, test_1.expect)((0, repair_decision_schema_1.hasForbiddenRepairDecisionFields)({ decision: "no_safe_action", reason: "x", locator: "button" })).toBe(true);
    (0, test_1.expect)((0, repair_decision_schema_1.hasForbiddenRepairDecisionFields)({ decision: "no_safe_action", reason: "x", testId: "btn" })).toBe(true);
});
(0, test_1.test)("schema acepta solo campos permitidos", () => {
    (0, test_1.expect)((0, repair_decision_schema_1.hasForbiddenRepairDecisionFields)({
        decision: "no_safe_action",
        reason: "No safe candidate",
        questions: ["Need snapshot?"]
    })).toBe(false);
});
