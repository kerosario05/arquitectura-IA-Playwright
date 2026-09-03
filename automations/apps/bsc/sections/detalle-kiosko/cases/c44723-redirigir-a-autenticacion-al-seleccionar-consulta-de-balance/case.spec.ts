import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';

test('Redirigir a autenticacion al seleccionar Consulta de balance', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44723';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion al seleccionar Consulta de balance';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Consulta de balance',
      assertion: async () => {
        await expect(page.getByText('Consulta de balance')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Consulta de balance',
      actionIntent: 'select balance inquiry option',
      expectedEffect: 'navigate to the kiosk authentication gate',
      action: async () => {
        await page.getByText('Consulta de balance').click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Consulta de balance redirige a la autenticacion del kiosco.',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Consulta de balance redirige a la autenticacion del kiosco.');
        const authGate = detectAuthGate(await scanCurrentPage(page));
        expect(authGate?.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});