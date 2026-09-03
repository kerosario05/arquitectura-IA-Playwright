import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('C44746 - Redirigir a autenticaci\u00f3n al seleccionar Estados de cuenta', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44746';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticaci\u00f3n al seleccionar Estados de cuenta';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Estados de cuenta',
      actionIntent: 'select the account statements option',
      expectedEffect: 'open the kiosk authentication flow',
      action: async () => {
        await page.getByText('Estados de cuenta', { exact: true }).click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'La opci\u00f3n Estados de cuenta conduce al mecanismo de autenticaci\u00f3n del kiosco.');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'La opci\u00f3n Estados de cuenta conduce al mecanismo de autenticaci\u00f3n del kiosco.',
      assertion: async () => {
        await expect(page.getByText('La opci\u00f3n Estados de cuenta conduce al mecanismo de autenticaci\u00f3n del kiosco.', { exact: true })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});