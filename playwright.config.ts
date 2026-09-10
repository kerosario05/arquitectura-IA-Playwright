import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

const headless = (process.env.HEADLESS ?? "false").toLowerCase() === "true";
const browser = process.env.BROWSER ?? "chromium";

export function resolvePromotedIgnoreHTTPSErrors(value: string | undefined): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

const ignoreHTTPSErrors = resolvePromotedIgnoreHTTPSErrors(process.env.APP_IGNORE_HTTPS_ERRORS);

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
    ...(ignoreHTTPSErrors === undefined ? {} : { ignoreHTTPSErrors }),
    browserName: browser === "firefox" || browser === "webkit" ? browser : "chromium",
    headless,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure"
  }
});
