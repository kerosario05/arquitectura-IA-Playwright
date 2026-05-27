import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../pages/home.page';
import { ProductInformationPage } from '../../pages/productinformation.page';
import { ProductDetailPage } from '../../pages/productdetail.page';
import { CategoryPage } from '../../pages/category.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar subcategoría de Préstamos', async ({ page }) => {

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const productDetailPage = new ProductDetailPage(page);
  const categoryPage = new CategoryPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productos', actionIntent: 'open_product_information', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productInformationPage.openProductInformation(); } }); // [target: Información de productos]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 5, target: 'Préstamos', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Préstamos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Préstamos', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, action: async () => { await categoryPage.selectCategory('Préstamos'); } });
});