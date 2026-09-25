"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const app_profile_1 = require("./app-profile");
const case_discovery_workflow_1 = require("../discovery/case-discovery-workflow");
function config(ignoreHTTPSErrors) {
    return {
        app: {
            appProfile: "generic-app",
            name: "Generic",
            baseUrl: "https://example.test",
            loginMode: "no_login",
            testData: { marker: "kept" },
            testDataAliases: {},
            missingInputBehavior: "fail",
            ...(ignoreHTTPSErrors === undefined ? {} : { ignoreHTTPSErrors }),
        },
    };
}
(0, node_test_1.default)("preserves true, false, and absence through promotion and merge", () => {
    for (const value of [true, false, undefined]) {
        const serialized = (0, app_profile_1.serializeRuntimeConfigForPromotion)(config(value));
        strict_1.default.equal(serialized.ignoreHTTPSErrors, value);
        strict_1.default.equal(serialized.appProfile.ignoreHTTPSErrors, value);
        const merged = (0, app_profile_1.buildMergedConfig)(serialized, config(value));
        strict_1.default.equal(merged.app.ignoreHTTPSErrors, value);
        strict_1.default.equal(merged.app.baseUrl, "https://example.test");
    }
});
(0, node_test_1.default)("project-scoped boolean wins over legacy truthiness", () => {
    const legacy = config(true);
    strict_1.default.equal((0, app_profile_1.buildMergedConfig)({ ...(0, app_profile_1.serializeRuntimeConfigForPromotion)(config(false)), ignoreHTTPSErrors: false }, legacy).app.ignoreHTTPSErrors, false);
    strict_1.default.equal((0, app_profile_1.buildMergedConfig)({ ...(0, app_profile_1.serializeRuntimeConfigForPromotion)(config(true)), ignoreHTTPSErrors: true }, config(false)).app.ignoreHTTPSErrors, true);
});
(0, node_test_1.default)("discovery context projection keeps the existing strict boolean semantics", () => {
    strict_1.default.equal((0, case_discovery_workflow_1.buildDiscoveryBrowserContextOptions)({ app: { ignoreHTTPSErrors: true } }).ignoreHTTPSErrors, true);
    strict_1.default.equal((0, case_discovery_workflow_1.buildDiscoveryBrowserContextOptions)({ app: { ignoreHTTPSErrors: false } }).ignoreHTTPSErrors, false);
});
