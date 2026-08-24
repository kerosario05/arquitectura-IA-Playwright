import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';

test('Validar visualizacion de las opciones principales en la segunda pantalla del kiosco', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-003';
  process.env.SCENARIO_TITLE = 'Validar visualizacion de las opciones principales en la segunda pantalla del kiosco';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'click',
      expectedEffect: 'Open the second kiosk screen',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: '¿Qué deseas realizar hoy?',
      assertion: async () => {
        await expect(page.getByText('¿Qué deseas realizar hoy?')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'Explora nuestros productos',
      assertion: async () => {
        await expect(page.getByText('Explora nuestros productos')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      target: 'Transacciones y servicios',
      assertion: async () => {
        await expect(page.getByText('Transacciones y servicios')).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});