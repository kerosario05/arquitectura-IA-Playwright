import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { coerceToEditableFillTarget, fillAndObserveRuntimeInput } from "./case-discovery";

async function withPage(html: string, run: (page: import("playwright").Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await run(page);
  } finally {
    await browser.close();
  }
}

test("a field wrapper resolves to its single editable control", async () => {
  await withPage('<div id="w"><label>Puesto</label><input id="i" type="text"></div>', async (page) => {
    const target = await coerceToEditableFillTarget(page.locator("#w"));
    assert.equal(await target.getAttribute("id"), "i");
    await target.fill("QA");
    assert.equal(await page.locator("#i").inputValue(), "QA");
  });
});

test("an already editable element is returned untouched", async () => {
  await withPage('<div><input id="a"><input id="b"></div>', async (page) => {
    const input = page.locator("#a");
    assert.equal(await coerceToEditableFillTarget(input), input);
  });
});

test("a wrapper with several editable controls stays ambiguous", async () => {
  await withPage('<div id="w"><input id="a"><textarea id="b"></textarea></div>', async (page) => {
    const wrapper = page.locator("#w");
    assert.equal(await coerceToEditableFillTarget(wrapper), wrapper);
  });
});

test("a wrapper without editable controls is returned untouched", async () => {
  await withPage('<div id="w"><input type="hidden" id="h"><input type="checkbox" id="c"></div>', async (page) => {
    const wrapper = page.locator("#w");
    assert.equal(await coerceToEditableFillTarget(wrapper), wrapper);
  });
});

test("a committed grid editor that disappears does not delay the post-fill inspection", async () => {
  await withPage(`<div id="cell"><input id="editor" onblur="this.parentElement.textContent=this.value"></div>`, async (page) => {
    page.setDefaultTimeout(1500);
    const editor = page.locator("#editor");
    const cell = page.locator("#cell");
    await fillAndObserveRuntimeInput({ page, locator: editor, verificationLocator: cell, value: "Analista", stepIndex: 1 });
    assert.equal(await cell.innerText(), "Analista");
    assert.equal(await editor.count(), 0);
    const start = Date.now();
    assert.equal(await coerceToEditableFillTarget(editor, { timeoutMs: 300 }), editor);
    assert.ok(Date.now() - start < 1000, "an absent editor must not consume the page's full timeout");
  });
});
