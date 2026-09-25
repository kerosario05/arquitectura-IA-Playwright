import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

// Headless by default: a server has no desktop, and a visible window there would
// launch into nothing. Local setups that want to watch set HEADLESS=false.
const headless = (process.env.HEADLESS ?? "true").toLowerCase() !== "false";
const browser = process.env.BROWSER ?? "chromium";

export default defineConfig({
  testDir: "./tests",
  testIgnore: "tests/generated/**",
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
