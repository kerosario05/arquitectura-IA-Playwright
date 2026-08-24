import { expect, test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { ProductListPage } from '../../../../pages/productlist.page';

process.env.APP_SLUG = 'arquitectura-automatizacion';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-002';
process.env.SCENARIO_TITLE = 'Redirigir al mÃ³dulo de informaciÃ³n desde explora nuestros productos';

test('PREVIEW-002 - Redirigir al mÃ³dulo de informaciÃ³n desde explora nuestros productos', async ({ page }) => {
  const homePage = new HomePage(page);
  const productListPage = new ProductListPage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'click',
      expectedEffect: 'abrir el flujo inicial',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'explora nuestros productos',
      actionIntent: 'click',
      expectedEffect: 'abrir el listado de productos',
      action: async () => {
        await page.getByText('explora nuestros productos').click();
      },
    });

    await promotedRuntime.selectPromotedItem({
      stepIndex: 2,
      target: 'el primer elemento visible del listado',
      action: async () => {
        await productListPage.selectProduct('Depósitos a plazo');
      },
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'mÃ³dulo de informaciÃ³n');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'mÃ³dulo de informaciÃ³n',
      assertion: async () => {
        await expect(page).toHaveURL(/https:\/\/172\.27\.4\.50\/product-subcategory\?category=certificates/);
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});