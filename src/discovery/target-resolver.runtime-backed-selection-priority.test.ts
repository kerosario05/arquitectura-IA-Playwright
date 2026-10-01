import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";

test("runtime-backed recorded selection resolves its field before generic owner locator", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <table><thead><tr><th>Moneda</th></tr></thead><tbody><tr><td>
        <select id="currency"><option value="">Moneda</option><option value="DOP">DOP</option></select>
      </td></tr></tbody></table>
    `);

    const result = await resolveActionTarget(page, { elements: [] } as any, "Moneda", {
      actionType: "action_select",
      recordingActionType: "select",
      selectionField: "Moneda",
      selectionValue: "DOP",
      associatedField: "Moneda",
      rowScope: 1,
      recordedTechnicalTargetRefs: ["css:#currency"],
    });

    assert.equal(result.status, "resolved");
    assert.equal(result.locatorStrategy, "grid_cell_selection_control");
    assert.equal(await result.locator!.getAttribute("id"), "currency");
  } finally {
    await browser.close();
  }
});
