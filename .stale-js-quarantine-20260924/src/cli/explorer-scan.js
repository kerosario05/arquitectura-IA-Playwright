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
const page_scanner_1 = require("../explorer/page-scanner");
const snapshot_writer_1 = require("../explorer/snapshot-writer");
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
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
function getDefaultOutputPath() {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return node_path_1.default.resolve(`./.artifacts/explorer/snapshot-${stamp}.json`);
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    const browserType = { chromium: test_1.chromium, firefox: test_1.firefox, webkit: test_1.webkit }[env_1.config.execution.browser];
    const outputPath = args.output ? node_path_1.default.resolve(args.output) : getDefaultOutputPath();
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
        if (args.noLogin) {
            await page.goto(env_1.config.app.baseUrl, { waitUntil: "domcontentloaded" });
        }
        else {
            const loginStrategy = (0, login_strategy_factory_1.getLoginStrategy)(env_1.config.app.loginMode);
            await loginStrategy.execute(page, env_1.config);
        }
        await page.waitForLoadState("domcontentloaded", { timeout: env_1.config.execution.defaultTimeoutMs });
        const snapshot = await (0, page_scanner_1.scanCurrentPage)(page);
        await (0, snapshot_writer_1.writePageSnapshot)(snapshot, outputPath);
        if (args.screenshot) {
            const screenshotPath = node_path_1.default.join(node_path_1.default.dirname(outputPath), `${node_path_1.default.basename(outputPath, ".json")}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: true });
            console.log(`Screenshot path: ${screenshotPath}`);
        }
        console.log(`URL: ${snapshot.url}`);
        console.log(`Title: ${snapshot.title}`);
        console.log(`Total elements: ${snapshot.summary.totalElements}`);
        console.log(`Counts: buttons=${snapshot.summary.buttons}, links=${snapshot.summary.links}, inputs=${snapshot.summary.inputs}, selects=${snapshot.summary.selects}, tables=${snapshot.summary.tables}, dialogs=${snapshot.summary.dialogs}, headings=${snapshot.summary.headings}`);
        console.log(`Snapshot path: ${outputPath}`);
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
    console.error(`[explorer:scan] ${message}`);
    process.exitCode = 1;
});
