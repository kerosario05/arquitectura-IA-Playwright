import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';
import { HomePage } from '../../../../pages/home.page';

process.env.APP_SLUG = 'arquitectura-automatizacion';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Iniciar autenticación desde Transacciones y servicios';

test('PREVIEW-001 - Iniciar autenticación desde Transacciones y servicios', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Iniciar la autenticación desde la pantalla principal',
      expectedEffect: 'Abrir el acceso al flujo de autenticación',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'autenticación',
      assertion: async () => {
        const pageState = await scanCurrentPage(page);
        const authGate = await detectAuthGate(pageState);
        expect(authGate).toBeTruthy();
        expect(authGate?.stage).toBe('identification_type_selection');
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Transacciones y servicios',
      actionIntent: 'Abrir el acceso a Transacciones y servicios',
      expectedEffect: 'Cambiar el contexto hacia el flujo de autenticación',
      action: async () => {
        await page.getByText('Transacciones y servicios').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'autenticación');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'autenticación',
      assertion: async () => {
        const pageState = await scanCurrentPage(page);
        const authGate = await detectAuthGate(pageState);
        expect(authGate).toBeTruthy();
        expect(authGate?.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});