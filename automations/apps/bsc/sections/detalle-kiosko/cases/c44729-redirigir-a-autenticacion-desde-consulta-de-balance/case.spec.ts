import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'C44729';
process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Consulta de balance';

test('C44729 - Redirigir a autenticacion desde Consulta de balance', async ({ page }) => {
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
      actionIntent: 'open balance inquiry',
      expectedEffect: 'navigate to the balance inquiry flow',
      action: async () => {
        await page.getByText('Consulta de balance').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Consulta de balance redirige a la pantalla de autenticacion.');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Consulta de balance redirige a la pantalla de autenticacion.',
      assertion: async () => {
        const authGate = await detectAuthGate(await scanCurrentPage(page));
        if (!authGate || authGate.stage !== 'identification_type_selection') {
          throw new Error('Expected identification_type_selection auth gate stage');
        }
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});