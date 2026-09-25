import assert from "node:assert";
import test from "node:test";
import type { Page } from "@playwright/test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

/**
 * Minimal Page double covering only what ensureInitialNavigation touches: url(), goto(),
 * waitForLoadState(), and waitForTimeout(). page.on() is a no-op sink because the constructor
 * attaches auth-boundary listeners unconditionally.
 */
function createMockPage(initialUrl: string) {
  const calls: string[] = [];
  let currentUrl = initialUrl;
  const page = {
    url: () => currentUrl,
    goto: async (url: string) => {
      calls.push(`goto:${url}`);
      currentUrl = url;
    },
    waitForLoadState: async (state: string) => {
      calls.push(`waitForLoadState:${state}`);
    },
    waitForTimeout: async () => {
      calls.push("waitForTimeout");
    },
    isClosed: () => false,
    on: () => undefined,
  };
  return { page: page as unknown as Page, calls };
}

test("promoted runtime initial navigation boundary (initial_readiness_failure fix)", async (t) => {
  const originalBaseUrl = process.env.APP_BASE_URL;
  const originalEvidence = process.env.EVIDENCE_ENABLED;
  process.env.EVIDENCE_ENABLED = "false";

  t.after(() => {
    if (originalBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalBaseUrl;
    if (originalEvidence === undefined) delete process.env.EVIDENCE_ENABLED;
    else process.env.EVIDENCE_ENABLED = originalEvidence;
  });

  await t.test("1. navigates to the application surface before first business action when the page starts blank", async () => {
    process.env.APP_BASE_URL = "https://example.test/app";
    const { page, calls } = createMockPage("about:blank");
    const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false });
    await (runtime as any).ensureInitialNavigation();
    assert.ok(calls.includes("goto:https://example.test/app"), "must navigate to APP_BASE_URL before Step 1");
  });

  await t.test("2. start URL is sourced from runtime authority (APP_BASE_URL), never hardcoded", async () => {
    process.env.APP_BASE_URL = "https://another-host.test/kiosk";
    const { page, calls } = createMockPage("about:blank");
    const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false });
    await (runtime as any).ensureInitialNavigation();
    assert.ok(calls.includes("goto:https://another-host.test/kiosk"), "navigation target must track APP_BASE_URL, not a literal");
  });

  await t.test("3. initial readiness runs after navigation, not before", async () => {
    process.env.APP_BASE_URL = "https://example.test/app";
    const { page, calls } = createMockPage("about:blank");
    const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false });
    await (runtime as any).ensureInitialNavigation();
    const gotoIndex = calls.indexOf("goto:https://example.test/app");
    const readinessIndex = calls.findIndex((c) => c.startsWith("waitForLoadState"));
    assert.ok(gotoIndex >= 0, "navigation must have occurred");
    assert.ok(readinessIndex > gotoIndex, "readiness must be evaluated after navigation completes");
  });

  await t.test("4. does not navigate again when the page is already on the application surface", async () => {
    process.env.APP_BASE_URL = "https://example.test/app";
    const { page, calls } = createMockPage("https://example.test/app/some/deep/path");
    const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false });
    await (runtime as any).ensureInitialNavigation();
    assert.ok(!calls.some((c) => c.startsWith("goto:")), "must not redundantly navigate when already on the app origin");
  });

  await t.test("5. missing APP_BASE_URL on a blank page fails closed as initial_readiness_failure, not a hardcoded fallback", async () => {
    delete process.env.APP_BASE_URL;
    const { page } = createMockPage("about:blank");
    const runtime = new PromotedSpecRuntime(page, { evidenceEnabled: false });
    await assert.rejects(() => (runtime as any).ensureInitialNavigation(), /initial_readiness_failure/);
  });
});
