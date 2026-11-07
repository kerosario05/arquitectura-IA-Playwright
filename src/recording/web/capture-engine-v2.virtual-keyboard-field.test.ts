import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { buildCaptureScriptV2Content } from "./capture-engine-v2.browser-instrumentation";

async function capture(html: string): Promise<string> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const messages: unknown[] = [];
    await page.exposeFunction("__qaRecordV2", (message: unknown) => messages.push(message));
    await page.addInitScript(buildCaptureScriptV2Content("keyboard-fixture"));
    await page.route("https://fixture.test/", (route) => route.fulfill({ contentType: "text/html; charset=utf-8", body: html }));
    await page.goto("https://fixture.test/");
    await page.locator("#key-4").click();
    await page.waitForTimeout(300);
    return JSON.stringify(messages);
  } finally { await browser.close(); }
}

const keypad = `<div id="keyboard">${Array.from("0123456789", (digit) => `<button id="key-${digit}">${digit}</button>`).join("")}</div>`;

test("a detected keypad carries the explicit label of its unique receiver", async () => {
  const messages = await capture(`<div><label for="identifier">Número de identificación</label><input id="identifier" readonly>${keypad}</div>`);
  assert.match(messages, /"kind":"virtual_keyboard"/);
  assert.match(messages, /"fieldLabel":"Número de identificación"/);
});

test("a keyboard with multiple receivers does not borrow a shared heading", async () => {
  const messages = await capture(`<div><h2>Datos</h2><label for="a">Identificación</label><input id="a"><label for="b">Monto</label><input id="b">${keypad}</div>`);
  assert.match(messages, /"kind":"virtual_keyboard"/);
  assert.doesNotMatch(messages, /"fieldLabel":/);
});

test("a normal numeric button does not create virtual keyboard metadata", async () => {
  const messages = await capture('<label for="a">Cantidad</label><input id="a"><button id="key-4">4</button>');
  assert.doesNotMatch(messages, /"kind":"virtual_keyboard"/);
});
