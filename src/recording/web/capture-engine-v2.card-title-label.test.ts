import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

/**
 * Several sibling cards show the same price, so a click on the price cannot say which card was chosen. The capture
 * must name the click by the card's own unique title, as a click on that title would have been recorded.
 */
const page = `
<div class="cards">
  <div class="card" id="humano"><p>PRESTAMO CONSUMO HUMANO</p><div class="price">RD$222.72</div></div>
  <div class="card" id="mapfre"><p>PRESTAMO CONSUMO MAPFRE</p><div class="price">RD$222.72</div></div>
  <div class="card" id="otro"><p>PRESTAMO CONSUMO OTRO</p><div class="price">RD$310.00</div></div>
</div>
<div id="solo"><span>Total</span><div class="amount">RD$50,000.00</div></div>`;

async function captureClick(selector: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const tab = await context.newPage();
    const messages: unknown[] = [];
    await tab.exposeFunction("__qaRecordV2", (message: unknown) => { messages.push(message); });
    await tab.addInitScript(buildCaptureScriptV2Content("test-capture"));
    await tab.route("http://cards.test/", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: page }));
    await tab.goto("http://cards.test/");
    await tab.locator(selector).click();
    await tab.waitForTimeout(500);
    assert.ok(messages.length > 0, "capture script produced no messages");
    return JSON.stringify(messages);
  } finally {
    await browser.close();
  }
}

test("a click on a price repeated across cards is named by that card's own title", async () => {
  const humano = await captureClick("#humano .price");
  assert.match(humano, /"accessibleName":"PRESTAMO CONSUMO HUMANO"/);
  assert.doesNotMatch(humano, /"accessibleName":"RD\$222\.72"/);
  const mapfre = await captureClick("#mapfre .price");
  assert.match(mapfre, /"accessibleName":"PRESTAMO CONSUMO MAPFRE"/);
});

test("a click straight on a card's unique title marks that title as the chosen item's identity", async () => {
  const humano = await captureClick("#humano p");
  assert.match(humano, /"accessibleName":"PRESTAMO CONSUMO HUMANO"/);
  assert.match(humano, /"promotedTitle":true/);
});

test("sibling cards whose classes differ (carousel first/last/active state) still count as sibling items", async () => {
  const carousel = `
  <div class="track">
    <div class="item item-start item-active"><p>SEGURO UNO</p><div><span>RD$100.00</span></div></div>
    <div class="item item-active"><p>SEGURO DOS</p><div><span>RD$100.00</span></div></div>
    <div class="item item-end"><p>SEGURO TRES</p><div><span>RD$120.00</span></div></div>
  </div>`;
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    const tab = await context.newPage();
    const messages: unknown[] = [];
    await tab.exposeFunction("__qaRecordV2", (message: unknown) => { messages.push(message); });
    await tab.addInitScript(buildCaptureScriptV2Content("test-capture"));
    await tab.route("http://carousel.test/", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: carousel }));
    await tab.goto("http://carousel.test/");
    await tab.locator(".item-active p").first().click();
    await tab.waitForTimeout(500);
    const json = JSON.stringify(messages);
    assert.match(json, /"accessibleName":"SEGURO UNO"/);
    assert.match(json, /"promotedTitle":true/);
  } finally {
    await browser.close();
  }
});

test("a unique text outside any group of sibling items is not marked", async () => {
  const solo = await captureClick("#solo span");
  assert.doesNotMatch(solo, /"promotedTitle":true/);
});

test("a price that is unique on the page keeps its own text", async () => {
  const solo = await captureClick("#solo .amount");
  assert.doesNotMatch(solo, /"accessibleName":"Total"/);
});
