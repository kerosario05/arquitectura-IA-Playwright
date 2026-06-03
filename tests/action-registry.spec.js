"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const action_registry_1 = require("../src/registry/action-registry");
(0, test_1.test)("lists supported actions", () => {
    const actions = (0, action_registry_1.listSupportedActions)();
    (0, test_1.expect)(actions).toEqual(test_1.expect.arrayContaining(["navigate", "login", "click", "fill", "select", "assertText", "assertUrl", "noop"]));
});
(0, test_1.test)("fill requires target and value", () => {
    const fill = (0, action_registry_1.getActionCapability)("fill");
    (0, test_1.expect)(fill).toBeDefined();
    (0, test_1.expect)(fill?.requiresTarget).toBe(true);
    (0, test_1.expect)(fill?.requiresValue).toBe(true);
    (0, test_1.expect)(fill?.allowsValueKey).toBe(true);
});
(0, test_1.test)("assertText requires expected", () => {
    const capability = (0, action_registry_1.getActionCapability)("assertText");
    (0, test_1.expect)(capability?.requiresExpected).toBe(true);
});
(0, test_1.test)("noop does not require target", () => {
    const capability = (0, action_registry_1.getActionCapability)("noop");
    (0, test_1.expect)(capability?.requiresTarget).toBe(false);
});
(0, test_1.test)("getActionCapability returns existing action", () => {
    const capability = (0, action_registry_1.getActionCapability)("navigate");
    (0, test_1.expect)(capability?.action).toBe("navigate");
});
