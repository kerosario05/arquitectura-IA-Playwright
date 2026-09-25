import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "@playwright/test";
import { extractRuntimeUiSnapshot } from "./runtime-knowledge-extractor";

test("captures grid row/cell/header context for editors", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <style>table { width: 800px; } td, th { width: 200px; height: 30px; }</style>
      <table aria-label="Colaboradores">
        <thead><tr><th>Tipo</th><th>Correo electrónico</th><th>Monto</th></tr></thead>
        <tbody><tr data-id="row-1">
          <td><select aria-label="Indicar..."><option>analista</option></select></td>
          <td><input placeholder="Indicar..." aria-label="Indicar..." /></td>
          <td><select aria-label="DOP"></select><input placeholder="campo" /></td>
        </tr></tbody>
      </table>
    `);
    const snapshot = await extractRuntimeUiSnapshot(page);
    assert.equal(snapshot.gridMetadata?.detected, true);
    assert.ok((snapshot.gridMetadata?.rows ?? 0) >= 2);
    assert.ok((snapshot.gridMetadata?.cells ?? 0) >= 3);
    assert.deepEqual(snapshot.gridMetadata?.headers, ["Tipo", "Correo electrónico", "Monto"]);
    const editors = snapshot.observedControls.filter((control) => control.rowIdentity === "row-1");
    assert.ok(editors.length >= 4);
    assert.ok(editors.some((control) => control.headerContext === "Correo electrónico"));
    assert.ok(editors.some((control) => control.headerContext === "Monto"));
    assert.ok(snapshot.gridMetadata?.headerRelationships.some((item) => item.header === "Monto"));
  } finally {
    await browser.close();
  }
});
