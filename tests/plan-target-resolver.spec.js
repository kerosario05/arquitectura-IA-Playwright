"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const plan_target_resolver_1 = require("../src/runner/plan-target-resolver");
function createMockPage() {
    const calls = [];
    const locator = { calls };
    const page = {
        getByRole: () => locator,
        getByText: () => locator,
        getByLabel: () => locator,
        getByPlaceholder: () => locator,
        getByTestId: () => locator,
        locator: (value) => {
            calls.push(value);
            return locator;
        }
    };
    return { page, calls };
}
(0, test_1.test)("semantic target throws clear error", () => {
    const { page } = createMockPage();
    (0, test_1.expect)(() => (0, plan_target_resolver_1.resolveLocatorFromPlanTarget)(page, { strategy: "semantic", value: "user field" })).toThrow(/semantic target is not executable/);
});
(0, test_1.test)("incomplete testId target throws clear error", () => {
    const { page } = createMockPage();
    (0, test_1.expect)(() => (0, plan_target_resolver_1.resolveLocatorFromPlanTarget)(page, { strategy: "testId" })).toThrow(/Missing value\/name/);
});
(0, test_1.test)("xpath prefix is added when missing", () => {
    const { page, calls } = createMockPage();
    (0, plan_target_resolver_1.resolveLocatorFromPlanTarget)(page, { strategy: "xpath", value: "//button" });
    (0, test_1.expect)(calls[0]).toBe("xpath=//button");
});
(0, test_1.test)("existing xpath prefix is preserved", () => {
    const { page, calls } = createMockPage();
    (0, plan_target_resolver_1.resolveLocatorFromPlanTarget)(page, { strategy: "xpath", value: "xpath=//button" });
    (0, test_1.expect)(calls[0]).toBe("xpath=//button");
});
