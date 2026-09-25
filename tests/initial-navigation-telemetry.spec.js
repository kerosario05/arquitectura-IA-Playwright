"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = require("node:assert");
const node_test_1 = __importDefault(require("node:test"));
const case_discovery_1 = require("../src/discovery/case-discovery");
(0, node_test_1.default)("initial navigation telemetry keeps only a safe pathname", () => {
    node_assert_1.strict.equal((0, case_discovery_1.safePathname)("https://example.test/login?token=secret#top"), "/login");
    node_assert_1.strict.equal((0, case_discovery_1.safePathname)("/dashboard?session=secret", "https://example.test/login"), "/dashboard");
});
(0, node_test_1.default)("initial navigation telemetry preserves the original error safely", () => {
    const error = Object.assign(new Error("navigation failed at https://example.test/login?token=secret"), {
        code: "ERR_CERT_AUTHORITY_INVALID"
    });
    const details = (0, case_discovery_1.describeInitialNavigationError)(error);
    node_assert_1.strict.equal(details.errorType, "Error");
    node_assert_1.strict.equal(details.errorCode, "ERR_CERT_AUTHORITY_INVALID");
    node_assert_1.strict.equal(details.errorMessageSafe.includes("token=secret"), false);
    node_assert_1.strict.equal(details.errorMessageSafe.includes("<url>"), true);
});
