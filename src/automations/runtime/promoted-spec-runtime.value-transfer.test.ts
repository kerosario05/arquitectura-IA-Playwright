import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { PromotedSpecRuntime } from "./promoted-spec-runtime";

test("mock: promoted replay captures a copied request ID from its source tab after switching to Bizagi", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const portalTab = await context.newPage();
    await portalTab.setContent('<label for="request-id">Solicitud</label><input id="request-id" value="MPN-3239">');
    const bizagiTab = await context.newPage();
    await bizagiTab.setContent('<label for="search">Buscar solicitud</label><input id="search">');

    const runtime = new PromotedSpecRuntime(portalTab, { enabled: false, evidenceEnabled: false });
    await runtime.selectRecordedPage("tab-2", true);

    await runtime.captureRecordedApplicationValue({
      sourceEventRef: "event-7",
      sourcePageKey: "tab-1",
      technicalTargetRefs: ["css:#request-id"],
      valueSelection: { sourceKind: "input", startOffset: 0, endOffset: 8, endAtSourceEnd: false },
    } as any);

    const copiedRequestId = runtime.resolveCapturedApplicationValue("event-7");
    await bizagiTab.locator("#search").fill(copiedRequestId);
    assert.equal(await bizagiTab.locator("#search").inputValue(), "MPN-3239");
    assert.equal(runtime.getCurrentPage(), bizagiTab);
  } finally {
    await browser.close();
  }
});
