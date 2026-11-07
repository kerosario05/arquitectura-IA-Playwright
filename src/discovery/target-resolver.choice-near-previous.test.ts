import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";
import type { PageSnapshot } from "../types/page-snapshot.types";

// Mock of a worklist form: every question row repeats Sí/No, and the recorded ids carry a per-case number.
const rows = [1, 2, 3, 4].map((n) => `
<div class="row" id="row${n}">
  <label class="q" id="q${n}">¿Pregunta ${n}?</label>
  <div><input type="radio" name="g${n}" id="radio99${n}yes"><label for="radio99${n}yes">Si</label>
       <input type="radio" name="g${n}" id="radio99${n}no"><label for="radio99${n}no">No</label></div>
</div>`).join("");
const html = `<h1 id="title">Formulario</h1>${rows}`;

function snapshot(url: string): PageSnapshot {
  return {
    version: "1.0", capturedAt: new Date().toISOString(), url, title: "fixture",
    summary: { totalElements: 1, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
    elements: [{ id: "e0", type: "button", tagName: "button", text: "x", accessibleName: "x", visible: true, disabled: false, candidateLocators: [], dataHints: [] }],
  } as PageSnapshot;
}

async function resolveNo(previousSelector: string | undefined) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const result = await resolveActionTarget(page, snapshot(page.url()), "No", {
      actionType: "action_click", recordingActionType: "click",
      recordedTechnicalTargetRefs: ["role:radio|No", "css:#radio7144778no", "id:radio7144778no"],
      ...(previousSelector ? { previousClickedLocator: page.locator(previousSelector) } : {}),
    });
    if (result.status === "resolved" && result.locator) {
      await result.locator.click();
      const checked = await page.locator("input:checked").evaluateAll((nodes) => nodes.map((node) => node.id));
      return { status: result.status, strategy: result.locatorStrategy, checked };
    }
    return { status: result.status, strategy: result.locatorStrategy, checked: [] as string[] };
  } finally {
    await browser.close();
  }
}

test("mock: the choice repeated in every row resolves to the row of the previous click", async () => {
  const result = await resolveNo("#q3");
  assert.equal(result.status, "resolved");
  assert.equal(result.strategy, "choice_near_previous_click");
  assert.deepEqual(result.checked, ["radio993no"]);
});

test("mock: without a previous click the repeated choice stays unresolved", async () => {
  const result = await resolveNo(undefined);
  assert.notEqual(result.strategy, "choice_near_previous_click");
  assert.deepEqual(result.checked, []);
});

test("mock: a previous click outside every row is a tie and stays unresolved", async () => {
  const result = await resolveNo("#title");
  assert.notEqual(result.strategy, "choice_near_previous_click");
  assert.deepEqual(result.checked, []);
});
