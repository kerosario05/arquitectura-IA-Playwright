import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';

process.env.APP_SLUG = 'portalempresarial';
process.env.SECTION_SLUG = 'automatizacion-1';
process.env.SCENARIO_ID = 'C44757';
process.env.SCENARIO_TITLE = 'Login satisfactorio';

test.describe('C44757 - Login satisfactorio', () => {
  test('Login satisfactorio', async ({ page }) => {
    const promotedRuntime = createPromotedSpecRuntime(page);
    const readAuthGateState = async () => {
      const scannedPage = await scanCurrentPage(page);
      return detectAuthGate(scannedPage);
    };

    try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
      await promotedRuntime.fillPromotedField({ stepIndex: 1, target: 'RNC de la empresa', value: process.env.APP_COMPANY_IDENTIFIER ?? '', action: async () => {
        await page.getByLabel('RNC de la empresa').fill(process.env.APP_COMPANY_IDENTIFIER ?? '');
      } });

      await promotedRuntime.fillPromotedField({ stepIndex: 2, target: 'Nombre de usuario', value: process.env.APP_USERNAME ?? '', action: async () => {
        await page.getByLabel('Nombre de usuario').fill(process.env.APP_USERNAME ?? '');
      } });

      await promotedRuntime.fillPromotedField({ stepIndex: 3, target: 'ContraseÃ±a', value: process.env.APP_PASSWORD ?? '', action: async () => {
        await page.getByLabel('Contraseña').fill(process.env.APP_PASSWORD ?? '');
      } });

      await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Continuar', actionIntent: 'submit the login form', expectedEffect: 'trigger the login navigation transition', action: async () => {
        await page.getByRole('button', { name: 'Continuar' }).click();
      } });
      await promotedRuntime.waitForPromotedUiStable(4, 'Continuar');
      await promotedRuntime.expectPromotedVisible({ stepIndex: 4, target: 'Continuar', polarity: 'positive', assertion: async () => {
        expect(page.url()).toContain('https://172.27.4.31/login');
      } });

      await promotedRuntime.waitForPromotedUiStable(5, 'Esperar que finalice el proceso de autenticación.');
      await promotedRuntime.expectPromotedVisible({ stepIndex: 5, target: 'Esperar que finalice el proceso de autenticación.', polarity: 'positive', assertion: async () => {
        expect(await readAuthGateState()).toBeTruthy();
      } });

      await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Salir', actionIntent: 'click the Salir control', expectedEffect: 'leave the authenticated landing screen', action: async () => {
        await page.getByRole('button', { name: 'Salir' }).click();
      } });
      await promotedRuntime.waitForPromotedUiStable(6, 'Validar que el formulario de acceso ya no sea la pantalla activa.');
      await promotedRuntime.expectPromotedVisible({ stepIndex: 7, target: 'Validar que el formulario de acceso ya no sea la pantalla activa.', polarity: 'positive', assertion: async () => {
        expect(page.url()).toContain('https://172.27.4.31/dashboard');
      } });

      await promotedRuntime.waitForPromotedUiStable(7, 'Validar que se muestre la pantalla inicial autenticada del aplicativo.');
      await promotedRuntime.expectPromotedVisible({ stepIndex: 8, target: 'Validar que se muestre la pantalla inicial autenticada del aplicativo.', polarity: 'positive', assertion: async () => {
        expect(await readAuthGateState()).toBeTruthy();
      } });
    } finally {
      await promotedRuntime.finishEvidence();
    }
  });
});
