import assert from "node:assert/strict";
import test from "node:test";
import { chromium, expect } from "@playwright/test";
import { createPromotedSpecRuntime, PromotedSpecRuntime } from "./promoted-spec-runtime";
import { evaluatePromotedScenarioOutcome } from "./promoted-scenario-outcome";

test("final outcome requires a post-action assertion and acknowledges only explicitly expected errors", () => {
  assert.equal(evaluatePromotedScenarioOutcome({ hasFinalAssertion: false, failureMessages: [], expectedVisibleTargets: [] }), "PROMOTED_FINAL_OUTCOME_UNVERIFIED");
  assert.equal(evaluatePromotedScenarioOutcome({ hasFinalAssertion: true, failureMessages: ["Invalid credentials"], expectedVisibleTargets: ["Welcome"] }), "PROMOTED_UNEXPECTED_BUSINESS_ERROR");
  assert.equal(evaluatePromotedScenarioOutcome({ hasFinalAssertion: true, failureMessages: ["Invalid credentials"], expectedVisibleTargets: ["Invalid credentials"] }), "verified");
  assert.equal(evaluatePromotedScenarioOutcome({ hasFinalAssertion: true, failureMessages: ["Invalid credentials", "Service failure"], expectedVisibleTargets: ["Invalid credentials"] }), "PROMOTED_UNEXPECTED_BUSINESS_ERROR");
});

test("existing runtime API rejects click-only success, preserves negative tests, and finalizes evidence on rejection", async t => {
  const browser = await chromium.launch({ headless: true });
  let finalized = 0;
  const captured: string[] = [];
  t.mock.method(PromotedSpecRuntime.prototype, "clickPromotedTarget", async function (this: any, options: any) { await options.action(); });
  t.mock.method(PromotedSpecRuntime.prototype as any, "ensureInitialEvidence", async () => {});
  t.mock.method(PromotedSpecRuntime.prototype, "finishEvidence", async () => { finalized++; });
  t.mock.method(PromotedSpecRuntime.prototype as any, "captureEvidenceStep", async (_text: string, status: string) => { captured.push(status); });
  try {
    const page = await browser.newPage();
    // tsx preserves helper names inside serialized evaluate callbacks; Playwright's spec
    // transform does not require this test-runner shim.
    await page.evaluate("globalThis.__name = (value) => value");
    for (const [html, expectedTarget, result] of [
      ['<button>Login</button><output hidden>Welcome</output>', "Welcome", "verified"],
      ['<button>Submit</button><div hidden class="text-danger">El código ingresado es incorrecto</div>', "", "PROMOTED_UNEXPECTED_BUSINESS_ERROR"],
      ['<button>Login</button><div hidden role="alert">Invalid credentials</div>', "Invalid credentials", "verified"],
      ['<button>Submit</button><div hidden role="alert">Service failure</div><output hidden>Welcome</output>', "Welcome", "PROMOTED_UNEXPECTED_BUSINESS_ERROR"],
      ['<button>Submit</button><output hidden>Welcome</output>', "", "PROMOTED_FINAL_OUTCOME_UNVERIFIED"],
      ['<button>Submit</button><div hidden role="alert">Invalid credentials</div><div hidden role="alert">Service failure</div>', "Invalid credentials", "PROMOTED_UNEXPECTED_BUSINESS_ERROR"],
    ]) {
      await page.setContent(html);
      const runtime = createPromotedSpecRuntime(page);
      await runtime.clickPromotedTarget({ stepIndex: 1, target: "Submit", actionIntent: "click", action: async () => {
        await page.evaluate(() => { document.querySelectorAll("[hidden]").forEach(node => node.removeAttribute("hidden")); });
      } });
      if (expectedTarget) await runtime.expectPromotedVisible({ stepIndex: 2, target: expectedTarget, polarity: "positive", assertion: () => expect(page.getByText(expectedTarget, { exact: true })).toBeVisible() });
      const previousFinalized = finalized;
      if (result === "verified") await runtime.finishEvidence();
      else await assert.rejects(runtime.finishEvidence(), new RegExp(result));
      assert.equal(finalized, previousFinalized + 1);
      assert.equal(captured.at(-1), result === "verified" ? "passed" : "failed");
    }

    // A passed intermediate oracle cannot certify an action that follows it.
    await page.setContent("<p>Ready</p>");
    const stale = createPromotedSpecRuntime(page);
    await stale.expectPromotedVisible({ stepIndex: 1, target: "Ready", polarity: "positive", assertion: () => expect(page.getByText("Ready")).toBeVisible() });
    await stale.clickPromotedTarget({ stepIndex: 2, target: "Submit", actionIntent: "click", action: async () => {} });
    await assert.rejects(stale.finishEvidence(), /PROMOTED_FINAL_OUTCOME_UNVERIFIED/);

    // Preserve an existing action failure rather than replace its diagnostics at finalization.
    const failed = createPromotedSpecRuntime(page);
    await assert.rejects(failed.clickPromotedTarget({ stepIndex: 1, target: "Submit", actionIntent: "click", action: async () => { throw new Error("original action failure"); } }), /original action failure/);
    await failed.finishEvidence();

    // A pre-existing visible result must not hide a delayed server rejection.
    await page.route("https://fixture.invalid/verify", async route => {
      await new Promise(resolve => setTimeout(resolve, 100));
      await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, body: "rejected" });
    });
    await page.setContent('<p>Ready</p>');
    const delayed = createPromotedSpecRuntime(page);
    await delayed.clickPromotedTarget({ stepIndex: 1, target: "Verify", actionIntent: "click", action: async () => {
      await Promise.all([page.waitForRequest("https://fixture.invalid/verify"), page.evaluate(() => { void fetch("https://fixture.invalid/verify").then(response => response.text()).then(() => {
        const error = document.createElement("div"); error.setAttribute("role", "alert"); error.textContent = "Verification failed"; document.body.append(error);
      }); })]);
    } });
    await delayed.expectPromotedVisible({ stepIndex: 2, target: "Ready", polarity: "positive", assertion: () => expect(page.getByText("Ready")).toBeVisible() });
    await assert.rejects(delayed.finishEvidence(), /PROMOTED_UNEXPECTED_BUSINESS_ERROR/);

    await page.setContent('<p>Complete</p><input aria-invalid="true" aria-errormessage="message"><div id="message">Unrecognized value</div>');
    const invalid = createPromotedSpecRuntime(page);
    await invalid.expectPromotedVisible({ stepIndex: 1, target: "Complete", polarity: "positive", assertion: () => expect(page.getByText("Complete")).toBeVisible() });
    await assert.rejects(invalid.finishEvidence(), /PROMOTED_UNEXPECTED_BUSINESS_ERROR/);

    await page.close();
    await assert.rejects(stale.finishEvidence(), /PROMOTED_FINAL_OUTCOME_UNVERIFIED/);
  } finally { await browser.close(); }
});

test("a verified browser download is terminal completion when the app keeps a loading indicator mounted", async t => {
  const browser = await chromium.launch({ headless: true });
  try {
    t.mock.method(PromotedSpecRuntime.prototype as any, "ensureInitialEvidence", async () => {});
    t.mock.method(PromotedSpecRuntime.prototype, "finishEvidence", async () => {});
    t.mock.method(PromotedSpecRuntime.prototype as any, "captureEvidenceStep", async () => {});
    const context = await browser.newContext({ acceptDownloads: true });
    await context.route("https://fixture.invalid/**", async route => {
      if (route.request().url().endsWith("/template.csv")) {
        await route.fulfill({ status: 200, headers: { "content-type": "text/csv", "content-disposition": "attachment; filename=template.csv" }, body: "name\nfixture\n" });
        return;
      }
      await route.fulfill({ status: 200, contentType: "text/html", body: "<a href='/template.csv'>Download template</a><div role='progressbar'>Loading</div>" });
    });
    const page = await context.newPage();
    await page.goto("https://fixture.invalid/");
    await page.evaluate("globalThis.__name = (value) => value");
    const runtime = createPromotedSpecRuntime(page, { actionTimeoutMs: 200 });
    await runtime.clickPromotedTarget({ stepIndex: 1, target: "Download template", actionIntent: "click", expectedEffect: "ui_change", action: async () => {} });
    await runtime.expectPromotedVisible({
      stepIndex: 2,
      target: "https://fixture.invalid/",
      polarity: "positive",
      expectedUrl: "https://fixture.invalid/",
      requireCompletionSignal: true,
      assertion: async () => expect(page).toHaveURL("https://fixture.invalid/"),
    });
    await runtime.finishEvidence();
    await context.close();
  } finally { await browser.close(); }
});

test("a final action that changes route is an observed outcome; a click that stays put is still unverified", async t => {
  assert.equal(evaluatePromotedScenarioOutcome({ hasFinalAssertion: false, finalActionNavigated: true, failureMessages: [], expectedVisibleTargets: [] }), "verified");
  assert.equal(evaluatePromotedScenarioOutcome({ hasFinalAssertion: false, finalActionNavigated: true, failureMessages: ["Service failure"], expectedVisibleTargets: [] }), "PROMOTED_UNEXPECTED_BUSINESS_ERROR");
  assert.equal(evaluatePromotedScenarioOutcome({ hasFinalAssertion: false, finalActionNavigated: false, failureMessages: [], expectedVisibleTargets: [] }), "PROMOTED_FINAL_OUTCOME_UNVERIFIED");

  const browser = await chromium.launch({ headless: true });
  t.mock.method(PromotedSpecRuntime.prototype, "clickPromotedTarget", async function (this: any, options: any) { await options.action(); });
  t.mock.method(PromotedSpecRuntime.prototype as any, "ensureInitialEvidence", async () => {});
  t.mock.method(PromotedSpecRuntime.prototype, "finishEvidence", async () => {});
  t.mock.method(PromotedSpecRuntime.prototype as any, "captureEvidenceStep", async () => {});
  try {
    const page = await browser.newPage();
    await page.addInitScript("globalThis.__name = (value) => value");
    await page.setContent("<button>Validar</button>");
    await page.evaluate("globalThis.__name = (value) => value");
    const navigates = createPromotedSpecRuntime(page);
    await navigates.clickPromotedTarget({ stepIndex: 1, target: "Validar", actionIntent: "click", action: async () => { await page.goto("data:text/html,<p>Siguiente</p>"); } });
    await navigates.finishEvidence();

    await page.setContent("<button>Validar</button>");
    const staysPut = createPromotedSpecRuntime(page);
    await staysPut.clickPromotedTarget({ stepIndex: 1, target: "Validar", actionIntent: "click", action: async () => {} });
    await assert.rejects(staysPut.finishEvidence(), /PROMOTED_FINAL_OUTCOME_UNVERIFIED/);
  } finally {
    await browser.close();
  }
});
