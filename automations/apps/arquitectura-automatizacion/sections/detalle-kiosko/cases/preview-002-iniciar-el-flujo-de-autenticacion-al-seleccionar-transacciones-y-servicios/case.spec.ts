import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';
import { HomePage } from '../../../../pages/home.page';

test('PREVIEW-002 Iniciar el flujo de autenticacion al seleccionar Transacciones y servicios', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-002';
  process.env.SCENARIO_TITLE = 'Iniciar el flujo de autenticacion al seleccionar Transacciones y servicios';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Iniciar el flujo de autenticacion',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Transacciones y servicios',
      actionIntent: 'Clic en "Transacciones y servicios".',
      expectedEffect: 'Seleccionar Transacciones y servicios',
      action: async () => {
        await page.getByText('Transacciones y servicios', { exact: true }).click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'flujo de autenticacion',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(2, 'flujo de autenticacion');
        const authGate = await detectAuthGate(await scanCurrentPage(page));
        expect(authGate).toBeTruthy();
        expect(authGate?.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});