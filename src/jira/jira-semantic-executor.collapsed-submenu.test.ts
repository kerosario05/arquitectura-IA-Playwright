import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveJiraActionTarget } from "./jira-semantic-executor";

// Mock of the app sidebar: only "Persona jurídica" is expanded; the folded "Persona física" submenu still carries a
// link with the same label (zero-height container with overflow hidden), which Playwright reports as visible.
const sidebar = (foldedHeight: string) => `
<nav>
  <button type="button">Persona física</button>
  <div id="fisica" style="height:${foldedHeight};overflow:hidden"><a href="/fisica/nueva" id="fisica-link">Nueva solicitud</a></div>
  <button type="button">Persona jurídica</button>
  <div id="juridica"><a href="/juridica/nueva" id="juridica-link">Nueva solicitud</a></div>
</nav>`;

function snapshot(url: string) {
  return {
    version: "1.0", capturedAt: new Date().toISOString(), url, title: "fixture",
    summary: { totalElements: 0, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    elements: [],
  } as never;
}

async function resolve(html: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const result = await resolveJiraActionTarget(page, snapshot(page.url()), "Nueva solicitud");
    const id = result.status === "resolved" && result.locator ? await result.locator.getAttribute("id") : undefined;
    return { status: result.status, id };
  } finally {
    await browser.close();
  }
}

test("mock: the same label inside a folded submenu is not a second candidate", async () => {
  const result = await resolve(sidebar("0"));
  assert.equal(result.status, "resolved");
  assert.equal(result.id, "juridica-link");
});

const visibleNav = `<nav><a href="/juridica/nueva" id="real" style="display:inline-block;padding:8px">Nueva solicitud</a></nav>`;

test("mock: a same-label link in an off-canvas duplicate menu is not a second candidate", async () => {
  const result = await resolve(`${visibleNav}<aside style="position:fixed;left:-400px;top:0;width:300px"><a href="/m" id="drawer">Nueva solicitud</a></aside>`);
  assert.equal(result.status, "resolved");
  assert.equal(result.id, "real");
});

test("mock: a same-label link covered by an overlay is not a second candidate", async () => {
  const result = await resolve(`${visibleNav}<div style="position:relative;display:inline-block;margin-left:200px"><a href="/c" id="covered" style="display:inline-block;padding:8px">Nueva solicitud</a><div style="position:absolute;inset:0;background:#fff"></div></div>`);
  assert.equal(result.status, "resolved");
  assert.equal(result.id, "real");
});

test("mock: a same-label link in an invisible pointer-transparent layer is not a second candidate", async () => {
  const result = await resolve(`${visibleNav}<div style="position:fixed;left:300px;top:100px;opacity:0;pointer-events:none"><a href="/p" id="ghost" style="display:inline-block;padding:8px">Nueva solicitud</a></div>`);
  assert.equal(result.status, "resolved");
  assert.equal(result.id, "real");
});

test("mock: two links that are both reachable stay ambiguous", async () => {
  const result = await resolve(sidebar("auto"));
  assert.equal(result.status, "ambiguous");
});
