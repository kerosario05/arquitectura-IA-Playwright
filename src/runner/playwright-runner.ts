import { chromium, firefox, webkit } from "@playwright/test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { getLoginStrategy } from "../auth/login-strategy.factory";
import { config } from "../config/env";
import { ensureEvidenceDir, getRunEvidenceDir, getTimestampedRunName } from "../evidence/evidence-manager";
import type { SmokeExecutionResult } from "../types/execution.types";

export async function runSmokeExecution(): Promise<void> {
  const startedAt = new Date().toISOString();
  const runName = getTimestampedRunName("smoke");

  await ensureEvidenceDir(config.execution.evidenceDir);
  const runEvidenceDir = await getRunEvidenceDir(config.execution.evidenceDir, runName);

  const result: SmokeExecutionResult = {
    status: "failed",
    baseUrl: config.app.baseUrl,
    loginMode: config.app.loginMode,
    browser: config.execution.browser,
    headless: config.execution.headless,
    evidenceDir: runEvidenceDir,
    startedAt,
    finishedAt: startedAt
  };

  const browserType = {
    chromium,
    firefox,
    webkit
  }[config.execution.browser];

  let browser;
  try {
    browser = await browserType.launch({ headless: config.execution.headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(config.execution.defaultTimeoutMs);

    const loginStrategy = getLoginStrategy(config.app.loginMode);
    await loginStrategy.execute(page, config);

    await page.screenshot({ path: path.join(runEvidenceDir, "initial-page.png"), fullPage: true });

    result.status = "passed";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    result.finishedAt = new Date().toISOString();
    await writeFile(path.join(runEvidenceDir, "result.json"), JSON.stringify(result, null, 2), "utf-8");

    if (browser) {
      await browser.close();
    }
  }
}
