import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'kiosko';
process.env.SECTION_SLUG = 'default-section';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Tarjeta';

test('PREVIEW-001 - Tarjeta', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'Presionar Explora nuestros productos',
      expectedEffect: 'Abrir la sección de productos',
      action: async () => {
        await page.getByLabel('Explora nuestros productos').click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Tarjetas',
      actionIntent: 'Presionar Tarjetas',
      expectedEffect: 'Abrir la categoría Tarjetas',
      action: async () => {
        await page.getByRole('button', { name: 'Tarjetas', exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'Tarjeta de Crédito',
      actionIntent: 'Presionar Tarjeta de Crédito',
      expectedEffect: 'Abrir la categoría Tarjeta de Crédito',
      action: async () => {
        await page.getByRole('button', { name: 'Tarjeta de Crédito', exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'Tarjeta Crédito Visa Clásica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en línea con disponibilidad inmediata.',
      actionIntent: 'Presionar la tarjeta de crédito Visa Clásica',
      expectedEffect: 'Abrir el detalle de la tarjeta seleccionada',
      action: async () => {
        await page.getByAltText('Tarjeta Crédito Visa Clásica', { exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 5,
      target: 'Finalizar sesión',
      actionIntent: 'Presionar Finalizar sesión',
      expectedEffect: 'Cargar la pantalla inicial',
      action: async () => {
        await page.getByRole('button', { name: 'Finalizar sesión', exact: true }).click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(5, 'Finalizar sesión');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      target: 'Finalizar sesión',
      polarity: "positive",
      expectedUrl: 'https://172.27.4.50/',
      assertion: async () => {
        await expect(page).toHaveURL('https://172.27.4.50/');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
