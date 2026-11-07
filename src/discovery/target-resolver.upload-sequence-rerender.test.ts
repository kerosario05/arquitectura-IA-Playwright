import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveSequencedSiblingForRoleRef } from "./target-resolver";

test("a completed upload advances to the next row after the controls rerender", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const rows = '<div id="rows">' + [0, 1, 2].map(i => `<div><button data-row="${i}">Cargar</button></div>`).join("") + '</div>';
    await page.setContent(rows);
    const pick = async () => {
      const result = await resolveSequencedSiblingForRoleRef(page, "role:button|Cargar");
      assert.equal(result?.status, "resolved");
      return result!.locator!;
    };
    assert.equal(await (await pick()).getAttribute("data-row"), "0");
    await page.evaluate(() => { (window as any).__codexUploadSequence = 1; });
    assert.equal(await (await pick()).getAttribute("data-row"), "0");
    await page.evaluate(() => {
      const container = document.querySelector("#rows")!;
      container.innerHTML = container.innerHTML.replace(/ data-codex-[^=]+="[^"]*"/g, "");
    });
    assert.equal(await (await pick()).getAttribute("data-row"), "1");
  } finally { await browser.close(); }
});
