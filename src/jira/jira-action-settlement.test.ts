import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { chromium, type Page, type Route } from "@playwright/test";
import { settleJiraAction } from "./jira-action-settlement";
import { assertJiraSpecVisibleText, clickJiraSpecTarget } from "./jira-spec-runtime";
import { createJiraPlaywrightPort } from "./jira-semantic-executor";

test("Jira waits for the action response before its assertion across two profiles, without another click", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const origin of ["https://fixture-access.test", "https://fixture-orders.test"]) {
      const page = await browser.newPage();
      let receive!: (route: Route) => void;
      const requested = new Promise<Route>(resolve => { receive = resolve; });
      await page.route(`${origin}/**`, async route => {
        if (route.request().url().endsWith("/next")) { receive(route); return; }
        await route.fulfill({ contentType: "text/html", body: `<button onclick="window.clicks=(window.clicks||0)+1; fetch('/next',{method:'POST'}).then(r=>r.text()).then(t=>document.body.innerHTML=t)">Continue</button>` });
      });
      await page.goto(origin);
      let completed = false;
      const action = clickJiraSpecTarget(page, { strategy: "role", role: "button", name: "Continue", exact: true }, 500)
        .then(() => { completed = true; });
      const route = await requested;
      // The browser signal proves the request is in progress; no fixed sleep.
      assert.equal(await page.evaluate(() => Reflect.get(window, "clicks")), 1);
      assert.equal(completed, false);
      await route.fulfill({ contentType: "text/html", body: "<h1>Verified next state</h1>" });
      await action;
      await assertJiraSpecVisibleText(page, "Verified next state", 500);
      assert.equal(await page.evaluate(() => Reflect.get(window, "clicks")), 1);
      await page.close();
    }
  } finally { await browser.close(); }
});

test("scenario teardown cancels the pending wait and removes listeners without a separate timer", async () => {
    const events = new EventEmitter();
    const page = Object.assign(events, { url: () => "https://fixture.test" }) as unknown as Page;
    const request = { url: () => "https://fixture.test/pending", resourceType: () => "fetch" };
    function authoredClickStep() { return settleJiraAction(page, async () => { events.emit("request", request); }); }
    const action = assert.rejects(authoredClickStep(), (error: Error) => {
      assert.match(error.message, /JIRA_SPEC_ACTION_INTERRUPTED/);
      assert.match(error.stack ?? "", /authoredClickStep/);
      return true;
    });
    events.emit("close");
    await action;
    assert.equal(events.listenerCount("request"), 0);
    assert.equal(events.listenerCount("close"), 0);
    assert.equal(events.listenerCount("crash"), 0);
    assert.equal(events.listenerCount("response"), 0);
    assert.equal(events.listenerCount("requestfinished"), 0);
    assert.equal(events.listenerCount("requestfailed"), 0);
});

test("HTTP policy preserves 4xx assertions, ignores foreign/static failures and strips query values", async () => {
  for (const entry of [
    { url: "https://fixture.test/validation", resource: "fetch", status: 400, reject: false },
    { url: "https://foreign.test/service", resource: "fetch", status: 500, reject: false },
    { url: "https://fixture.test/image", resource: "image", status: 500, reject: false },
    { url: "https://fixture.test/submit?token=synthetic-private", resource: "fetch", status: 503, reject: true },
  ]) {
    const events = new EventEmitter();
    const page = Object.assign(events, { url: () => "https://fixture.test" }) as unknown as Page;
    const request = { url: () => entry.url, resourceType: () => entry.resource, method: () => "POST" };
    const action = settleJiraAction(page, async () => {
      events.emit("request", request);
      events.emit("response", { request: () => request, status: () => entry.status });
      events.emit("requestfinished", request);
      return "retained";
    });
    if (entry.reject) await assert.rejects(action, (error: Error) => {
      assert.equal(error.message, "JIRA_APPLICATION_HTTP_SERVER_ERROR:503 POST /submit");
      return true;
    });
    else assert.equal(await action, "retained");
    for (const event of ["request", "response", "requestfinished", "requestfailed", "close", "crash"]) {
      assert.equal(events.listenerCount(event), 0);
    }
  }
});

test("Jira Discovery and promoted click reject the same application 500 without another dispatch", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const origin of ["https://fixture-fenix.test", "https://fixture-inventory.test"]) {
      for (const mode of ["discovery", "spec"] as const) {
        const page = await browser.newPage();
        await page.route(`${origin}/**`, route => route.fulfill(route.request().url().endsWith("/next")
          ? { status: 500, body: "Server failure" }
          : { contentType: "text/html", body: `<button onclick="window.clicks=(window.clicks||0)+1;fetch('/next')">Continue</button>` }));
        await page.goto(origin);
        const action = mode === "spec"
          ? clickJiraSpecTarget(page, { strategy: "role", role: "button", name: "Continue", exact: true }, 500)
          : createJiraPlaywrightPort(page, origin).act({ index: 1, action: "click", description: 'Presionar "Continue"' }, "Continue");
        await assert.rejects(action, /JIRA_APPLICATION_HTTP_SERVER_ERROR:500 GET \/next/);
        assert.equal(await page.evaluate(() => Reflect.get(window, "clicks")), 1);
        await page.close();
      }
    }
  } finally { await browser.close(); }
});
