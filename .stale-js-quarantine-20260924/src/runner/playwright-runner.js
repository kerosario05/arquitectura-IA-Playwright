"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runSmokeExecution = runSmokeExecution;
const test_1 = require("@playwright/test");
const promises_1 = require("node:fs/promises");
const node_path_1 = __importDefault(require("node:path"));
const login_strategy_factory_1 = require("../auth/login-strategy.factory");
const env_1 = require("../config/env");
const evidence_manager_1 = require("../evidence/evidence-manager");
const browser_session_1 = require("../browser/browser-session");
async function runSmokeExecution() {
    const startedAt = new Date().toISOString();
    const runName = (0, evidence_manager_1.getTimestampedRunName)("smoke");
    await (0, evidence_manager_1.ensureEvidenceDir)(env_1.config.execution.evidenceDir);
    const runEvidenceDir = await (0, evidence_manager_1.getRunEvidenceDir)(env_1.config.execution.evidenceDir, runName);
    const result = {
        status: "failed",
        baseUrl: env_1.config.app.baseUrl,
        loginMode: env_1.config.app.loginMode,
        browser: env_1.config.execution.browser,
        headless: env_1.config.execution.headless,
        evidenceDir: runEvidenceDir,
        startedAt,
        finishedAt: startedAt
    };
    const browserType = {
        chromium: test_1.chromium,
        firefox: test_1.firefox,
        webkit: test_1.webkit
    }[env_1.config.execution.browser];
    let session;
    try {
        session = await (0, browser_session_1.launchRuntimeBrowserSession)({
            browserType,
            headless: env_1.config.execution.headless,
            targetUrl: env_1.config.app.baseUrl,
            profilePath: env_1.config.execution.qaBrowserProfilePath,
            channel: env_1.config.execution.qaBrowserChannel,
        });
        const page = session.page;
        page.setDefaultTimeout(env_1.config.execution.defaultTimeoutMs);
        const loginStrategy = (0, login_strategy_factory_1.getLoginStrategy)(env_1.config.app.loginMode);
        await loginStrategy.execute(page, env_1.config);
        await page.screenshot({ path: node_path_1.default.join(runEvidenceDir, "initial-page.png"), fullPage: true });
        result.status = "passed";
    }
    catch (error) {
        result.error = error instanceof Error ? error.message : String(error);
        throw error;
    }
    finally {
        result.finishedAt = new Date().toISOString();
        await (0, promises_1.writeFile)(node_path_1.default.join(runEvidenceDir, "result.json"), JSON.stringify(result, null, 2), "utf-8");
        if (session) {
            await session.close();
        }
    }
}
