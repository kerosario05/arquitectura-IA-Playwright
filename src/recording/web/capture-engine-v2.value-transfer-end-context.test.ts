import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

async function copySelection(html: string, selectorToSelect: string, start: number, end: number, phase = "copy") {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 800, height: 400 } });
    const transfers: Array<{ phase: string; text: string; owner?: unknown; selection?: Record<string, unknown> }> = [];
    await context.exposeBinding("__qaRecordValueTransfer", (_source, message) => { transfers.push(message); });
    await context.addInitScript(buildCaptureScriptV2Content("value-transfer-end-context"));
    const page = await context.newPage();
    await page.goto(`data:text/html,${encodeURIComponent(html)}`);
    await page.evaluate(({ selector, from, to }) => {
      const node = document.querySelector(selector)!.firstChild!;
      window.getSelection()!.setBaseAndExtent(node, from, node, to);
    }, { selector: selectorToSelect, from: start, to: end });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, modifiers: 2, commands: ["copy"] } as never);
    await page.waitForTimeout(300);
    return transfers.find((item) => item.phase === phase);
  } finally {
    await browser.close();
  }
}

test("copying text that has no stable owner still tells the recorder a selection happened", async () => {
  // Deeper than the structural path limit and with no id anywhere: nothing can identify the element.
  const deep = "<div>".repeat(18) + "<span>MPN-3319</span>" + "</div>".repeat(18);
  const copy = await copySelection(deep, "span", 0, 8);
  assert.equal(copy, undefined, "no linkable value source without a stable owner");
  const seen = await copySelection(deep, "span", 0, 8, "copy_seen");
  assert.equal(seen?.phase, "copy_seen");
});

test("copy followed by stable text records it as the end anchor", async () => {
  const copy = await copySelection('<h1 id="titulo">MPN-3319 - Editar</h1>', "#titulo", 0, 8);
  assert.equal(copy?.text, "MPN-3319");
  assert.equal(copy?.selection?.endAtSourceEnd, false);
  assert.equal(copy?.selection?.endContext, " - Editar");
});

test("the anchor stops before the first digit and is absent when the value ends the text", async () => {
  const volatile = await copySelection('<p id="linea">MPN-3319 creada 4/11/2026</p>', "#linea", 0, 8);
  assert.equal(volatile?.selection?.endContext, " creada ");
  const atEnd = await copySelection('<p id="linea">Solicitud MPN-3319</p>', "#linea", 10, 18);
  assert.equal(atEnd?.selection?.endAtSourceEnd, true);
  assert.equal(atEnd?.selection?.endContext, undefined);
});

test("text with no stable id anywhere is identified by a structural path and a value shape", async () => {
  const html = "<main><section><div><p>Solicitud</p></div><div><span>MPN-3319</span></div></section></main>";
  const copy = await copySelection(html, "span", 0, 8) as undefined | { owner?: { structuralPath?: string; locatorMatchCounts?: Record<string, number> }; selection?: Record<string, unknown> };
  assert.ok(copy?.owner?.structuralPath, "a structural path is reported");
  assert.equal(copy?.owner?.locatorMatchCounts?.structuralPath, 1);
  assert.match(copy!.owner!.structuralPath!, /^body > /);
  assert.equal(copy?.selection?.valueShape, "^MPN\\-\\d+$");
});

test("replay: a source identified only by its structural path yields each run's own value and refuses another kind of text", async () => {
  const { captureRecordedApplicationValue } = await import("../recorded-runtime-actions");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const capture = {
      sourceEventRef: "event-1", technicalTargetRefs: ["css:body > main > section > div:nth-of-type(2) > span"],
      valueSelection: { sourceKind: "text" as const, startOffset: 0, endOffset: 8, endAtSourceEnd: true, valueShape: "^MPN\\-\\d+$" },
    };
    const layout = (value: string) => `<main><section><div><p>Solicitud</p></div><div><span>${value}</span></div></section></main>`;
    await page.setContent(layout("MPN-3319"));
    assert.equal(await captureRecordedApplicationValue(page, capture as never), "MPN-3319");
    await page.setContent(layout("MPN-10000"));
    assert.equal(await captureRecordedApplicationValue(page, capture as never), "MPN-10000");
    await page.setContent(layout("Pendiente"));
    await assert.rejects(() => captureRecordedApplicationValue(page, capture as never), /RECORDED_VALUE_SHAPE_MISMATCH|RECORDED_VALUE_SELECTION_INVALID/);
    await page.setContent("<main><section><div><p>Solicitud</p></div></section></main>");
    await assert.rejects(() => captureRecordedApplicationValue(page, capture as never), /RECORDED_TARGET_NOT_FOUND/);
  } finally {
    await browser.close();
  }
});
