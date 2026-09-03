import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-002';
process.env.SCENARIO_TITLE = 'Redirigir a autenticación al seleccionar Estados de cuenta';

test('Redirigir a autenticación al seleccionar Estados de cuenta', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Estados de cuenta',
      actionIntent: 'Clic en "Estados de cuenta".',
      expectedEffect: 'La opción Estados de cuenta conduce al mecanismo de autenticación del kiosco.',
      action: async () => {
        await page.getByText('Estados de cuenta').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(1, 'pantalla de autenticación del kiosco');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'pantalla de autenticación del kiosco',
      assertion: async () => {
        await expect(page.getByText('pantalla de autenticación del kiosco')).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});