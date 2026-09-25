"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const test_promoted_1 = require("./test-promoted");
const playwright_config_1 = require("../../playwright.config");
const baseConfig = {
    appProfile: { appSlug: "generic-app", source: "default", createdAt: "", updatedAt: "" },
    baseUrl: "https://example.test",
    loginMode: "no_login",
    testData: {},
    testDataAliases: {},
    testDataRefs: {},
    missingInputBehavior: "fail",
    updatedAt: "",
};
(0, node_test_1.default)("projects explicit project TLS true and false without changing base URL", () => {
    for (const value of [true, false]) {
        const env = (0, test_promoted_1.buildPromotedExecutionEnvWithConfig)({ APP_BASE_URL: "https://legacy.test", APP_IGNORE_HTTPS_ERRORS: "true" }, "generic-app", { ...baseConfig, ignoreHTTPSErrors: value });
        strict_1.default.equal(env.APP_BASE_URL, "https://example.test");
        strict_1.default.equal(env.APP_IGNORE_HTTPS_ERRORS, String(value));
        strict_1.default.equal((0, playwright_config_1.resolvePromotedIgnoreHTTPSErrors)(env.APP_IGNORE_HTTPS_ERRORS), value);
    }
});
(0, node_test_1.default)("project TLS absence removes stale handoff and preserves default behavior", () => {
    const env = (0, test_promoted_1.buildPromotedExecutionEnvWithConfig)({ APP_BASE_URL: "https://legacy.test", APP_IGNORE_HTTPS_ERRORS: "true" }, "generic-app", baseConfig);
    strict_1.default.equal(env.APP_IGNORE_HTTPS_ERRORS, undefined);
    strict_1.default.equal((0, playwright_config_1.resolvePromotedIgnoreHTTPSErrors)(env.APP_IGNORE_HTTPS_ERRORS), undefined);
});
(0, node_test_1.default)("strict Playwright TLS parsing preserves false and absence", () => {
    strict_1.default.equal((0, playwright_config_1.resolvePromotedIgnoreHTTPSErrors)("true"), true);
    strict_1.default.equal((0, playwright_config_1.resolvePromotedIgnoreHTTPSErrors)("false"), false);
    strict_1.default.equal((0, playwright_config_1.resolvePromotedIgnoreHTTPSErrors)(undefined), undefined);
    strict_1.default.equal((0, playwright_config_1.resolvePromotedIgnoreHTTPSErrors)("1"), undefined);
    strict_1.default.equal((0, playwright_config_1.resolvePromotedIgnoreHTTPSErrors)("yes"), undefined);
});
