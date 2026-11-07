import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

test("file upload capture resolves a file input retargeted through an open shadow root", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const messages: any[] = [];
    await page.exposeBinding("__qaRecordFileUpload", (_source, message) => { messages.push(message); });
    await page.evaluate(buildCaptureScriptV2Content("file-upload-shadow-fixture"));
    await page.evaluate(() => {
      const host = document.createElement("file-picker-fixture");
      const shadow = host.attachShadow({ mode: "open" });
      const input = document.createElement("input");
      input.type = "file";
      input.setAttribute("aria-label", "Documento");
      shadow.append(input);
      document.body.append(host);
    });
    // Playwright's setInputFiles dispatches a synthetic change event; the recorder
    // only accepts that path when it explicitly owns file delivery.
    await page.evaluate(() => { (window as Window & { __qaRecorderV2FileDelivery?: boolean }).__qaRecorderV2FileDelivery = true; });
    await page.locator('input[type="file"]').setInputFiles({
      name: "documento.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("fixture"),
    });
    await page.evaluate(() => {
      const input = document.querySelector("file-picker-fixture")?.shadowRoot?.querySelector('input[type="file"]');
      input?.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      input?.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    await page.evaluate(() => { (window as Window & { __qaRecorderV2FileDelivery?: boolean }).__qaRecorderV2FileDelivery = false; });
    await page.evaluate(async () => {
      await (window as Window & { __qaRecorderV2Flush?: () => Promise<void> }).__qaRecorderV2Flush?.();
    });

    assert.equal(messages[0]?.phase, "group_start");
    assert.equal(messages[0]?.target?.inputType, "file");
    assert.equal(messages.at(-1)?.phase, "group_end");
    assert.equal(messages.filter((message) => message.phase === "group_start").length, 1);
  } finally {
    await browser.close();
  }
});

