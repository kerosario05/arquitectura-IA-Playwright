import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';
import { HomePage } from '../../../../pages/home.page';

test('PREVIEW-005 - Iniciar autenticacion desde Transacciones y servicios', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-005';
  process.env.SCENARIO_TITLE = 'Iniciar autenticacion desde Transacciones y servicios';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Iniciar el flujo desde la pantalla principal.',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: '¿Qué deseas realizar hoy?',
      assertion: async () => {
        await expect(page.getByText('¿Qué deseas realizar hoy?', { exact: true })).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'transacciones y servicios',
      actionIntent: 'Clic en "transacciones y servicios".',
      expectedEffect: 'Abrir la entrada observada de transacciones y servicios.',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'autenticación');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'autenticación',
      assertion: async () => {
        const authGateState = await detectAuthGate(await scanCurrentPage(page));
        expect(authGateState).toBeTruthy();
        expect(String((authGateState as { stage?: string }).stage ?? '')).toBe('identification_type_selection');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
