import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';
import { HomePage } from '../../../../pages/home.page';

test('PREVIEW-003 - Iniciar el flujo de autenticacion al seleccionar Transacciones y servicios', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-003';
  process.env.SCENARIO_TITLE = 'Iniciar el flujo de autenticacion al seleccionar Transacciones y servicios';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Abrir la experiencia inicial observada durante el descubrimiento.',
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
      target: 'transacciones y servicios',
      actionIntent: 'Clic en "transacciones y servicios".',
      expectedEffect: 'Disparar el inicio del flujo de autenticacion observado durante el descubrimiento.',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'autenticación',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(3, 'autenticación');
        const authGate = detectAuthGate(await scanCurrentPage(page));
        await expect(authGate?.detected).toBeTruthy();
        await expect(authGate?.stage).toBe('identification_type_selection');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
