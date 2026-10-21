import { defineConfig } from "@playwright/test";
import apps from "./playwright.config.apps";

// Selected only for a Jira spec inside a QA Lab job. Recording keeps apps config.
export default defineConfig({
  ...apps,
  // QA Lab executes an ephemeral instrumented copy for Jira evidence. Keep the
  // normal promoted-spec allowlist and explicitly admit only that copy name.
  testMatch: [
    "**/cases/**/case.spec.ts",
    "**/cases/**/spec.ts",
    "**/cases/**/case.jira-reuse-*.spec.ts",
  ],
  use: { ...apps.use, screenshot: "on" },
  reporter: [["list"], ["./src/jira/jira-reuse-evidence-reporter.ts"]],
});
