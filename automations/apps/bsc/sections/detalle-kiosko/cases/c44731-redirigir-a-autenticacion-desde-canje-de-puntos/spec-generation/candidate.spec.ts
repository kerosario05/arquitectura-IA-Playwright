import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('C44731 - Redirigir a autenticacion desde Canje de Puntos', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44731';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Canje de Puntos';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Canje de Puntos',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos')).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Canje de Puntos',
      actionIntent: 'abrir la opcion Canje de Puntos',
      expectedEffect: 'navegar hacia la autenticacion del kiosco',
      action: async () => {
        await page.getByText('Canje de Puntos').click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Canje de Puntos redirige a la pantalla de autenticacion.');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Canje de Puntos redirige a la pantalla de autenticacion.',
      assertion: async () => {
        const pageState = await scanCurrentPage(page);
        const authGate = detectAuthGate(pageState);
        expect(authGate.stage).toBe('identification_type_selection');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});