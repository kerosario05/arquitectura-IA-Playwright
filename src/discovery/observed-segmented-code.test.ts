import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { observeSegmentedCodeEvidence } from "./observed-segmented-code";
import { attemptSegmentedInputFill } from "./target-resolver";

const slots = (name: string, count = 6) => Array.from({ length: count }, (_, index) =>
  `<input type="text" name="${name}" tabindex="${index + 1}" maxlength="1">`).join("");

test("observed ordered code group survives plan serialization and uses existing segmented runtime", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [scope, name] of [["identity-form", "ctoken[]"], ["verification-panel", "verification[]"]]) {
      await page.setContent(`<form id="${scope}"><p>Enter verification code</p>${slots(name)}<input type="submit"></form>`);
      const observed = await observeSegmentedCodeEvidence(page);
      assert.equal(observed?.kind, "segmented_input");
      assert.equal(observed?.segmentCount, 6);
      const transported = JSON.parse(JSON.stringify({ action: "fill", valueKey: "auth.otp", playwrightRecorderEvidence: observed }));
      assert.equal(JSON.stringify(transported).includes("654321"), false);
      assert.equal((await attemptSegmentedInputFill(page, transported.playwrightRecorderEvidence, "654321")).ok, true);
      assert.deepEqual(await page.locator('input[type="text"]').evaluateAll(elements => elements.map(el => (el as HTMLInputElement).value)), ["6", "5", "4", "3", "2", "1"]);
      assert.equal((await attemptSegmentedInputFill(page, observed, "123")).ok, false);
    }
    await page.setContent(`<form id="a">${slots("a")}</form><form id="b">${slots("b")}</form>`);
    assert.equal(await observeSegmentedCodeEvidence(page), undefined, "two groups cannot be selected implicitly");
    await page.setContent(`<form id="a">${slots("a").replace('tabindex="3"', 'tabindex="2"')}</form>`);
    assert.equal(await observeSegmentedCodeEvidence(page), undefined, "duplicate positions are rejected");
    await page.setContent(`<form id="a">${slots("a").replace('tabindex="3"', 'readonly tabindex="3"')}</form>`);
    assert.equal(await observeSegmentedCodeEvidence(page), undefined, "incomplete writable sequence is rejected");
    await page.setContent('<form id="normal"><input name="document" tabindex="1"></form>');
    assert.equal(await observeSegmentedCodeEvidence(page), undefined, "ordinary field stays ordinary");
  } finally { await browser.close(); }
});
