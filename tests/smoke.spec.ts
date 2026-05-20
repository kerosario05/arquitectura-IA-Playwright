import { test, expect } from "@playwright/test";
import { config } from "../src/config/env";

test.skip(
  process.env.RUN_SMOKE_TESTS !== "true",
  "Set RUN_SMOKE_TESTS=true to run live smoke navigation tests."
);

test("generic smoke page load", async ({ page }, testInfo) => {
  await page.goto(config.app.baseUrl, { waitUntil: "domcontentloaded" });

  await expect(page).toHaveURL(/.+/);

  await testInfo.attach("smoke-homepage", {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png"
  });
});
