export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { ProductListPage } from '../../../../pages/productlist.page';
import { CategoryPage } from '../../../../pages/category.page';

process.env.APP_SLUG = "kiosko";
process.env.SECTION_SLUG = "default-section";
process.env.SCENARIO_ID = "PREVIEW-001";
process.env.SCENARIO_TITLE = "Consulta prestamo";

test("PREVIEW-001 - Consulta prestamo", async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);
  const productListPage = new ProductListPage(page);
  const categoryPage = new CategoryPage(page);

  try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: "Explora nuestros productos",
      actionIntent: "click",
      expectedEffect: "abrir productos",
      action: async () => {
        await productListPage.clickPrimaryAction("Explora nuestros productos");
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: "Préstamos",
      actionIntent: "click",
      expectedEffect: "abrir categoría de préstamos",
      action: async () => {
        await categoryPage.selectCategory("Préstamos");
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: "Préstamo Personal",
      actionIntent: "click",
      expectedEffect: "cargar pantalla inicial",
      action: async () => {
        await productListPage.selectProduct("Préstamo Personal");
      }
    });
    await promotedRuntime.waitForPromotedUiStable(3, "Préstamo Personal");
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: "Préstamo Personal",
      polarity: "positive",
      expectedUrl: "https://172.27.4.50/",
      assertion: async () => {
        await expect(page).toHaveURL("https://172.27.4.50/");
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: "Finalizar sesión",
      actionIntent: "click",
      expectedEffect: "finalizar sesión",
      action: async () => {
        await productListPage.clickPrimaryAction("Finalizar sesión");
      }
    });
      await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
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
