import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../pages/home.page';
import { ProductInformationPage } from '../../pages/productinformation.page';
import { CategoryPage } from '../../pages/category.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar acción Solicitar en el detalle del producto', async ({ page }) => {

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const categoryPage = new CategoryPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productos', actionIntent: 'open_product_information', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productInformationPage.openProductInformation(); } }); // [target: Información de productos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Tarjetas', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, action: async () => { await categoryPage.selectCategory('Tarjetas'); } });
});