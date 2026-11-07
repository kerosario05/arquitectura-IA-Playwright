import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

// A triple click selects "SOL-…\n" and widens the range past the <dd>; the copied value must still be linked to it.
test("copying a block's text with a triple click still reports the value source and a newline-free paste", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 400 } });
    const transfers: Array<{ phase: string; text: string; owner?: { id?: string } }> = [];
    await context.exposeBinding("__qaRecordValueTransfer", (_source, message) => { transfers.push(message); });
    await context.addInitScript(buildCaptureScriptV2Content("value-transfer-test"));
    const page = await context.newPage();
    // goto (not setContent): document.open() would discard the listeners installed by the init script.
    await page.goto(`data:text/html,${encodeURIComponent('<dl><dt>Numero</dt><dd id="numero-solicitud">SOL-2026-0007</dd></dl><input id="buscar" aria-label="Buscar">')}`);
    const cdp = await context.newCDPSession(page);
    const box = (await page.locator("#numero-solicitud").boundingBox())!;
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await cdp.send("Input.dispatchMouseEvent", { type, x: box.x + 10, y: box.y + 5, button: "left", clickCount: 3 } as never);
    }
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, modifiers: 2, commands: ["copy"] } as never);
    await page.focus("#buscar");
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "v", code: "KeyV", windowsVirtualKeyCode: 86, modifiers: 2, commands: ["paste"] } as never);
    await page.waitForTimeout(300);
    const copy = transfers.find((item) => item.phase === "copy");
    const paste = transfers.find((item) => item.phase === "paste");
    assert.equal(copy?.text, "SOL-2026-0007");
    assert.equal(copy?.owner?.id, "numero-solicitud");
    assert.equal(paste?.text, "SOL-2026-0007");
  } finally {
    await browser.close();
  }
});
