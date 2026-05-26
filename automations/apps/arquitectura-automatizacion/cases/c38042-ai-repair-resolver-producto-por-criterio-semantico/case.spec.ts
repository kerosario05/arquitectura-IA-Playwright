import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../src/automations/runtime/promoted-spec-runtime';

import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('AI Repair - Resolver producto por criterio semántico', async ({ page }) => {

  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Laptops', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectProduct('Laptops'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'MacBook air', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productDetailPage.clickPrimaryAction('MacBook air'); } });
});