import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createJiraPlaywrightPort } from './jira-semantic-executor';

test('Jira fills the uniquely paired identifier number field when a type option names the fill target', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<form aria-label="Registro">
      <fieldset>
        <label for="identifier-type">Tipo de Identificación</label>
        <select id="identifier-type" name="identifierType">
          <option value="">Seleccione</option><option value="RNC" selected>RNC</option><option value="PASSPORT">Pasaporte</option>
        </select>
        <label for="identifier-number">Número de Identificación</label>
        <input id="identifier-number" name="identifierNumber" placeholder="Ingrese número de identificación">
      </fieldset>
    </form>`);
    const port = createJiraPlaywrightPort(page, 'https://fixture.invalid');

    await port.act({ index: 1, action: 'fill' }, 'RNC', '101234567', 'Ingresar RNC en Tipo de Identificación');
    assert.equal(await page.locator('#identifier-type').inputValue(), 'RNC');
    assert.equal(await page.locator('#identifier-number').inputValue(), '101234567');

    await port.act({ index: 2, action: 'fill' }, 'RNC', 'Pasaporte', 'Ingresar RNC en Tipo de Identificación');
    assert.equal(await page.locator('#identifier-type').inputValue(), 'PASSPORT');
    assert.equal(await page.locator('#identifier-number').inputValue(), '101234567');
    await page.close();

    const ambiguous = await browser.newPage();
    await ambiguous.setContent(`<form aria-label="Registro"><fieldset>
      <label for="identifier-type">Tipo de Identificación</label>
      <select id="identifier-type"><option value="">Seleccione</option><option value="RNC">RNC</option></select>
      <label for="identifier-number-a">Número de Identificación</label><input id="identifier-number-a">
      <label for="identifier-number-b">Número de Identificación</label><input id="identifier-number-b">
    </fieldset></form>`);
    const ambiguousPort = createJiraPlaywrightPort(ambiguous, 'https://fixture.invalid');
    await assert.rejects(
      ambiguousPort.act({ index: 1, action: 'fill' }, 'RNC', '101234567', 'Ingresar RNC en Tipo de Identificación'),
      /JIRA_SELECTION_NOT_CONFIRMED/,
    );
    assert.equal(await ambiguous.locator('#identifier-number-a').inputValue(), '');
    assert.equal(await ambiguous.locator('#identifier-number-b').inputValue(), '');
    await ambiguous.close();
  } finally {
    await browser.close();
  }
});
