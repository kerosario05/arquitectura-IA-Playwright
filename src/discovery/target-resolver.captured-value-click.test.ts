import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";
import type { PageSnapshot } from "../types/page-snapshot.types";

/**
 * Mock of a worklist results table: the same case number is a link in two rows (two processes), and the process
 * name is plain text in one row and a link in another. A click recorded on the case number must resolve to a link.
 */
const table = `
<table>
  <tr><td><a id="mpn-1" href="#a" onclick="this.dataset.picked='1';return false">MPN-3377</a></td>
      <td id="proc-1">Gestión Documentos Desembolso</td>
      <td><a href="#r">Revisar Documentos Recepción</a></td></tr>
  <tr><td><a id="mpn-2" href="#b" onclick="this.dataset.picked='1';return false">MPN-3377</a></td>
      <td>Solicitud MultiProducto Persona Natural</td>
      <td><a id="task" href="#t">Gestión Documentos Desembolso</a></td></tr>
</table>`;

function snapshot(url: string, items: Array<{ text: string; tag: string; type: string }>): PageSnapshot {
  return {
    version: "1.0", capturedAt: new Date().toISOString(), url, title: "fixture",
    summary: { totalElements: items.length, buttons: 0, links: items.length, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    elements: items.map((item, index) => ({
      id: `el-${index}`, type: item.type, role: item.type === "link" ? "link" : undefined, tagName: item.tag,
      text: item.text, accessibleName: item.text, visible: true, disabled: false, candidateLocators: [], dataHints: [],
    })),
  } as PageSnapshot;
}

test("mock: the same duplicated links stay ambiguous when the text is not a transported identifier", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(table);
    const result = await resolveActionTarget(page, snapshot(page.url(), [
      { text: "MPN-3377", tag: "a", type: "link" },
      { text: "MPN-3377", tag: "a", type: "link" },
    ]), "MPN-3377", { actionType: "action_click", recordingActionType: "click", recordedTechnicalTargetRefs: [] });
    assert.notEqual(result.status, "resolved");
  } finally {
    await browser.close();
  }
});

test("mock: a click on the case number resolves to a link of the results table", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(table);
    const result = await resolveActionTarget(page, snapshot(page.url(), [
      { text: "MPN-3377", tag: "a", type: "link" },
      { text: "MPN-3377", tag: "a", type: "link" },
      { text: "Gestión Documentos Desembolso", tag: "td", type: "text" },
      { text: "Gestión Documentos Desembolso", tag: "a", type: "link" },
    ]), "MPN-3377", { actionType: "action_click", recordingActionType: "click", recordedTechnicalTargetRefs: [], capturedValueTarget: true });
    console.log("RESULT", result.status, result.matchReason, (result as { locatorStrategy?: string }).locatorStrategy);
    if (result.status === "resolved" && result.locator) {
      const tag = await result.locator.evaluate((el: Element) => el.tagName.toLowerCase());
      console.log("RESOLVED_TAG", tag, await result.locator.getAttribute("id"));
      assert.equal(tag, "a");
    } else {
      assert.fail(`not resolved: ${result.status} ${result.matchReason}`);
    }
  } finally {
    await browser.close();
  }
});
