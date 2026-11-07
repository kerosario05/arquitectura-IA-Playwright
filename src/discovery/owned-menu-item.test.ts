import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { resolveOwnedMenuItem } from "./owned-menu-item";

test("owned popup disambiguates duplicate text without selecting another menu", async () => {
 const browser = await chromium.launch();
 try {
  const page = await browser.newPage();
  await page.setContent(`<button aria-expanded="true" aria-controls="m">Add address</button><span>Home</span><div id="m" role="menu"><a role="menuitem">Home</a></div><div role="menu"><a role="menuitem">Home</a></div>`);
  const item = await resolveOwnedMenuItem(page, "Add address", "Home");
  assert.ok(item);
  assert.equal(await item.evaluate(el => el.parentElement?.id), "m");
  await page.locator("#m").evaluate(el => el.remove());
  assert.equal(await resolveOwnedMenuItem(page, "Add address", "Home"), undefined);
  await page.setContent(`<button aria-expanded="true" aria-controls="m">Add address</button><div id="m" role="menu"><a role="menuitem">Home</a><a role="menuitem">Home</a></div>`);
  assert.equal(await resolveOwnedMenuItem(page, "Add address", "Home"), undefined);
 } finally { await browser.close(); }
});
