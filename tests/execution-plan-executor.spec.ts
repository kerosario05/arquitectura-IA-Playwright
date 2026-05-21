import { expect, test } from "@playwright/test";
import path from "node:path";
import { executeExecutionPlan } from "../src/runner/execution-plan-executor";
import type { ExecutionPlan } from "../src/types/execution-plan.types";
import type { DataContext } from "../src/data/data-context";

const dataContext: DataContext = {
  entries: [{ key: "cedula", value: "001", source: "test_data", sensitive: true }],
  counts: { total: 1, sensitive: 1, nonSensitive: 0 }
};

function evidenceDir(name: string): string {
  return path.resolve(`./.artifacts/test-evidence/${name}`);
}

test("executes fill click assertVisible plan", async ({ page }) => {
  await page.setContent('<input aria-label="Cédula" /><button>Consultar</button><h1>Resultado</h1>');

  const plan: ExecutionPlan = {
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

  const result = await executeExecutionPlan({ page, plan, dataContext, evidenceDir: evidenceDir("executor-ok") });
  expect(result.status).toBe("passed");
  expect(result.steps.every((step) => step.status === "passed")).toBe(true);
  expect(result.steps[0].screenshotPath).toBeTruthy();
});

test("fails when valueKey is missing", async ({ page }) => {
  await page.setContent('<input aria-label="Cédula" />');

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "manual",
    status: "validated",
    scenario: { source: "manual", title: "missing-value" },
    requiredData: [],
    steps: [{ index: 1, action: "fill", target: { strategy: "label", value: "Cédula" }, valueKey: "missing" }],
    createdAt: new Date().toISOString()
  };

  const result = await executeExecutionPlan({ page, plan, dataContext, evidenceDir: evidenceDir("executor-fail") });
  expect(result.status).toBe("failed");
  expect(result.steps[0].status).toBe("failed");
});

test("noop step is skipped", async ({ page }) => {
  await page.setContent("<div>ok</div>");

  const plan: ExecutionPlan = {
    version: "1.0",
    source: "manual",
    status: "validated",
    scenario: { source: "manual", title: "noop" },
    requiredData: [],
    steps: [{ index: 1, action: "noop", description: "placeholder" }],
    createdAt: new Date().toISOString()
  };

  const result = await executeExecutionPlan({ page, plan, dataContext, evidenceDir: evidenceDir("executor-noop") });
  expect(result.status).toBe("skipped");
  expect(result.steps[0].status).toBe("skipped");
});

test("executor uses explicit runtimeConfig baseUrl when provided", async ({ page }) => {
  const plan: ExecutionPlan = {
    version: "1.0",
    source: "manual",
    status: "validated",
    scenario: { source: "manual", title: "runtime-config-url" },
    requiredData: [],
    steps: [{ index: 1, action: "navigate", target: "APP_BASE_URL" }],
    createdAt: new Date().toISOString()
  };

  const result = await executeExecutionPlan({
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

  expect(result.status).toBe("passed");
  await expect(page.locator("h1")).toContainText("runtime");
});

test("executor falls back to appBaseUrl when runtimeConfig is not provided", async ({ page }) => {
  const plan: ExecutionPlan = {
    version: "1.0",
    source: "manual",
    status: "validated",
    scenario: { source: "manual", title: "fallback-global-url" },
    requiredData: [],
    steps: [{ index: 1, action: "navigate", target: "APP_BASE_URL" }],
    createdAt: new Date().toISOString()
  };

  const result = await executeExecutionPlan({
    page,
    plan,
    dataContext,
    evidenceDir: evidenceDir("executor-fallback-config"),
    appBaseUrl: "data:text/html,<h1>fallback</h1>"
  });

  expect(result.status).toBe("passed");
  await expect(page.locator("h1")).toContainText("fallback");
});
