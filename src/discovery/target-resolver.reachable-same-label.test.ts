import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";
import type { PageSnapshot } from "../types/page-snapshot.types";

// Sidebar where only "Persona jurídica" is expanded: the folded "Persona física" submenu still holds a link with the same label.
const sidebar = (folded: string) => `
<nav>
  <button type="button">Persona física</button>
  <div style="height:${folded};overflow:hidden"><a href="/f" id="fisica">Nueva solicitud</a></div>
  <button type="button">Persona jurídica</button>
  <div><a href="/j" id="juridica">Nueva solicitud</a></div>
</nav>`;

function snapshot(url: string): PageSnapshot {
  const link = { type: "link", role: "link", tagName: "a", text: "Nueva solicitud", accessibleName: "Nueva solicitud", visible: true, disabled: false, candidateLocators: [], dataHints: [] };
  return {
    version: "1.0", capturedAt: new Date().toISOString(), url, title: "fixture",
    summary: { totalElements: 2, buttons: 0, links: 2, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    elements: [{ id: "e1", ...link }, { id: "e2", ...link }],
  } as PageSnapshot;
}

async function resolve(html: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const result = await resolveActionTarget(page, snapshot(page.url()), "Nueva solicitud", { actionType: "action_click" });
    const id = result.status === "resolved" && result.locator ? await result.locator.getAttribute("id") : undefined;
    return { status: result.status, strategy: result.locatorStrategy, id };
  } finally {
    await browser.close();
  }
}

test("mock: the same label in a folded submenu does not make the visible one ambiguous", async () => {
  const result = await resolve(sidebar("0"));
  assert.equal(result.status, "resolved");
  assert.equal(result.id, "juridica");
});

test("mock: two same-label links that are both reachable stay ambiguous", async () => {
  const result = await resolve(sidebar("auto"));
  assert.notEqual(result.strategy, "single_reachable_same_label");
  assert.notEqual(result.status, "resolved");
});
