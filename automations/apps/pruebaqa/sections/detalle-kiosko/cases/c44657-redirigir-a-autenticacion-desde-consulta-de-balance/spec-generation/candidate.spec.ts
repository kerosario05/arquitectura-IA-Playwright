import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('C44657 - Redirigir a autenticacion desde Consulta de balance', async ({ page }) => {
  process.env.APP_SLUG = 'pruebaqa';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44657';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Consulta de balance';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Consulta de balance',
      assertion: async () => {
        await expect(page.getByText('Consulta de balance')).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Consulta de balance',
      actionIntent: 'open balance consultation',
      expectedEffect: 'navigate to the authentication gate for the kiosk',
      action: async () => {
        await page.getByText('Consulta de balance').click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Consulta de balance dirige al mecanismo de autenticacion del kiosco.');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Consulta de balance dirige al mecanismo de autenticacion del kiosco.',
      assertion: async () => {
        await expect(page.getByText('Consulta de balance')).toBeVisible();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});