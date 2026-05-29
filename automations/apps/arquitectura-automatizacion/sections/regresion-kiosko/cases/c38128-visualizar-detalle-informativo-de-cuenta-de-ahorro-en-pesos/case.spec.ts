import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductInformationPage } from '../../../../pages/productinformation.page';
import { CategoryPage } from '../../../../pages/category.page';
import { ProductListPage } from '../../../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar detalle informativo de cuenta de ahorro en Pesos', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productos', actionIntent: 'open_product_information', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productInformationPage.openProductInformation(); } }); // [target: Información de productos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Cuentas', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, action: async () => { await categoryPage.selectCategory('Cuentas'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Cuenta de Ahorro', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectProduct('Cuenta de Ahorro'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 7, target: 'la primera cuenta visible del listado', actionIntent: 'select_visible_item_by_ordinal', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectVisibleItemByOrdinal("first"); } });
});