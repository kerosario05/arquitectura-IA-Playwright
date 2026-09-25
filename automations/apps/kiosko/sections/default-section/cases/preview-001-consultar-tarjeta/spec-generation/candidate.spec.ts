import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'kiosko';
process.env.SECTION_SLUG = 'default-section';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Consultar Tarjeta';

test('Consultar Tarjeta', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'click',
      expectedEffect: 'Abrir la sección de productos',
      action: async () => {
        await page.getByLabel('Explora nuestros productos').click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Tarjetas',
      actionIntent: 'click',
      expectedEffect: 'Mostrar la categoría Tarjetas',
      action: async () => {
        await page.getByRole('button', { name: 'Tarjetas', exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'Tarjeta de CrÃ©dito',
      actionIntent: 'click',
      expectedEffect: 'Mostrar las tarjetas de crédito',
      action: async () => {
        await page.getByRole('button', { name: 'Tarjeta de CrÃ©dito', exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'Tarjeta CrÃ©dito Visa ClÃ¡sica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en lÃ­nea con disponibilidad inmediata.',
      actionIntent: 'click',
      expectedEffect: 'Cargar la pantalla inicial',
      action: async () => {
        await page.locator('div').filter({ has: page.locator('img[alt="Tarjeta CrÃ©dito Visa ClÃ¡sica"][src="/assets/images/tarjetas-de-credito-visa-clasica.png"]') }).click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(4, 'Tarjeta CrÃ©dito Visa ClÃ¡sica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en lÃ­nea con disponibilidad inmediata.');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'Tarjeta CrÃ©dito Visa ClÃ¡sica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en lÃ­nea con disponibilidad inmediata.',
      polarity: 'positive',
      expectedUrl: 'https://172.27.4.50/',
      assertion: async () => {
        await expect(page).toHaveURL('https://172.27.4.50/');
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 5,
      target: 'Finalizar sesiÃ³n',
      actionIntent: 'click',
      expectedEffect: 'Finalizar la sesión',
      action: async () => {
        await page.getByRole('button', { name: 'Finalizar sesiÃ³n', exact: true }).click();
      }
    });
      await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      target: "Finalizar sesión",
      polarity: "positive",
      expectedUrl: "https://172.27.4.50/",
      assertion: async () => {
        await expect(page).toHaveURL("https://172.27.4.50/");
      },
    });

} finally {
    await promotedRuntime.finishEvidence();
  }
});
