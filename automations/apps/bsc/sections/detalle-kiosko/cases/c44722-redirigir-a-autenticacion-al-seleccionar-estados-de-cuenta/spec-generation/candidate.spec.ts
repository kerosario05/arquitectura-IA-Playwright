import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('C44722 - Redirigir a autenticacion al seleccionar Estados de cuenta', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44722';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion al seleccionar Estados de cuenta';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Estados de cuenta',
      assertion: async () => {
        await expect(page.getByText('Estados de cuenta')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Estados de cuenta',
      actionIntent: 'Seleccionar la opcion Estados de cuenta',
      expectedEffect: 'Navegar a la autenticacion del kiosco',
      action: async () => {
        await page.getByText('Estados de cuenta').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Estados de cuenta redirige a la autenticacion del kiosco.');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Estados de cuenta redirige a la autenticacion del kiosco.',
      assertion: async () => {
        const authGate = await detectAuthGate(await scanCurrentPage(page));
        expect(authGate.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});