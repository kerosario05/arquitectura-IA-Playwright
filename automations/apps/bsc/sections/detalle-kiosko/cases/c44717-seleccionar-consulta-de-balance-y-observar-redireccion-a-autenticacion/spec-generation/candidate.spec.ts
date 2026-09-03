import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'C44717';
process.env.SCENARIO_TITLE = 'Seleccionar Consulta de balance y observar redirecci\u00f3n a autenticaci\u00f3n';

test('C44717 - Seleccionar Consulta de balance y observar redirecci\u00f3n a autenticaci\u00f3n', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Consulta de balance',
      actionIntent: 'Seleccionar la opci\u00f3n de consulta de balance',
      expectedEffect: 'Navegar hacia el l\u00edmite observable de autenticaci\u00f3n del kiosco',
      action: async () => {
        await page.getByText('Consulta de balance', { exact: true }).click();
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
