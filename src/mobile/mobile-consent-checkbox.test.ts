import { test } from "node:test";
import assert from "node:assert/strict";
import { ensureConsentCheckboxChecked } from "./mobile-consent-checkbox";

// Registro screen of the user's app: a document-type choice (two checkable options) and the
// terms acceptance row, with "Continuar" disabled until the terms are accepted.
const xml = (termsChecked: boolean) => `<?xml version="1.0"?><hierarchy>
<android.view.ViewGroup checkable="true" checked="true" content-desc="Cédula" resource-id="registro-tipo-cedula" bounds="[45,1000][620,1120]"/>
<android.view.ViewGroup checkable="true" checked="false" content-desc="Pasaporte" resource-id="registro-tipo-pasaporte" bounds="[650,1000][1227,1120]"/>
<android.view.ViewGroup checkable="true" checked="${termsChecked}" content-desc="He leído y acepto los Términos y condiciones y la Política de datos personales." resource-id="registro-terminos" bounds="[45,1498][1227,1603]"/>
<android.widget.Button content-desc="Continuar" enabled="${termsChecked}" bounds="[45,2480][1227,2600]"/>
</hierarchy>`;

test("solo marca la casilla de consentimiento y no la vuelve a pulsar", async () => {
  let termsChecked = false;
  const clicked: string[] = [];
  const gestures: unknown[] = [];
  const browser = {
    getPageSource: async () => xml(termsChecked),
    pause: async () => undefined,
    $: async (selector: string) => ({
      isExisting: async () => true,
      click: async () => {
        clicked.push(selector);
        if (selector.includes("acepto") || selector.includes("registro-terminos")) termsChecked = true;
      },
    }),
    execute: async (_script: string, args: unknown) => { gestures.push(args); },
  } as unknown as WebdriverIO.Browser;

  const result = await ensureConsentCheckboxChecked(browser);

  assert.equal(result.ticked.length, 1);
  assert.match(result.ticked[0], /acepto/);
  assert.ok(clicked.every((selector) => !/Pasaporte|Cédula|pasaporte|cedula/.test(selector)), `pulsó una opción de documento: ${clicked.join(" | ")}`);
  assert.equal(gestures.length, 0, "no debe volver a pulsar la fila (la desmarcaría)");
  assert.equal(termsChecked, true);
});
