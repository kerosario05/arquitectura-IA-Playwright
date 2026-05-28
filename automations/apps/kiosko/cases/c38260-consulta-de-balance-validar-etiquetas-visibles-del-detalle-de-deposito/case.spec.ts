import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../pages/home.page';
import { ProductDetailPage } from '../../pages/productdetail.page';
import { ProductListPage } from '../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Consulta de balance - Validar etiquetas visibles del detalle de depósito', async ({ page }) => {

  const homePage = new HomePage(page);
  const productDetailPage = new ProductDetailPage(page);
  const productListPage = new ProductListPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Transacciones y servicios', actionIntent: 'open_home', expectedEffect: 'ui_change', sensitive: false, action: async () => { await homePage.open(); } }); // [target: Transacciones y servicios]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 5, target: 'Consulta de balance', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Consulta de balance]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Consulta de balance', actionIntent: 'open_home', expectedEffect: 'ui_change', sensitive: false, action: async () => { await homePage.open(); } }); // [target: Consulta de balance]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 7, target: 'Depósitos a plazos', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Depósitos a plazos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 8, target: 'Depósitos a plazos', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, action: async () => { await productListPage.selectProduct('Depósitos a plazos'); } });
});