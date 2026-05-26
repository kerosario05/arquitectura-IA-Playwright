import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

const headless = (process.env.HEADLESS ?? "false").toLowerCase() === "true";
const browser = process.env.BROWSER ?? "chromium";

export default defineConfig({
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