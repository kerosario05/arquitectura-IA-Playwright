import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { settleDependentRequestsAfterFill } from "./post-fill-settle";

async function withPage(run: (page: import("playwright").Page) => Promise<void>) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.route("**/rate", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 400));
      await route.fulfill({ status: 200, contentType: "text/plain", body: "6.37" });
    });
    await run(page);
  } finally {
    await browser.close();
  }
}

const html = (delayMs: number) => `<input id=p><input id=t>
<script>document.getElementById('p').addEventListener('blur',()=>setTimeout(async()=>{
  const r=await fetch('http://localhost/rate'); document.getElementById('t').value=await r.text();},${delayMs}));</script>`;

test("waits for requests started after blur until the dependent field is filled", async () => {
  await withPage(async (page) => {
    await page.route("http://localhost/", (route) => route.fulfill({ contentType: "text/html", body: html(800) }));
    await page.goto("http://localhost/");
    await page.fill("#p", "12");
    await page.locator("#p").blur();
    const result = await settleDependentRequestsAfterFill(page);
    assert.equal(result.requestsStarted, 1);
    assert.equal(result.settled, true);
    assert.equal(await page.inputValue("#t"), "6.37");
  });
});

test("does not wait the full budget when blur starts no request", async () => {
  await withPage(async (page) => {
    await page.route("http://localhost/", (route) => route.fulfill({ contentType: "text/html", body: "<input id=p>" }));
    await page.goto("http://localhost/");
    await page.fill("#p", "x");
    await page.locator("#p").blur();
    const result = await settleDependentRequestsAfterFill(page, { startWindowMs: 300 });
    assert.equal(result.requestsStarted, 0);
    assert.ok(result.waitedMs < 1000);
  });
});
