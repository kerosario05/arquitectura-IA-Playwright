import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-002';
process.env.SCENARIO_TITLE = 'Seleccionar Estados de cuenta y observar redirección a autenticación';

test('PREVIEW-002 Seleccionar Estados de cuenta y observar redirección a autenticación', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Estados de cuenta',
      actionIntent: 'click',
      expectedEffect: 'navegar al límite observable de autenticación del kiosco',
      action: async () => {
        await page.getByText('Estados de cuenta', { exact: true }).click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(0, 'Estados de cuenta');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'Estados de cuenta',
      assertion: async () => {
        await expect(page).toHaveURL(/https:\/\/172\.27\.4\.50\/client-identification/);
      },
    });

    await promotedRuntime.waitForPromotedUiStable(1, 'pantalla de autenticación del kiosco');

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