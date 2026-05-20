import type { LoginStrategy } from "../types/login.types";

export const noLoginStrategy: LoginStrategy = {
  name: "no_login",
  async execute(page, config) {
    await page.goto(config.app.baseUrl, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: config.execution.defaultTimeoutMs });
  }
};
