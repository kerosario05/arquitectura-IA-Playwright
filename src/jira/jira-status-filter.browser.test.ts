import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createJiraPlaywrightPort } from './jira-semantic-executor';

test('bare Jira status action selects the unique observed native status filter', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <label>Estado de solicitud
          <select aria-label="Estado de solicitud" onchange="document.body.dataset.filter=this.value">
            <option value="">Todos los estados</option>
            <option value="draft">Borrador</option>
            <option value="escalated">Escalado</option>
          </select>
        </label>
        <table><tbody>
          <tr><td>Solicitud 1</td><td>Borrador</td></tr>
          <tr><td>Solicitud 2</td><td>Borrador</td></tr>
        </tbody></table>
      </main>`);

    const port = createJiraPlaywrightPort(page, 'https://fixture.invalid');
    const durable = await port.act({ index: 1, action: 'click', description: 'Presionar "Borrador"' }, 'Borrador');

    assert.equal(await page.getByRole('combobox', { name: 'Estado de solicitud', exact: true }).inputValue(), 'draft');
    assert.equal(await page.locator('body').getAttribute('data-filter'), 'draft');
    assert.deepEqual(durable, { strategy: 'css', value: '[aria-label="Estado de solicitud"]' });
  } finally {
    await browser.close();
  }
});

test('an exact status button remains a click even when a status filter is present', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <label>Estado <select aria-label="Estado">
          <option>Todos los estados</option><option>Borrador</option>
        </select></label>
        <button type="button" onclick="document.body.dataset.action='opened'">Borrador</button>
      </main>`);

    const port = createJiraPlaywrightPort(page, 'https://fixture.invalid');
    await port.act({ index: 1, action: 'click', description: 'Presionar "Borrador"' }, 'Borrador');

    assert.equal(await page.locator('body').getAttribute('data-action'), 'opened');
    assert.equal(await page.getByRole('combobox', { name: 'Estado', exact: true }).inputValue(), 'Todos los estados');
  } finally {
    await browser.close();
  }
});

test('multiple observed status filters do not provide a locator fallback', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <main>
        <label>Estado <select aria-label="Estado">
          <option>Todos los estados</option><option>Escalado</option>
        </select></label>
        <label>Estado de revisión <select aria-label="Estado de revisión">
          <option>Todos los estados</option><option>Escalado</option>
        </select></label>
        <table><tbody><tr><td>Escalado</td></tr></tbody></table>
      </main>`);

    const port = createJiraPlaywrightPort(page, 'https://fixture.invalid');
    await assert.rejects(
      port.act({ index: 1, action: 'click', description: 'Presionar "Escalado"' }, 'Escalado'),
      /JIRA_TARGET_NOT_FOUND|JIRA_TARGET_AMBIGUOUS|JIRA_DURABLE_TARGET_UNRESOLVED/,
    );
    assert.equal(await page.getByRole('combobox', { name: 'Estado', exact: true }).inputValue(), 'Todos los estados');
    assert.equal(await page.getByRole('combobox', { name: 'Estado de revisión', exact: true }).inputValue(), 'Todos los estados');
  } finally {
    await browser.close();
  }
});
