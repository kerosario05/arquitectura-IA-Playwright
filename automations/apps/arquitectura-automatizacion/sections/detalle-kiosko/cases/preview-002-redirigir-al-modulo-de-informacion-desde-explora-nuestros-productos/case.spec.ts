import { expect, test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { ProductListPage } from '../../../../pages/productlist.page';

test('PREVIEW-002 Redirigir al módulo de información desde explora nuestros productos', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-002';
  process.env.SCENARIO_TITLE = 'Redirigir al módulo de información desde explora nuestros productos';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);
  const productListPage = new ProductListPage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Iniciar the flow from the home page',
      expectedEffect: 'Open the product exploration entry point',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'explora nuestros productos',
      actionIntent: 'Open the product exploration section',
      expectedEffect: 'Navigate to the product list',
      action: async () => {
        await page.getByText('explora nuestros productos', { exact: true }).click();
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
        await expect(page).toHaveURL(/https:\/\/172\.27\.4\.50\/product-subcategory\?category=certificates/);
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});