import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";

test("recorded click on a field caption resolves its unique custom selection trigger when the next recorded action is an option", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <section class="field">
          <span id="caption">Plazo</span>
          <div class="custom-select">
            <span role="combobox" tabindex="0" aria-expanded="false" aria-label=""></span>
            <span class="trigger" aria-hidden="true">⌄</span>
          </div>
          <div role="listbox" hidden>
            <div role="option">12 meses</div>
          </div>
        </section>
      </main>
      <script>
        const owner = document.querySelector('[role="combobox"]');
        const list = document.querySelector('[role="listbox"]');
        owner.addEventListener('click', () => { list.hidden = false; owner.setAttribute('aria-expanded', 'true'); });
      </script>
    `);

    const snapshot = {
      version: "1.0", url: page.url(), title: "", capturedAt: new Date().toISOString(),
      summary: { totalElements: 2, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
      elements: [
        { id: "caption", type: "text", visible: true, tagName: "span", text: "Plazo", label: "Plazo", candidateLocators: [{ strategy: "text", value: "Plazo", exact: true, confidence: 0.9 }], dataHints: [], actionability: "NON_ACTIONABLE" },
        { id: "owner", type: "text", visible: true, tagName: "span", role: "combobox", candidateLocators: [], dataHints: [], actionability: "SEMANTIC_ACTIONABLE", actionOwner: true },
      ],
    } as any;
    const result = await resolveActionTarget(page, snapshot, "Plazo", {
      actionType: "action_click",
      recordingActionType: "click",
      associatedField: "Plazo",
      recordedSelectionSuccessorOptionName: "12 meses",
    } as any);

    assert.equal(result.status, "resolved");
    assert.equal(await result.locator?.getAttribute("role"), "combobox");
    await result.locator!.click();
    assert.equal(await page.getByRole("option", { name: "12 meses", exact: true }).isVisible(), true);
  } finally {
    await browser.close();
  }
});

test("recorded selection trigger fails closed when a caption has multiple compatible controls", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <section class="field">
        <span>Plazo</span>
        <span role="combobox" tabindex="0"></span>
        <span role="combobox" tabindex="0"></span>
      </section>
    `);
    const snapshot = {
      version: "1.0", url: page.url(), title: "", capturedAt: new Date().toISOString(),
      summary: { totalElements: 3, buttons: 0, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 0, headings: 0 },
      elements: [
        { id: "caption", type: "text", visible: true, tagName: "span", text: "Plazo", label: "Plazo", candidateLocators: [{ strategy: "text", value: "Plazo", exact: true, confidence: 0.9 }], dataHints: [], actionability: "NON_ACTIONABLE" },
        { id: "owner-1", type: "text", visible: true, tagName: "span", role: "combobox", candidateLocators: [], dataHints: [], actionability: "SEMANTIC_ACTIONABLE", actionOwner: true },
        { id: "owner-2", type: "text", visible: true, tagName: "span", role: "combobox", candidateLocators: [], dataHints: [], actionability: "SEMANTIC_ACTIONABLE", actionOwner: true },
      ],
    } as any;
    const result = await resolveActionTarget(page, snapshot, "Plazo", {
      actionType: "action_click",
      recordingActionType: "click",
      associatedField: "Plazo",
      recordedSelectionSuccessorOptionName: "12 meses",
    } as any);

    assert.notEqual(result.status, "resolved");
  } finally {
    await browser.close();
  }
});
