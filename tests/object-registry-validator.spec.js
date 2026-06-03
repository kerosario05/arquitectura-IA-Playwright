"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const object_registry_validator_1 = require("../src/registry/object-registry-validator");
function createBaseRegistry() {
    return {
        version: "1.0",
        appName: "generic",
        objects: []
    };
}
(0, test_1.test)("valid empty registry", () => {
    const result = (0, object_registry_validator_1.validateObjectRegistry)(createBaseRegistry());
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("valid role object", () => {
    const registry = createBaseRegistry();
    registry.objects.push({
        key: "loginButton",
        name: "Login Button",
        type: "button",
        locator: { strategy: "role", role: "button", name: "Login" }
    });
    const result = (0, object_registry_validator_1.validateObjectRegistry)(registry);
    (0, test_1.expect)(result.valid).toBe(true);
});
(0, test_1.test)("duplicated key returns error", () => {
    const registry = createBaseRegistry();
    registry.objects.push({ key: "x", name: "X", type: "button", locator: { strategy: "testId", value: "x" } }, { key: "x", name: "X2", type: "button", locator: { strategy: "testId", value: "x2" } });
    const result = (0, object_registry_validator_1.validateObjectRegistry)(registry);
    (0, test_1.expect)(result.valid).toBe(false);
});
(0, test_1.test)("css locator generates warning", () => {
    const registry = createBaseRegistry();
    registry.objects.push({ key: "x", name: "X", type: "input", locator: { strategy: "css", value: "#x" } });
    const result = (0, object_registry_validator_1.validateObjectRegistry)(registry);
    (0, test_1.expect)(result.issues.some((issue) => issue.level === "warning" && issue.code === "LOCATOR_LOW_RESILIENCE")).toBe(true);
});
(0, test_1.test)("xpath locator generates warning", () => {
    const registry = createBaseRegistry();
    registry.objects.push({ key: "x", name: "X", type: "input", locator: { strategy: "xpath", value: "//input" } });
    const result = (0, object_registry_validator_1.validateObjectRegistry)(registry);
    (0, test_1.expect)(result.issues.some((issue) => issue.level === "warning" && issue.code === "LOCATOR_LOW_RESILIENCE")).toBe(true);
});
(0, test_1.test)("role without role or name returns error", () => {
    const registry = createBaseRegistry();
    registry.objects.push({ key: "x", name: "X", type: "button", locator: { strategy: "role" } });
    const result = (0, object_registry_validator_1.validateObjectRegistry)(registry);
    (0, test_1.expect)(result.valid).toBe(false);
});
(0, test_1.test)("duplicate aliases generate warning", () => {
    const registry = createBaseRegistry();
    registry.objects.push({
        key: "x",
        name: "X",
        type: "button",
        locator: { strategy: "testId", value: "x" },
        aliases: ["Ingresar", "ingresar"]
    });
    const result = (0, object_registry_validator_1.validateObjectRegistry)(registry);
    (0, test_1.expect)(result.issues.some((issue) => issue.level === "warning" && issue.code === "ALIASES_DUPLICATED")).toBe(true);
});
