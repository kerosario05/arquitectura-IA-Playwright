import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { executeExecutionPlan } from "./execution-plan-executor";

test("direct plan replay follows recorded pageKey and opens a new tab only when declared", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const firstPage = await context.newPage();
    await context.route("**/*", async (route) => {
      const body = route.request().url().includes("approval.test")
        ? "<main><h1>Approval queue</h1></main>"
        : "<main><h1>Portal</h1></main>";
      await route.fulfill({ contentType: "text/html", body });
    });

    const result = await executeExecutionPlan({
      page: firstPage,
      dataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
      evidenceDir: "unused-recorded-tabs-test",
      plan: {
        version: "1.0",
        source: "discovery_generated",
        status: "validated",
        scenario: { source: "manual", title: "Portal then approvals" },
        requiredData: [],
        createdAt: new Date(0).toISOString(),
        steps: [
          { index: 1, action: "navigate", target: "APP_BASE_URL", navigationUrl: "https://portal.test/start", pageKey: "tab-1" },
          { index: 2, action: "navigate", target: "APP_BASE_URL", navigationUrl: "https://approval.test/queue", pageKey: "tab-2", opensNewPage: true },
          { index: 3, action: "assertUrl", target: { strategy: "url", value: "approval.test/queue" }, expected: "approval.test/queue", pageKey: "tab-2" },
          { index: 4, action: "noop", recordingActionType: "tab_switch", description: "Cambiar a la pestaña portal", pageKey: "tab-1" },
          { index: 5, action: "assertUrl", target: { strategy: "url", value: "portal.test/start" }, expected: "portal.test/start", pageKey: "tab-1" },
        ],
      },
    });

    assert.equal(result.status, "passed");
    assert.deepEqual(result.steps.map((step) => step.status), ["passed", "passed", "passed", "passed", "passed"]);
    assert.equal(firstPage.url(), "https://portal.test/start");
    assert.equal(context.pages().length, 2);
    assert.equal(context.pages()[1].url(), "https://approval.test/queue");
  } finally {
    await browser.close();
  }
});
