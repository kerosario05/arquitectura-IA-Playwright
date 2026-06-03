"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const env_1 = require("../src/config/env");
test_1.test.skip(process.env.RUN_SMOKE_TESTS !== "true", "Set RUN_SMOKE_TESTS=true to run live smoke navigation tests.");
(0, test_1.test)("generic smoke page load", async ({ page }, testInfo) => {
    await page.goto(env_1.config.app.baseUrl, { waitUntil: "domcontentloaded" });
    await (0, test_1.expect)(page).toHaveURL(/.+/);
    await testInfo.attach("smoke-homepage", {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png"
    });
});
