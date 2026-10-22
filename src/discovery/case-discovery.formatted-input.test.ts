import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveFillTarget } from "./target-resolver";
import { fillAndObserveRuntimeInput } from "./case-discovery";

test("discovery resolves repeated captions and verifies a value formatted on blur", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form id="form">
      <div><span>Amount</span></div>
      <div><span>Amount</span><input id="amount" value="0.00"
        onblur="this.value = Number(this.value).toFixed(2)"></div>
      <div><label for="memo">Memo</label><input id="memo"></div>
    </form>`);
    const target = await resolveFillTarget(page, { elements: [] } as any, "Amount", undefined, { associatedField: "Amount" });
    assert.equal(target.status, "resolved");
    assert.ok(target.locator);
    await fillAndObserveRuntimeInput({ page, locator: target.locator, value: "10", stepIndex: 16 });
    assert.equal(await page.locator("#amount").inputValue(), "10.00");
    assert.equal(await page.locator("#memo").inputValue(), "");
  } finally {
    await browser.close();
  }
});

test("runtime fill handles native controls and an observed comma-decimal mask", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const fixture of [
      { html: '<input id="editor" type="number" step="0.01" onblur="this.value = Number(this.value).toFixed(2)">', value: "10", actual: "10.00" },
      { html: `<input id="editor" value="0,00" onblur="this.value = Number(this.value.replace(',', '.')).toFixed(2).replace('.', ',')">`, value: "12.5", actual: "12,50" },
      { html: '<input id="editor" type="text">', value: "Reference ABC", actual: "Reference ABC" },
      { html: '<input id="editor" type="tel">', value: "001234", actual: "001234" },
      { html: '<input id="editor" autocomplete="one-time-code" inputmode="numeric">', value: "001234", actual: "001234" },
      { html: '<input id="editor" type="date">', value: "2026-10-21", actual: "2026-10-21" },
      { html: '<textarea id="editor"></textarea>', value: "Longer note", actual: "Longer note" },
      { html: '<div id="editor" contenteditable="true"></div>', value: "Editable note", actual: "Editable note" },
    ]) {
      await page.setContent(fixture.html);
      const locator = page.locator("#editor");
      await fillAndObserveRuntimeInput({ page, locator, value: fixture.value, stepIndex: 1 });
      assert.equal(await locator.evaluate((el) => "value" in el ? String((el as HTMLInputElement).value) : el.textContent), fixture.actual);
    }
  } finally {
    await browser.close();
  }
});

test("runtime fill rejects changed amounts and decimal reformatting of OTPs or passwords", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const html of [
      '<input id="editor" type="number" onblur="this.value = String(Number(this.value) + 1)">',
      '<input id="editor" value="0.00" autocomplete="one-time-code" onblur="this.value = Number(this.value).toFixed(2)">',
      '<input id="editor" type="password" value="0.00" onblur="this.value = Number(this.value).toFixed(2)">',
    ]) {
      await page.setContent(html);
      await assert.rejects(fillAndObserveRuntimeInput({ page, locator: page.locator("#editor"), value: "10", stepIndex: 1 }), /runtime_fill_value_mismatch/);
    }
  } finally {
    await browser.close();
  }
});
