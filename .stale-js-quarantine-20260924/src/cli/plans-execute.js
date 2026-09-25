"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_path_1 = __importDefault(require("node:path"));
const test_1 = require("@playwright/test");
const env_1 = require("../config/env");
const data_1 = require("../data");
const promises_1 = require("node:fs/promises");
const plans_1 = require("../plans");
const login_strategy_factory_1 = require("../auth/login-strategy.factory");
const browser_session_1 = require("../browser/browser-session");
const execution_plan_executor_1 = require("../runner/execution-plan-executor");
const plan_execution_writer_1 = require("../runner/plan-execution-writer");
function parseArgs(argv) {
    const args = { continueOnFailure: false, headed: false };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const next = argv[i + 1];
        if (token === "--continue-on-failure") {
            args.continueOnFailure = true;
            continue;
        }
        if (token === "--headed") {
            args.headed = true;
            continue;
        }
        if ((token === "--plans" || token === "--output") && (!next || next.startsWith("--"))) {
            throw new Error(`Missing value for ${token}`);
        }
        if (token === "--plans") {
            args.plans = next;
            i += 1;
            continue;
        }
        if (token === "--output") {
            args.output = next;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
function parsePlansPayload(payload) {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (typeof payload === "object" && payload !== null && Array.isArray(payload.plans)) {
        return payload.plans;
    }
    throw new Error("Invalid plans file format. Expected ExecutionPlan[] or { plans: ExecutionPlan[] }.");
}
function safeName(plan) {
    const base = plan.scenario.externalId || String(plan.scenario.caseId || "scenario");
    const title = plan.scenario.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60);
    return `${base}-${title}`;
}
async function run() {
    const args = parseArgs(process.argv.slice(2));
    if (!args.plans) {
        throw new Error("--plans is required.");
    }
    const plansPayload = JSON.parse(await (0, promises_1.readFile)(node_path_1.default.resolve(args.plans), "utf-8"));
    const plans = parsePlansPayload(plansPayload);
    plans.forEach((plan) => (0, plans_1.assertValidExecutionPlan)(plan));
    const dataContext = (0, data_1.buildDataContext)(env_1.config);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const baseExecutionDir = node_path_1.default.resolve(`./.artifacts/executions/${timestamp}`);
    const outputPath = args.output ? node_path_1.default.resolve(args.output) : node_path_1.default.resolve(`./.artifacts/executions/results-${timestamp}.json`);
    const browserType = { chromium: test_1.chromium, firefox: test_1.firefox, webkit: test_1.webkit }[env_1.config.execution.browser];
    const session = await (0, browser_session_1.launchRuntimeBrowserSession)({
        browserType,
        headless: args.headed ? false : env_1.config.execution.headless,
        targetUrl: env_1.config.app.baseUrl,
        profilePath: env_1.config.execution.qaBrowserProfilePath,
        channel: env_1.config.execution.qaBrowserChannel,
    });
    const results = [];
    try {
        const page = session.page;
        page.setDefaultTimeout(env_1.config.execution.defaultTimeoutMs);
        const loginStrategy = (0, login_strategy_factory_1.getLoginStrategy)(env_1.config.app.loginMode);
        await loginStrategy.execute(page, env_1.config);
        for (const plan of plans) {
            const evidenceDir = node_path_1.default.join(baseExecutionDir, safeName(plan));
            const result = await (0, execution_plan_executor_1.executeExecutionPlan)({
                page,
                plan,
                dataContext,
                evidenceDir,
                continueOnFailure: args.continueOnFailure,
                appBaseUrl: env_1.config.app.baseUrl
            });
            results.push(result);
        }
    }
    finally {
        await session.close();
    }
    const summary = {
        generatedAt: new Date().toISOString(),
        total: results.length,
        passed: results.filter((r) => r.status === "passed").length,
        failed: results.filter((r) => r.status === "failed").length,
        partial: results.filter((r) => r.status === "partial").length,
        skipped: results.filter((r) => r.status === "skipped").length,
        results
    };
    await (0, plan_execution_writer_1.writePlanExecutionResults)(summary, outputPath);
    console.log(`Total: ${summary.total}`);
    console.log(`Passed: ${summary.passed}`);
    console.log(`Failed: ${summary.failed}`);
    console.log(`Partial: ${summary.partial}`);
    console.log(`Skipped: ${summary.skipped}`);
    console.log(`Results path: ${outputPath}`);
    return summary.failed > 0 ? 1 : 0;
}
run()
    .then((code) => {
    process.exitCode = code;
})
    .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[plans:execute] ${message}`);
    process.exitCode = 1;
});
