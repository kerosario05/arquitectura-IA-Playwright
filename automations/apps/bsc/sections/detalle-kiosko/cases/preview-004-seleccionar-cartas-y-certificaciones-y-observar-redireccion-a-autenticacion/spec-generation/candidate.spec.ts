import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-004';
process.env.SCENARIO_TITLE = 'Seleccionar Cartas y certificaciones y observar redirección a autenticación';

test('PREVIEW-004 - Seleccionar Cartas y certificaciones y observar redirección a autenticación', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Cartas y certificaciones',
      actionIntent: 'click',
      expectedEffect: 'open the selected kiosk section',
      action: async () => {
        await page.getByText('Cartas y certificaciones', { exact: true }).click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'pantalla de autenticación del kiosco',
      assertion: async () => {
        await expect(page.getByText('pantalla de autenticación del kiosco', { exact: true })).toBeVisible();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
