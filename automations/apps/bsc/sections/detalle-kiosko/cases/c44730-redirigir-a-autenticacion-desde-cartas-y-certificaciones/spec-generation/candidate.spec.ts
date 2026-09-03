import { expect, test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('C44730 - Redirigir a autenticacion desde Cartas y certificaciones', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44730';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Cartas y certificaciones';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Cartas y certificaciones',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Cartas y certificaciones',
      actionIntent: 'open Cartas y certificaciones',
      expectedEffect: 'navigate to the authentication gate',
      action: async () => {
        await page.getByText('Cartas y certificaciones').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Cartas y certificaciones redirige a la pantalla de autenticacion.');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Cartas y certificaciones redirige a la pantalla de autenticacion.',
      assertion: async () => {
        const pageDiag = await scanCurrentPage(page);
        const authGate = await detectAuthGate(pageDiag);
        expect(authGate?.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});