"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registryLocatorToPlanTarget = registryLocatorToPlanTarget;
function registryLocatorToPlanTarget(locator) {
    switch (locator.strategy) {
        case "role":
            return {
                strategy: "role",
                role: locator.role,
                name: locator.name,
                exact: locator.exact
            };
        case "text":
            return {
                strategy: "text",
                value: locator.value ?? locator.name,
                name: locator.name,
                exact: locator.exact
            };
        case "label":
            return {
                strategy: "label",
                value: locator.value ?? locator.name,
                name: locator.name,
                exact: locator.exact
            };
        case "placeholder":
            return {
                strategy: "placeholder",
                value: locator.value ?? locator.name,
                name: locator.name,
                exact: locator.exact
            };
        case "testId":
            return {
                strategy: "testId",
                value: locator.value
            };
        case "css":
            return {
                strategy: "css",
                value: locator.value
            };
        case "xpath":
            return {
                strategy: "xpath",
                value: locator.value
            };
        default:
            return {
                strategy: "css",
                value: locator.value
            };
    }
}
