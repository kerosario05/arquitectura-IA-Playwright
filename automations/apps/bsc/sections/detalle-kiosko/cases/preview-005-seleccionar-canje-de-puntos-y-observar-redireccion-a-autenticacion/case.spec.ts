import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('Seleccionar Canje de Puntos y observar redirección a autenticación', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-005';
  process.env.SCENARIO_TITLE = 'Seleccionar Canje de Puntos y observar redirección a autenticación';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Canje de Puntos',
      actionIntent: 'click',
      expectedEffect: 'open authentication flow',
      action: async () => {
        await page.getByText('Canje de Puntos', { exact: true }).click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'pantalla de autenticación del kiosco',
      assertion: async () => {
        await expect(page.getByText('pantalla de autenticación del kiosco', { exact: true })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});