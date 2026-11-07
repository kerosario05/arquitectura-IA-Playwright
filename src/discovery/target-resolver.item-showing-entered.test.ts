import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { resolveActionTarget } from "./target-resolver";
import type { PageSnapshot } from "../types/page-snapshot.types";

// Mock of the "add related person" dialog: one card per person, each a button whose text is run data.
const dialog = `
<div role="dialog">
  <button type="button" id="company" onclick="this.dataset.picked='1'"><div><span>ROQUE SRL</span></div><span>985647123 · Prospecto principal</span><span>Persona Jurídica</span></button>
  <button type="button" id="person" onclick="this.dataset.picked='1'"><div><span>JOHN JOHN DOE DOE</span></div><span>402-2467955-1 · Socio</span><span>Persona Física</span></button>
  <button type="button" id="confirm">Confirmar</button>
</div>`;

function snapshot(url: string): PageSnapshot {
  return {
    version: "1.0", capturedAt: new Date().toISOString(), url, title: "fixture",
    summary: { totalElements: 1, buttons: 3, links: 0, inputs: 0, selects: 0, tables: 0, dialogs: 1, headings: 0 },
    elements: [{ id: "e0", type: "button", tagName: "button", text: "x", accessibleName: "x", visible: true, disabled: false, candidateLocators: [], dataHints: [] }],
  } as PageSnapshot;
}

async function resolve(values: string[] | undefined, dynamic = true, identity?: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(dialog);
    const result = await resolveActionTarget(page, snapshot(page.url()), "recorded control", {
      actionType: "action_click", recordingActionType: "click", dynamicTargetLabel: dynamic,
      ...(values ? { runEnteredValues: values } : {}),
      ...(identity ? { recordedControlIdentity: identity } : {}),
    });
    if (result.status === "resolved" && result.locator) {
      await result.locator.click();
      const picked = await page.locator("[data-picked]").evaluateAll((nodes) => nodes.map((node) => node.id));
      return { strategy: result.locatorStrategy, picked };
    }
    return { strategy: result.locatorStrategy, picked: [] as string[] };
  } finally {
    await browser.close();
  }
}

test("mock: the card that shows the values this run entered is the target", async () => {
  const result = await resolve(["ROQUE SRL", "985647123"]);
  assert.equal(result.strategy, "item_showing_entered_values");
  assert.deepEqual(result.picked, ["company"]);
});

test("mock: another run's values select the other card", async () => {
  const result = await resolve(["JOHN JOHN DOE DOE"]);
  assert.deepEqual(result.picked, ["person"]);
});

test("mock: without entered values nothing is guessed", async () => {
  const result = await resolve(undefined);
  assert.notEqual(result.strategy, "item_showing_entered_values");
  assert.deepEqual(result.picked, []);
});

test("mock: two cards each showing one entered value: the one showing the most recently entered value is the target", async () => {
  assert.deepEqual((await resolve(["ROQUE SRL", "JOHN JOHN DOE DOE"])).picked, ["person"]);
  assert.deepEqual((await resolve(["JOHN JOHN DOE DOE", "ROQUE SRL"])).picked, ["company"]);
});

test("mock: on a tie the card closest to the recorded control identity wins over the most recent value", async () => {
  const identity = "abc123|ROQUE SRL985647123 · Prospecto principalPendiente de creaciónPersona Juridica";
  assert.deepEqual((await resolve(["ROQUE SRL", "JOHN JOHN DOE DOE"], true, identity)).picked, ["company"]);
  const other = "abc123|JOHN JOHN DOE DOE402-2467955-1 · SocioPersona Física";
  assert.deepEqual((await resolve(["JOHN JOHN DOE DOE", "ROQUE SRL"], true, other)).picked, ["person"]);
});

test("mock: a card showing more of the entered values wins over a more recent single value", async () => {
  const result = await resolve(["ROQUE SRL", "985647123", "JOHN JOHN DOE DOE"]);
  assert.deepEqual(result.picked, ["company"]);
});

test("mock: a click that is not a dynamic-label item never uses entered values", async () => {
  const result = await resolve(["ROQUE SRL"], false);
  assert.notEqual(result.strategy, "item_showing_entered_values");
  assert.deepEqual(result.picked, []);
});
