import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolvePromotedFieldLocator } from "./promoted-spec-runtime";

test("promoted fills share Discovery's explicit verification digit identity across name variants", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [recorded, live] of [
      ["Please enter verification code. Digit 1", "OTP digit 1"],
      ["Código de verificación. Dígito 2", "Verification code digit 2"],
    ]) {
      await page.setContent(`<input aria-label="${live}"><input aria-label="OTP digit 6">`);
      const resolved = await resolvePromotedFieldLocator(page, `role:textbox|${recorded}`, {
        technicalTargetRefs: [`role:textbox|${recorded}`], timeoutMs: 200,
      });
      assert.ok(resolved);
      await resolved.locator.fill("4");
      assert.equal(await page.getByLabel(live, { exact: true }).inputValue(), "4");
      assert.equal(await page.getByLabel("OTP digit 6").inputValue(), "");
    }
    for (const html of [
      '<input aria-label="OTP digit 1"><input aria-label="OTP digit 1">',
      '<input aria-label="OTP digit 1" readonly>',
      '<input aria-label="OTP digit 10"><input aria-label="Document digit 1">',
    ]) {
      await page.setContent(html);
      assert.equal(await resolvePromotedFieldLocator(page, "role:textbox|Please enter verification code. Digit 1", { timeoutMs: 200 }), undefined);
    }
    await page.setContent('<form id="active"><input aria-label="OTP digit 1"></form><input aria-label="OTP digit 1">');
    const scoped = await resolvePromotedFieldLocator(page, "role:textbox|Please enter verification code. Digit 1", {
      containerLocator: "#active", timeoutMs: 200,
    });
    assert.ok(scoped);
    await scoped.locator.fill("7");
    assert.equal(await page.locator("#active input").inputValue(), "7");
    assert.equal(await page.locator("body > input").inputValue(), "");
    await page.setContent('<input id="recorded" aria-label="Unrelated name"><input aria-label="OTP digit 1">');
    const stable = await resolvePromotedFieldLocator(page, "OTP digit 1", { directRefs: ["css:#recorded"], timeoutMs: 200 });
    assert.ok(stable);
    assert.equal(await stable.locator.getAttribute("id"), "recorded");
    await page.setContent('<label>Name<input></label>');
    const ordinary = await resolvePromotedFieldLocator(page, "Name", { timeoutMs: 200 });
    assert.ok(ordinary);
    await ordinary.locator.fill("Example");
    assert.equal(await page.getByLabel("Name").inputValue(), "Example");
  } finally { await browser.close(); }
});
