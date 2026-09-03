import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('PREVIEW-004 - Redirigir a autenticación al seleccionar Cartas y certificaciones', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-004';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticaciÃ³n al seleccionar Cartas y certificaciones';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Cartas y certificaciones',
      actionIntent: 'Seleccionar la opción Cartas y certificaciones',
      expectedEffect: 'Iniciar la redirección al flujo de autenticación del kiosco',
      action: async () => {
        await page.getByText('Cartas y certificaciones', { exact: true }).click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'pantalla de autenticaciÃ³n del kiosco',
      assertion: async () => {
        await expect(page.getByText('pantalla de autenticaciÃ³n del kiosco', { exact: true })).toBeVisible();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
