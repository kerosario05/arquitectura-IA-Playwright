"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const plan_value_resolver_1 = require("../src/runner/plan-value-resolver");
const dataContext = {
    entries: [
        { key: "cedula", value: "001", source: "test_data", sensitive: true },
        { key: "numeroPrestamo", value: "ABC", source: "test_data", sensitive: false }
    ],
    counts: { total: 2, sensitive: 1, nonSensitive: 1 }
};
function stepBase() {
    return { index: 1, action: "fill", target: { strategy: "label", value: "Cédula" } };
}
(0, test_1.test)("resolves direct value", () => {
    const step = { ...stepBase(), value: "literal" };
    (0, test_1.expect)((0, plan_value_resolver_1.resolveStepValue)({ step, dataContext })).toBe("literal");
});
(0, test_1.test)("resolves exact valueKey", () => {
    const step = { ...stepBase(), valueKey: "cedula" };
    (0, test_1.expect)((0, plan_value_resolver_1.resolveStepValue)({ step, dataContext })).toBe("001");
});
(0, test_1.test)("resolves normalized valueKey", () => {
    const step = { ...stepBase(), valueKey: "numeroprestamo" };
    (0, test_1.expect)((0, plan_value_resolver_1.resolveStepValue)({ step, dataContext })).toBe("ABC");
});
(0, test_1.test)("throws on missing valueKey", () => {
    const step = { ...stepBase(), valueKey: "missingKey" };
    (0, test_1.expect)(() => (0, plan_value_resolver_1.resolveStepValue)({ step, dataContext })).toThrow(/Missing value for step valueKey/);
});
