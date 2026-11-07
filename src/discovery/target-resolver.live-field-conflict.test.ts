import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { liveFieldConflictsWithRecorded } from "./target-resolver";

// Mock of the failing job: the recorded id `#v-1-3114` is minted per load and now belongs to a number input.
const page = `
<div><label for="v-1-3114">Cantidad de empleados</label><input id="v-1-3114" type="number" placeholder="0"></div>
<div><label for="v-1-9000">Actividad de la Sociedad</label><input id="v-1-9000" type="text"></div>
<input id="bare" type="text">`;

async function conflict(selector: string, field: string | undefined, refs: string[]): Promise<boolean> {
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage();
    await tab.setContent(page);
    return await liveFieldConflictsWithRecorded(tab.locator(selector), field, refs);
  } finally {
    await browser.close();
  }
}

test("mock: a number input where a text box was recorded is a conflict", async () => {
  assert.equal(await conflict("#v-1-3114", undefined, ["role:textbox|Actividad de la Sociedad", "css:#v-1-3114"]), true);
});

test("mock: a field whose labels never relate to the recorded field is a conflict", async () => {
  assert.equal(await conflict("#v-1-3114", "Actividad de la Sociedad", []), true);
});

test("mock: the field carrying the recorded label is not a conflict", async () => {
  assert.equal(await conflict("#v-1-9000", "Actividad de la Sociedad", ["role:textbox|Actividad de la Sociedad"]), false);
});

test("mock: a control with no readable label is never rejected", async () => {
  assert.equal(await conflict("#bare", "Actividad de la Sociedad", []), false);
});

test("mock: a recorded spin button accepts a number input", async () => {
  assert.equal(await conflict("#v-1-3114", "Cantidad de empleados", ["role:spinbutton|Cantidad de empleados"]), false);
});
