import { defineConfig } from "@playwright/test";
import dotenv from "dotenv";

dotenv.config();

const headless = (process.env.HEADLESS ?? "false").toLowerCase() === "true";
const browser = process.env.BROWSER ?? "chromium";
const ignoreHTTPSErrors = process.env.APP_IGNORE_HTTPS_ERRORS === "true"
  ? true
  : process.env.APP_IGNORE_HTTPS_ERRORS === "false"
    ? false
    : undefined;

// Same runtime environment as playwright.config.apps.ts (baseURL, browser, timeouts, output
// locations), but with testMatch additionally scoped to the one pre-promotion candidate file
// name/location (`cases/<case>/spec-generation/candidate.spec.ts`), PLUS the exact temporary
// rebased-copy naming convention `prepareCandidateValidationCopy` (spec-generation-hybrid.ts)
// writes into the physical case directory (`cases/<case>/.candidate-validation-<pid>-<ts>.spec.ts`)
// -- the same convention playwright.config.ts's own broader "*.spec.ts" pattern already trusts
// for playwrightDiscovery. defaultRunFunctionalExecution must validate that SAME rebased copy,
// never the raw original (its generated imports assume the physical case directory, one level
// above where the raw file actually sits — see prepareCandidateValidationCopy's own docstring;
// job 851ec7ba-bebf-4e6f-a1bb-7f80a65758ff proved the raw file resolves zero tests even though
// discovery, which always validates the rebased copy, already proved it collectible).
// This intentionally does NOT loosen matching to spec-generation/** in general, nor to any
// other temp-file shape (the underlying invariant that arbitrary drafts must never enter the
// promoted runtime by directory traversal is preserved) — only these two exact, literal/scoped
// patterns are added on top of playwright.config.apps.ts's own patterns.
//
// Test-level timeout is intentionally NOT shared with DEFAULT_TIMEOUT_MS (used by
// playwright.config.ts/.apps.ts/.framework.ts for the steady-state promoted runtime). A
// candidate's one-off functional-execution run pays for a cold browser launch on top of the
// same business-step work the steady-state promoted contract already budgets DEFAULT_TIMEOUT_MS
// for. Job da808bb9-5856-4432-bde3-f4bb3e8525c6 proved a candidate can pass every required step
// and its final oracle, evidenced end-to-end, and still be killed by the outer test watchdog
// with no single stalled operation anywhere — the cumulative wall clock (cold launch + business
// steps) simply exceeded a budget sized only for the steady-state case. The headroom below
// matches ensureInitialNavigation's own goto timeout ceiling (promoted-spec-runtime.ts), the one
// real ceiling the architecture already trusts for that phase, rather than an unrelated
// arbitrary number. The formula is kept in sync with (and hermetically tested via)
// resolveCandidateFunctionalExecutionTimeoutMs in spec-generation-hybrid.ts — inlined here
// rather than imported, deliberately: Playwright's own config loader resolves this file's
// `require`s through plain Node module resolution, which prefers a stale compiled .js twin over
// the .ts source if one exists at that path (the exact hazard proven and fixed for
// promoted-spec-runtime.ts/evidence-recorder.ts in an earlier pass — see
// promoted-runtime-module-authority.test.ts). The steady-state promoted contract (the other
// three configs) keeps its original, tighter budget unchanged.
const CANDIDATE_NAVIGATION_HEADROOM_MS = 60000;
const candidateFunctionalExecutionTimeoutMs = process.env.CANDIDATE_FUNCTIONAL_EXECUTION_TIMEOUT_MS !== undefined
  ? Number(process.env.CANDIDATE_FUNCTIONAL_EXECUTION_TIMEOUT_MS)
  : Number(process.env.DEFAULT_TIMEOUT_MS ?? 30000) + CANDIDATE_NAVIGATION_HEADROOM_MS;

export default defineConfig({
  testDir: "./automations/apps",
  testMatch: [
    "**/cases/**/case.spec.ts",
    "**/cases/**/spec.ts",
    "**/cases/**/spec-generation/candidate.spec.ts",
    "**/cases/*/.candidate-validation-*.spec.ts",
  ],
  timeout: candidateFunctionalExecutionTimeoutMs,
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
