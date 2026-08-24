import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';
import { HomePage } from '../../../../pages/home.page';

process.env.APP_SLUG = 'arquitectura-automatizacion';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-003';
process.env.SCENARIO_TITLE = 'Iniciar el flujo de autenticaci\u00f3n desde transacciones y servicios';

test('PREVIEW-003 - Iniciar el flujo de autenticaci\u00f3n desde transacciones y servicios', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Iniciar el flujo de autenticaci\u00f3n desde transacciones y servicios.',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(0, 'autenticaci\u00f3n');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'autenticaci\u00f3n',
      assertion: async () => {
        const authGate = detectAuthGate(await scanCurrentPage(page));
        expect(authGate.stage).toBe('identification_type_selection');
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'transacciones y servicios',
      actionIntent: 'Clic en "transacciones y servicios".',
      expectedEffect: 'Mantener el flujo de autenticaci\u00f3n en la ruta observada.',
      action: async () => {
        await page.getByText('transacciones y servicios', { exact: false }).click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'autenticaci\u00f3n');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'autenticaci\u00f3n',
      assertion: async () => {
        const authGate = detectAuthGate(await scanCurrentPage(page));
        expect(authGate.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});