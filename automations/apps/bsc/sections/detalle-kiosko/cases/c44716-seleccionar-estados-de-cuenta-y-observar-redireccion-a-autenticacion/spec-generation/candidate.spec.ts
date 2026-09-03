import { expect, test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('Seleccionar Estados de cuenta y observar redirección a autenticación', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44716';
  process.env.SCENARIO_TITLE = 'Seleccionar Estados de cuenta y observar redirección a autenticación';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Estados de cuenta',
      actionIntent: 'Seleccionar la opción de Estados de cuenta',
      expectedEffect: 'Navegar al límite observable de autenticación del kiosco',
      action: async () => {
        await page.getByText('Estados de cuenta', { exact: true }).click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Estados de cuenta',
      assertion: async () => {
        await expect(page).toHaveURL('https://172.27.4.50/client-identification');
      }
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'La opción dirige al límite observable de autenticación del kiosco.');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'La opción dirige al límite observable de autenticación del kiosco.',
      assertion: async () => {
        await expect(page).toHaveURL('https://172.27.4.50/client-identification');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});