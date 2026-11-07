import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { resolveSemanticRuntimeTarget } from "./target-resolver";

const question = (guid: string, name: string, title: string) => `
<div class="render"><span><label id="label-${guid}">${title}</label></span>
<div><div class="ui-radio"><input type="radio" id="${name}yes" name="${name}" style="display:none"><label for="${name}yes"> Si </label></div>
<div class="ui-radio"><input type="radio" id="${name}no" name="${name}" style="display:none"><label for="${name}no"> No </label></div></div></div>`;

test("a :has(identity) scope matching nested ancestors resolves to the innermost wrapper, not an ambiguous page-wide label", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<div><div>${question("g1", "r1", "Q1")}${question("g2", "r2", "Q2")}${question("g3", "r3", "Q3")}</div></div>`);
    const resolved = await resolveSemanticRuntimeTarget(page, {
      source: "accessible_name",
      normalizedValue: "No",
      targetTag: "label",
      captureUniqueTarget: true,
      scopeAlternatives: [
        { scopeIdentity: { strategy: "css", value: 'div:has(input[id="gone-generated-id"])' }, captureMatchCount: 1 },
        { scopeIdentity: { strategy: "css", value: 'div:has(label[id="label-g2"])' }, captureMatchCount: 1 },
      ],
    } as never);
    assert.ok(resolved, "target must resolve");
    await resolved.locator.click();
    assert.equal(await page.locator("#r2no").isChecked(), true);
    assert.equal(await page.locator("#r1no").isChecked(), false);
    assert.equal(await page.locator("#r3no").isChecked(), false);
  } finally {
    await browser.close();
  }
});
