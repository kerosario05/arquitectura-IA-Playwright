import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from '@playwright/test';
import { fillAndObserveRuntimeInput } from './case-discovery';
import { resolveFillTarget } from './target-resolver';
import type { PageSnapshot } from '../types/page-snapshot.types';

test('verification digit name variants preserve explicit digit identity in the shared fill resolver', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [recorded, current] of [
      ['Please enter verification code. Digit 1', 'OTP digit 1'],
      ['Código de verificación. Dígito 2', 'Verification code digit 2'],
    ]) {
      await page.setContent(`<input aria-label="${current}" maxlength="1"><input aria-label="OTP digit 6" maxlength="1">`);
      const result = await resolveFillTarget(page, { url: page.url(), elements: [] } as unknown as PageSnapshot, recorded, undefined,
        { associatedField: recorded, recordedTechnicalTargetRefs: [`role:textbox|${recorded}`] });
      assert.equal(result.status, 'resolved');
      assert.ok(result.locator);
      assert.equal(await result.locator.getAttribute('aria-label'), current);
      await result.locator.fill('4');
      assert.equal(await page.getByLabel(current, { exact: true }).inputValue(), '4');
      assert.equal(await page.getByLabel('OTP digit 6', { exact: true }).inputValue(), '');
    }
    await page.setContent('<input aria-label="OTP digit 1"><input aria-label="OTP digit 1">');
    const ambiguous = await resolveFillTarget(page, { url: page.url(), elements: [] } as unknown as PageSnapshot, 'Please enter verification code. Digit 1');
    assert.notEqual(ambiguous.status, 'resolved');
    await page.setContent('<input aria-label="OTP digit 1" readonly><input aria-label="Document digit 1">');
    const readonly = await resolveFillTarget(page, { url: page.url(), elements: [] } as unknown as PageSnapshot, 'Please enter verification code. Digit 1');
    assert.notEqual(readonly.status, 'resolved');
    await page.setContent('<input aria-label="OTP digit 10"><input aria-label="Document digit 1">');
    const wrongDigit = await resolveFillTarget(page, { url: page.url(), elements: [] } as unknown as PageSnapshot, 'OTP digit 1');
    assert.notEqual(wrongDigit.status, 'resolved');
    await page.setContent('<input aria-label="Nombre">');
    const ordinary = await resolveFillTarget(page, { url: page.url(), elements: [] } as unknown as PageSnapshot, 'Nombre');
    assert.equal(ordinary.status, 'resolved');
  } finally { await browser.close(); }
});


test('resolved verification digits commit keyboard state before the recorded submit; ordinary inputs keep atomic fill', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const label of ['OTP digit 1', 'C\u00f3digo de verificaci\u00f3n. D\u00edgito 2']) {
      await page.setContent(`<input aria-label="${label}" maxlength="1" value="8"><input aria-label="Document digit 1"><button>Submit</button><output></output>
        <script>(() => {
          let committed = false;
          const field = document.querySelector('input');
          field.addEventListener('keyup', event => { if (/^[0-9]$/.test(event.key)) committed = true; });
          document.querySelector('button').onclick = () => {
            document.querySelector('output').textContent = committed ? 'request-dispatched' : 'model-incomplete';
          };
          window.ordinaryKeyboardEvents = 0;
          document.querySelectorAll('input')[1].addEventListener('keydown', () => window.ordinaryKeyboardEvents++);
        })();</script>`);
      const resolved = await resolveFillTarget(page, { url: page.url(), elements: [] } as unknown as PageSnapshot, label);
      assert.equal(resolved.status, 'resolved');
      await resolved.locator!.fill('4');
      await page.getByRole('button').click();
      assert.equal(await page.locator('output').textContent(), 'model-incomplete');
      await fillAndObserveRuntimeInput({ page, locator: resolved.locator!, value: '4', stepIndex: 1 });
      assert.equal(await resolved.locator!.inputValue(), '4');
      await page.getByRole('button').click();
      assert.equal(await page.locator('output').textContent(), 'request-dispatched');
      await fillAndObserveRuntimeInput({ page, locator: page.getByLabel('Document digit 1'), value: '3', stepIndex: 2 });
      assert.equal(await page.getByLabel('Document digit 1').inputValue(), '3');
      assert.equal(await page.evaluate(() => (window as any).ordinaryKeyboardEvents), 0);
    }
  } finally { await browser.close(); }
});
