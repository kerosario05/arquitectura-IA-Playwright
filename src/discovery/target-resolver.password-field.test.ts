import assert from "node:assert/strict";
import test from "node:test";
import { chromium, type Page } from "@playwright/test";
import { resolveFillTarget } from "./target-resolver";

const EMPTY_SNAPSHOT = { elements: [] } as any;

async function withPage(run: (page: Page) => Promise<void>): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    await run(await browser.newPage());
  } finally {
    await browser.close();
  }
}

test("generic password field resolves to the unique visible editable password input", async () => {
  await withPage(async (page) => {
    await page.setContent(`
      <form>
        <label for="secret">Contraseña:</label>
        <input id="secret" type="password" autocomplete="current-password">
      </form>
    `);

    const result = await resolveFillTarget(page, EMPTY_SNAPSHOT, "Contraseña");
    assert.equal(result.status, "resolved");
    assert.ok(result.locator);
    assert.equal(await result.locator!.getAttribute("type"), "password");
    assert.equal(await result.locator!.getAttribute("id"), "secret");
  });
});

