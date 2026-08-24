import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';

test('Iniciar autenticación al seleccionar Transacciones y servicios', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Iniciar autenticación al seleccionar Transacciones y servicios';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Iniciar la experiencia desde la pantalla principal.',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: '¿Qué deseas realizar hoy?',
      assertion: async () => {
        await expect(page.getByText('¿Qué deseas realizar hoy?')).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Transacciones y servicios',
      actionIntent: 'Clic en "Transacciones y servicios".',
      expectedEffect: 'Avanzar hacia el flujo de autenticación.',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'autenticación');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'autenticación',
      assertion: async () => {
        const current = await scanCurrentPage(page);
        const authGate = await detectAuthGate(current);
        expect(authGate?.stage).toBe('identification_type_selection');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
