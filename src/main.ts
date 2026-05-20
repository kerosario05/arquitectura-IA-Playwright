import { config } from "./config/env";
import { buildDataContext } from "./data";
import { runSmokeExecution } from "./runner/playwright-runner";

async function main(): Promise<void> {
  console.log("[runner] Starting smoke execution");
  console.log(`[runner] Target URL: ${config.app.baseUrl}`);
  console.log(`[runner] Browser: ${config.execution.browser}`);
  console.log(`[runner] Headless: ${config.execution.headless}`);
  console.log(`[runner] Login mode: ${config.app.loginMode}`);
  console.log(`[runner] Evidence base path: ${config.execution.evidenceDir}`);

  const dataContext = buildDataContext(config);
  console.log(`[runner] Data context entries available: ${dataContext.counts.total}`);
  console.log(`[runner] Sensitive entries: ${dataContext.counts.sensitive}`);
  console.log(`[runner] Non-sensitive entries: ${dataContext.counts.nonSensitive}`);
  console.log(`[runner] Dynamic aliases configured: ${Object.keys(config.app.testDataAliases).length}`);
  console.log(`[runner] Missing input behavior: ${config.app.missingInputBehavior}`);

  try {
    await runSmokeExecution();
    console.log("[runner] Smoke execution finished successfully");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[runner] Smoke execution failed: ${message}`);
    process.exitCode = 1;
  }
}

void main();
