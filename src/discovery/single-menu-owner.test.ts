import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { resolveSingleMenuOwner } from "./single-menu-owner";

test("nested link and menuitem are one owner, independent duplicate text stays ambiguous", async () => {
 const browser = await chromium.launch();
 try {
 const page = await browser.newPage();
 for (const name of ["Casa", "Home"]) {
 await page.setContent(`<ul role="menu"><li role="menuitem" aria-label="${name}"><div><a><span>${name}</span></a></div></li></ul>`);
 assert.ok(await resolveSingleMenuOwner(page, name));
 await page.locator('body').evaluate((el, name) => { const other = document.createElement('button'); other.textContent = name; el.append(other); }, name);
 assert.equal(await resolveSingleMenuOwner(page, name), undefined);
 }
 await page.setContent('<li role="menuitem">Casa</li><li role="menuitem">Casa</li>');
 assert.equal(await resolveSingleMenuOwner(page, 'Casa'), undefined);
 } finally { await browser.close(); }
});
