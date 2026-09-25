"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const env_1 = require("./config/env");
const data_1 = require("./data");
const playwright_runner_1 = require("./runner/playwright-runner");
async function main() {
    console.log("[runner] Starting smoke execution");
    console.log(`[runner] Target URL: ${env_1.config.app.baseUrl}`);
    console.log(`[runner] Browser: ${env_1.config.execution.browser}`);
    console.log(`[runner] Headless: ${env_1.config.execution.headless}`);
    console.log(`[runner] Login mode: ${env_1.config.app.loginMode}`);
    console.log(`[runner] Evidence base path: ${env_1.config.execution.evidenceDir}`);
    const dataContext = (0, data_1.buildDataContext)(env_1.config);
    console.log(`[runner] Data context entries available: ${dataContext.counts.total}`);
    console.log(`[runner] Sensitive entries: ${dataContext.counts.sensitive}`);
    console.log(`[runner] Non-sensitive entries: ${dataContext.counts.nonSensitive}`);
    console.log(`[runner] Dynamic aliases configured: ${Object.keys(env_1.config.app.testDataAliases).length}`);
    console.log(`[runner] Missing input behavior: ${env_1.config.app.missingInputBehavior}`);
    try {
        await (0, playwright_runner_1.runSmokeExecution)();
        console.log("[runner] Smoke execution finished successfully");
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[runner] Smoke execution failed: ${message}`);
        process.exitCode = 1;
    }
}
void main();
