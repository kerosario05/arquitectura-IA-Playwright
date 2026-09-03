import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('Seleccionar Canje de Puntos y observar redirecci\u00f3n a autenticaci\u00f3n', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44719';
  process.env.SCENARIO_TITLE = 'Seleccionar Canje de Puntos y observar redirecci\u00f3n a autenticaci\u00f3n';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Canje de Puntos',
      actionIntent: 'seleccionar la opci\u00f3n Canje de Puntos',
      expectedEffect: 'disparar la navegaci\u00f3n hacia autenticaci\u00f3n',
      action: async () => {
        await page.getByText('Canje de Puntos', { exact: true }).click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'La opci\u00f3n dirige al l\u00edmite observable de autenticaci\u00f3n del kiosco.');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'La opci\u00f3n dirige al l\u00edmite observable de autenticaci\u00f3n del kiosco.',
      assertion: async () => {
        await expect(page).toHaveURL('https://172.27.4.50/client-identification');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
