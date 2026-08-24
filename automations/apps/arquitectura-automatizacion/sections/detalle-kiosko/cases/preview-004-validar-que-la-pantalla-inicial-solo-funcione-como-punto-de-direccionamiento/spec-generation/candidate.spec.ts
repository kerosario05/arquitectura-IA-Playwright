import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';

test('PREVIEW-004 - Validar que la pantalla inicial solo funcione como punto de direccionamiento', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-004';
  process.env.SCENARIO_TITLE = 'Validar que la pantalla inicial solo funcione como punto de direccionamiento';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Navegar desde la pantalla inicial',
      expectedEffect: 'Abrir la siguiente vista de direccionamiento',
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

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'explora nuestros productos',
      assertion: async () => {
        await expect(page.getByText('explora nuestros productos')).toBeVisible();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'transacciones y servicios',
      assertion: async () => {
        await expect(page.getByText('transacciones y servicios')).toBeVisible();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});