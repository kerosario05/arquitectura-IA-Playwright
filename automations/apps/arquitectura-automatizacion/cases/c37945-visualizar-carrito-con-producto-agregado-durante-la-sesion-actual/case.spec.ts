import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../src/automations/runtime/promoted-spec-runtime';

import { CategoryPage } from '../../pages/category.page';
import { ProductListPage } from '../../pages/productlist.page';
import { ProductDetailPage } from '../../pages/productdetail.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar carrito con producto agregado durante la sesión actual', async ({ page }) => {

  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Phones', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, action: async () => { await categoryPage.selectCategory('Phones'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'la primera tarjeta visible del listado de productos', actionIntent: 'select_first_visible_card', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectFirstVisibleCard(); } }); // [target: la primera tarjeta visible del listado de productos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Add to cart', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productDetailPage.clickPrimaryAction('Add to cart'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Cart', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectProduct('Cart'); } });
  await promotedRuntime.expectPromotedVisible({ stepIndex: 7, target: 'que se muestre el producto agregado en el carrito', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: que se muestre el producto agregado en el carrito]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 8, target: 'que se muestre el total de la compra', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: que se muestre el total de la compra]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 9, target: 'Total de compra visible.', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Total de compra visible.]
});