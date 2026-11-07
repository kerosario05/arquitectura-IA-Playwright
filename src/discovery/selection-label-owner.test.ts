import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { clearSelectionOwnerMarker, markSelectionOwnerByLabel, selectionOwnerSelector } from "./selection-label-owner";

/** PrimeVue-like fields: the label is a sibling of the dropdown, with no for/aria link. */
const field = (label: string, value: string) =>
  `<div class="field"><label>${label}</label><div class="p-dropdown" id="d-${label.replace(/\W+/g, "")}"><span role="combobox" aria-label="Seleccione una opción">${value}</span></div></div>`;

const page = `<section>
  ${field("Código referente", "Seleccione una opción")}
  ${field("Destino facilidad", "Seleccione una opción")}
  ${field("Modalidad de desembolso:", "Seleccione una opción")}
  <div class="field"><label>Repetida</label><div class="p-dropdown"><span role="combobox">a</span></div></div>
  <div class="field"><label>Repetida</label><div class="p-dropdown"><span role="combobox">b</span></div></div>
  <div class="row"><label>Doble</label><div class="p-dropdown"><span role="combobox">a</span></div><div class="p-dropdown"><span role="combobox">b</span></div></div>
</section>`;

async function withPage<T>(run: (tab: import("playwright").Page) => Promise<T>): Promise<T> {
  const browser = await chromium.launch();
  try {
    const tab = await (await browser.newContext()).newPage();
    await tab.setContent(page);
    return await run(tab);
  } finally {
    await browser.close();
  }
}

test("each field label resolves to its own dropdown even when every prompt is the same", async () => {
  await withPage(async (tab) => {
    for (const [label, id] of [["Código referente", "d-Cdigoreferente"], ["Destino facilidad", "d-Destinofacilidad"], ["Modalidad de desembolso:", "d-Modalidaddedesembolso"]] as const) {
      const marker = await markSelectionOwnerByLabel(tab, label);
      assert.ok(marker, label);
      assert.equal(await tab.locator(selectionOwnerSelector(marker)).count(), 1);
      assert.equal(await tab.locator(selectionOwnerSelector(marker)).evaluate((element) => element.id), id);
      await clearSelectionOwnerMarker(tab, marker);
      assert.equal(await tab.locator(selectionOwnerSelector(marker)).count(), 0);
    }
  });
});

test("a trailing colon and accents do not matter, but a missing, repeated or shared label is never guessed", async () => {
  await withPage(async (tab) => {
    assert.ok(await markSelectionOwnerByLabel(tab, "modalidad de desembolso"));
    assert.equal(await markSelectionOwnerByLabel(tab, "No existe"), undefined);
    assert.equal(await markSelectionOwnerByLabel(tab, "Repetida"), undefined);
    assert.equal(await markSelectionOwnerByLabel(tab, "Doble"), undefined);
  });
});
