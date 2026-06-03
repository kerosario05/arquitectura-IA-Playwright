"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const headless = (process.env.HEADLESS ?? "false").toLowerCase() === "true";
const browser = process.env.BROWSER ?? "chromium";
exports.default = (0, test_1.defineConfig)({
    testDir: ".",
    testMatch: [
        "automations/apps/**/cases/**/*.spec.ts",
        "automations/apps/**/cases/**/spec.ts",
        "tests/**/*.spec.ts"
    ],
    testIgnore: [
        "node_modules/**",
        ".artifacts/**",
        ".tmp*/**",
        ".tmp-*/**"
    ],
    timeout: Number(process.env.DEFAULT_TIMEOUT_MS ?? 30000),
    outputDir: "test-results",
    reporter: [["list"], ["html", { open: "never" }]],
    use: {
        baseURL: process.env.APP_BASE_URL,
        browserName: browser === "firefox" || browser === "webkit" ? browser : "chromium",
        headless,
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        trace: "retain-on-failure"
    }
});
