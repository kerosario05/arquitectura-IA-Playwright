import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { ProductListPage } from '../../../../pages/productlist.page';

process.env.APP_SLUG = 'arquitectura-automatizacion';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Redirigir al modulo de informacion desde Explora nuestros productos';

test('PREVIEW-001 Redirigir al modulo de informacion desde Explora nuestros productos', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);
  const productListPage = new ProductListPage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Abrir el flujo principal desde la pagina inicial',
      expectedEffect: 'La vista inicial queda activa para continuar con la exploracion de productos',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'Abrir el modulo de exploracion de productos',
      expectedEffect: 'Se muestra el listado de productos disponibles',
      action: async () => {
        await page.getByText('Explora nuestros productos', { exact: true }).click();
      },
    });

    await promotedRuntime.selectPromotedItem({
      stepIndex: 2,
      target: 'el primer elemento visible del listado',
      action: async () => {
        await productListPage.selectProduct('Depósitos a plazo');
      },
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'módulo de información');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'módulo de información',
      assertion: async () => {
        await expect(page).toHaveURL(/product-subcategory\?category=certificates/);
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});