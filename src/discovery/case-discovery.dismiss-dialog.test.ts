import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { dismissObstructingDialog } from "./case-discovery";

// Mock of an upload dialog whose own close control is an icon-only button (name from aria-label, no text).
const page = `
<button id="outside">Guardar</button>
<div role="dialog" id="dlg">
  <p>Documentos</p>
  <button aria-label="Cerrar" id="close" onclick="document.getElementById('dlg').remove()"><svg width="10" height="10"></svg></button>
</div>`;

async function run(nextTarget: string) {
  const browser = await chromium.launch({ headless: true });
  try {
    const tab = await browser.newPage();
    await tab.setContent(page);
    const dismissed = await dismissObstructingDialog(tab, nextTarget);
    const stillOpen = await tab.locator("#dlg").count();
    return { dismissed, stillOpen };
  } finally {
    await browser.close();
  }
}

test("mock: the next step is the dialog's own icon-only close control, so the dialog is left open for it", async () => {
  const result = await run("Cerrar");
  assert.equal(result.dismissed, false);
  assert.equal(result.stillOpen, 1);
});

test("mock: an unnamed next step (placeholder target) may be a control of the dialog, so the dialog is left open", async () => {
  const result = await run("recorded control");
  assert.equal(result.dismissed, false);
  assert.equal(result.stillOpen, 1);
});

test("mock: the next step is outside the dialog, so the single obstructing dialog is dismissed", async () => {
  const result = await run("Guardar");
  assert.equal(result.dismissed, true);
  assert.equal(result.stillOpen, 0);
});
