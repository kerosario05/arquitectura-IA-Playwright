"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const test_1 = require("@playwright/test");
const env_1 = require("../config/env");
const login_strategy_factory_1 = require("../auth/login-strategy.factory");
const browser_session_1 = require("../browser/browser-session");
const discovery_scanner_1 = require("../discovery/discovery-scanner");
function parseArgs(argv) {
    const args = { screenshot: false, noLogin: false };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const nextValue = argv[i + 1];
        if (token === "--screenshot") {
            args.screenshot = true;
            continue;
        }
        if (token === "--no-login") {
            args.noLogin = true;
            continue;
        }
        if (token === "--output") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --output");
            }
            args.output = nextValue;
            i += 1;
            continue;
        }
        if (token === "--url") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --url");
            }
            args.url = nextValue;
            i += 1;
            continue;
        }
        if (token === "--min-confidence") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --min-confidence");
            }
            args.minConfidence = parseFloat(nextValue);
            if (isNaN(args.minConfidence) || args.minConfidence < 0 || args.minConfidence > 1) {
                throw new Error("--min-confidence must be a number between 0 and 1");
            }
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
function getDefaultOutputPath() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return node_path_1.default.resolve(`./.artifacts/discovery/scan-${stamp}.json`);
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const browserType = { chromium: test_1.chromium, firefox: test_1.firefox, webkit: test_1.webkit }[env_1.config.execution.browser];
    const outputPath = args.output ? node_path_1.default.resolve(args.output) : getDefaultOutputPath();
    const targetUrl = args.url || env_1.config.app.baseUrl;
    let session;
    try {
        session = await (0, browser_session_1.launchRuntimeBrowserSession)({
            browserType,
            headless: env_1.config.execution.headless,
            targetUrl,
            profilePath: env_1.config.execution.qaBrowserProfilePath,
            channel: env_1.config.execution.qaBrowserChannel,
        });
        const page = session.page;
        page.setDefaultTimeout(env_1.config.execution.defaultTimeoutMs);
        if (args.noLogin) {
            await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        }
        else {
            const loginStrategy = (0, login_strategy_factory_1.getLoginStrategy)(env_1.config.app.loginMode);
            await loginStrategy.execute(page, env_1.config);
        }
        await page.waitForLoadState("domcontentloaded", { timeout: env_1.config.execution.defaultTimeoutMs });
        const screenshotPath = args.screenshot
            ? node_path_1.default.join(node_path_1.default.dirname(outputPath), `${node_path_1.default.basename(outputPath, ".json")}.png`)
            : undefined;
        const result = await (0, discovery_scanner_1.runDiscoveryScan)({
            page,
            outputPath,
            screenshotPath,
            minConfidence: args.minConfidence
        });
        (0, discovery_scanner_1.printDiscoverySummary)(result);
        console.log(`\nDiscovery result saved to: ${outputPath}`);
        if (screenshotPath) {
            console.log(`Screenshot saved to: ${screenshotPath}`);
        }
        console.log(`\nTo review proposed objects, run: npm run registry:inspect`);
    }
    finally {
        if (session) {
            await session.close();
        }
    }
}
main()
    .then(() => {
    process.exitCode = 0;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[discovery:scan] ${message}`);
    process.exitCode = 1;
});
