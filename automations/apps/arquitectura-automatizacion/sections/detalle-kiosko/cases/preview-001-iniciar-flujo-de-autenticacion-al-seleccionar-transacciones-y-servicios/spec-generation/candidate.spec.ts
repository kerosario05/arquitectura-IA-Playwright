import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';
import { HomePage } from '../../../../pages/home.page';

test('PREVIEW-001 - Iniciar flujo de autenticacion al seleccionar Transacciones y servicios', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Iniciar flujo de autenticacion al seleccionar Transacciones y servicios';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Iniciar el flujo desde la pantalla principal',
      expectedEffect: 'Abrir el flujo de autenticacion',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'autenticación',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(0, 'autenticación');
        const pageDiag = await scanCurrentPage(page);
        const authGate = detectAuthGate(pageDiag);
        expect(authGate?.stage).toBe('identification_type_selection');
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'transacciones y servicios',
      actionIntent: 'Seleccionar transacciones y servicios',
      expectedEffect: 'Avanzar en el flujo visible del kiosko',
      action: async () => {
        await page.getByText('transacciones y servicios').click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'autenticación',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(2, 'autenticación');
        const pageDiag = await scanCurrentPage(page);
        const authGate = detectAuthGate(pageDiag);
        expect(authGate?.stage).toBe('identification_type_selection');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
