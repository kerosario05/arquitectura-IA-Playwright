"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const browser_profile_1 = require("./browser-profile");
const browser_session_1 = require("./browser-session");
(0, node_test_1.default)("resolves a configurable persistent profile without using the user profile", () => {
    strict_1.default.equal((0, browser_profile_1.resolveQaBrowserProfilePath)(".qa/browser", "C:/workspace"), "C:\\workspace\\.qa\\browser");
});
(0, node_test_1.default)("defaults to an ephemeral context when no persistent profile is configured", () => {
    strict_1.default.equal((0, browser_profile_1.resolveQaBrowserProfilePath)(undefined, "C:/workspace"), undefined);
    strict_1.default.equal((0, browser_profile_1.resolveQaBrowserProfilePath)("", "C:/workspace"), undefined);
    strict_1.default.equal((0, browser_profile_1.resolveQaBrowserProfilePath)("   ", "C:/workspace"), undefined);
});
(0, node_test_1.default)("runtime context options block stale service workers by default", () => {
    const options = (0, browser_session_1.buildRuntimeContextOptions)({ ignoreHTTPSErrors: true });
    strict_1.default.equal(options.serviceWorkers, "block");
    strict_1.default.equal(options.ignoreHTTPSErrors, true);
});
(0, node_test_1.default)("runtime context options preserve an explicit service worker policy", () => {
    const options = (0, browser_session_1.buildRuntimeContextOptions)({ serviceWorkers: "allow" });
    strict_1.default.equal(options.serviceWorkers, "allow");
});
