"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.noLoginStrategy = void 0;
exports.noLoginStrategy = {
    name: "no_login",
    async execute(page, config) {
        await page.goto(config.app.baseUrl, { waitUntil: "domcontentloaded" });
        await page.waitForLoadState("networkidle", { timeout: config.execution.defaultTimeoutMs });
    }
};
