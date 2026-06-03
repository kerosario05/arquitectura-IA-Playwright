"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const node_path_1 = __importDefault(require("node:path"));
const execution_plan_executor_1 = require("../src/runner/execution-plan-executor");
const dataContext = {
    entries: [{ key: "cedula", value: "001", source: "test_data", sensitive: true }],
    counts: { total: 1, sensitive: 1, nonSensitive: 0 }
};
function evidenceDir(name) {
    return node_path_1.default.resolve(`./.artifacts/test-evidence/${name}`);
}
(0, test_1.test)("executes fill click assertVisible plan", async ({ page }) => {
    await page.setContent('<input aria-label="Cédula" /><button>Consultar</button><h1>Resultado</h1>');
    const plan = {
        version: "1.0",
        source: "manual",
        status: "validated",
        scenario: { source: "manual", title: "basic" },
        requiredData: [{ key: "cedula", required: true, resolved: true }],
        steps: [
            { index: 1, action: "fill", target: { strategy: "label", value: "Cédula" }, valueKey: "cedula", evidence: true },
            { index: 2, action: "click", target: { strategy: "text", value: "Consultar" }, evidence: true },
            { index: 3, action: "assertVisible", target: { strategy: "text", value: "Resultado" }, evidence: true }
        ],
        createdAt: new Date().toISOString()
    };
    const result = await (0, execution_plan_executor_1.executeExecutionPlan)({ page, plan, dataContext, evidenceDir: evidenceDir("executor-ok") });
    (0, test_1.expect)(result.status).toBe("passed");
    (0, test_1.expect)(result.steps.every((step) => step.status === "passed")).toBe(true);
    (0, test_1.expect)(result.steps[0].screenshotPath).toBeTruthy();
});
(0, test_1.test)("fails when valueKey is missing", async ({ page }) => {
    await page.setContent('<input aria-label="Cédula" />');
    const plan = {
        version: "1.0",
        source: "manual",
        status: "validated",
        scenario: { source: "manual", title: "missing-value" },
        requiredData: [],
        steps: [{ index: 1, action: "fill", target: { strategy: "label", value: "Cédula" }, valueKey: "missing" }],
        createdAt: new Date().toISOString()
    };
    const result = await (0, execution_plan_executor_1.executeExecutionPlan)({ page, plan, dataContext, evidenceDir: evidenceDir("executor-fail") });
    (0, test_1.expect)(result.status).toBe("failed");
    (0, test_1.expect)(result.steps[0].status).toBe("failed");
});
(0, test_1.test)("noop step is skipped", async ({ page }) => {
    await page.setContent("<div>ok</div>");
    const plan = {
        version: "1.0",
        source: "manual",
        status: "validated",
        scenario: { source: "manual", title: "noop" },
        requiredData: [],
        steps: [{ index: 1, action: "noop", description: "placeholder" }],
        createdAt: new Date().toISOString()
    };
    const result = await (0, execution_plan_executor_1.executeExecutionPlan)({ page, plan, dataContext, evidenceDir: evidenceDir("executor-noop") });
    (0, test_1.expect)(result.status).toBe("skipped");
    (0, test_1.expect)(result.steps[0].status).toBe("skipped");
});
(0, test_1.test)("executor uses explicit runtimeConfig baseUrl when provided", async ({ page }) => {
    const plan = {
        version: "1.0",
        source: "manual",
        status: "validated",
        scenario: { source: "manual", title: "runtime-config-url" },
        requiredData: [],
        steps: [{ index: 1, action: "navigate", target: "APP_BASE_URL" }],
        createdAt: new Date().toISOString()
    };
    const result = await (0, execution_plan_executor_1.executeExecutionPlan)({
        page,
        plan,
        dataContext,
        evidenceDir: evidenceDir("executor-runtime-config"),
        appBaseUrl: "about:blank",
        runtimeConfig: {
            app: {
                name: "Profile A",
                baseUrl: "data:text/html,<h1>runtime</h1>",
                loginMode: "manual",
                testData: {},
                testDataAliases: {},
                missingInputBehavior: "fail",
                appProfile: "profile-a"
            },
            execution: {
                browser: "chromium",
                headless: true,
                evidenceDir: ".artifacts",
                defaultTimeoutMs: 30000
            },
            integrations: {}
        }
    });
    (0, test_1.expect)(result.status).toBe("passed");
    await (0, test_1.expect)(page.locator("h1")).toContainText("runtime");
});
(0, test_1.test)("executor falls back to appBaseUrl when runtimeConfig is not provided", async ({ page }) => {
    const plan = {
        version: "1.0",
        source: "manual",
        status: "validated",
        scenario: { source: "manual", title: "fallback-global-url" },
        requiredData: [],
        steps: [{ index: 1, action: "navigate", target: "APP_BASE_URL" }],
        createdAt: new Date().toISOString()
    };
    const result = await (0, execution_plan_executor_1.executeExecutionPlan)({
        page,
        plan,
        dataContext,
        evidenceDir: evidenceDir("executor-fallback-config"),
        appBaseUrl: "data:text/html,<h1>fallback</h1>"
    });
    (0, test_1.expect)(result.status).toBe("passed");
    await (0, test_1.expect)(page.locator("h1")).toContainText("fallback");
});
