import type { LoginStrategy } from "../types/login.types";

export const manualLoginStrategy: LoginStrategy = {
  name: "manual",
  async execute(page, config) {
    if (config.execution.headless) {
      throw new Error("Manual login requires HEADLESS=false.");
    }

    await page.goto(config.app.baseUrl, { waitUntil: "domcontentloaded" });
    console.log("[manual-login] Complete login manually in the browser window.");
    await page.pause();
    await page.waitForLoadState("networkidle", { timeout: config.execution.defaultTimeoutMs });
  }
};
