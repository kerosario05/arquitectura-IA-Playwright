import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

// Headless by default: a server has no desktop, and a visible window there would
// launch into nothing. Local setups that want to watch set HEADLESS=false.
const headless = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";
const browser = process.env.BROWSER ?? "chromium";
const ignoreHTTPSErrors = process.env.APP_IGNORE_HTTPS_ERRORS === "true"
  ? true
  : process.env.APP_IGNORE_HTTPS_ERRORS === "false"
    ? false
    : undefined;

export default defineConfig({
  testDir: "./automations/apps",
  // Only physical promoted specs are executable. Discovery candidates and
  // generated drafts live below spec-generation/ and must never enter the
  // promoted runtime by directory traversal.
  testMatch: ["**/cases/**/case.spec.ts", "**/cases/**/spec.ts"],
  timeout: Number(process.env.DEFAULT_TIMEOUT_MS ?? 30000),
  outputDir: "test-results/apps",
  reporter: [["list"], ["html", { open: "never" }]],
  reportSlowTests: null,
  use: {
    baseURL: process.env.APP_BASE_URL,
    ...(ignoreHTTPSErrors === undefined ? {} : { ignoreHTTPSErrors }),
    browserName: browser === "firefox" || browser === "webkit" ? browser : "chromium",
    headless,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure"
  }
});
