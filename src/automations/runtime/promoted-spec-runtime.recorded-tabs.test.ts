import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

test("recorded page selection reuses observed tabs and creates a tab only with trace authority", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const firstPage = await context.newPage();
    const observedPopup = await context.newPage();
    const runtime = new PromotedSpecRuntime(firstPage, { enabled: false, evidenceEnabled: false });

    assert.equal(await runtime.selectRecordedPage("tab-1", false), firstPage);
    assert.equal(await runtime.selectRecordedPage("tab-2", true), observedPopup);
    assert.equal(runtime.getCurrentPage(), observedPopup);
    assert.equal(await runtime.selectRecordedPage("tab-2", false), observedPopup);
    assert.equal(await runtime.selectRecordedPage("tab-1", false), firstPage);
    assert.equal(runtime.getCurrentPage(), firstPage);

    const created = await runtime.selectRecordedPage("tab-3", true);
    assert.ok(created !== firstPage && created !== observedPopup);
    assert.equal(created.context(), context);
    assert.equal(runtime.currentPageUrl(), "about:blank");

    await assert.rejects(runtime.selectRecordedPage("tab-4", false), /RECORDED_TAB_NOT_AVAILABLE/);
    await assert.rejects(runtime.selectRecordedPage("invalid-key", true), /RECORDED_TAB_KEY_INVALID/);
  } finally {
    await browser.close();
  }
});
