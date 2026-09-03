import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('Redirigir a autenticacion al seleccionar Canje de Puntos', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44725';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion al seleccionar Canje de Puntos';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Canje de Puntos',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Canje de Puntos',
      actionIntent: 'select the Canje de Puntos option',
      expectedEffect: 'navigate to the kiosk authentication gate',
      action: async () => {
        await page.getByText('Canje de Puntos').click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Canje de Puntos redirige a la autenticacion del kiosco.',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Canje de Puntos redirige a la autenticacion del kiosco.');
        const authGate = detectAuthGate(await scanCurrentPage(page));
        expect(authGate).toBeTruthy();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});