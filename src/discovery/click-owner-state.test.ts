import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { readClickOwnerClassTokens } from "./click-owner-state";

test("class evidence stays bounded after a resolved option or lookup owner disappears", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    for (const role of ["option", "button"]) {
      await page.setContent(`<div role="${role}" class="control active">Choice</div>`);
      const owner = page.getByRole(role as "option" | "button");
      assert.deepEqual(await readClickOwnerClassTokens(owner), ["control", "active"]);
      await owner.evaluate(el => el.remove());
      const started = performance.now();
      assert.equal(await readClickOwnerClassTokens(owner), undefined);
      assert.ok(performance.now() - started < 1500, "optional evidence must not wait for the action timeout");
    }
  } finally { await browser.close(); }
});
