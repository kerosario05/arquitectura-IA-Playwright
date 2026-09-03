import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('PREVIEW-005 - Redirigir a autenticación al seleccionar Canje de Puntos', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-005';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticación al seleccionar Canje de Puntos';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Canje de Puntos',
      actionIntent: 'Seleccionar Canje de Puntos',
      expectedEffect: 'Abrir el flujo de autenticación del kiosco',
      action: async () => {
        await page.getByText('Canje de Puntos').click();
      },
    });

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