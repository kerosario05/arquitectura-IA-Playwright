export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = "kiosko";
process.env.SECTION_SLUG = "default-section";
process.env.SCENARIO_ID = "PREVIEW-001";
process.env.SCENARIO_TITLE = "Kiosko2";

test('Kiosko2', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: "Explora nuestros productos",
      actionIntent: "Presionar \"Explora nuestros productos\"",
      expectedEffect: "Continuar al catálogo de productos",
      action: async () => {
        await page.getByText("Explora nuestros productos", { exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: "Tarjetas",
      actionIntent: "Presionar \"Tarjetas\"",
      expectedEffect: "Abrir la categoría Tarjetas",
      action: async () => {
        await page.getByText("Tarjetas", { exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: "Tarjeta de CrÃ©dito",
      actionIntent: "Presionar \"Tarjeta de CrÃ©dito\"",
      expectedEffect: "Mostrar las tarjetas de crédito",
      action: async () => {
        await page.getByText("Tarjeta de CrÃ©dito", { exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: "Tarjeta CrÃ©dito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 dÃ­as despuÃ©s de la fe",
      actionIntent: "Presionar \"Tarjeta CrÃ©dito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 dÃ­as despuÃ©s de la fe\"",
      expectedEffect: "La aplicación carga su pantalla inicial",
      action: async () => {
        await page.getByText("Tarjeta CrÃ©dito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 dÃ­as despuÃ©s de la fe", { exact: true }).click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(4, "Tarjeta CrÃ©dito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 dÃ­as despuÃ©s de la fe");
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: "Tarjeta CrÃ©dito Visa Gold Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Mayor plazo para pagar: 26 dÃ­as despuÃ©s de la fe",
      polarity: "positive",
      expectedUrl: "https://172.27.4.50/",
      assertion: async () => {
        await expect(page).toHaveURL("https://172.27.4.50/");
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 5,
      target: "Finalizar sesiÃ³n",
      actionIntent: "Presionar \"Finalizar sesiÃ³n\"",
      expectedEffect: "Finalizar la sesión",
      action: async () => {
        await page.getByText("Finalizar sesiÃ³n", { exact: true }).click();
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
