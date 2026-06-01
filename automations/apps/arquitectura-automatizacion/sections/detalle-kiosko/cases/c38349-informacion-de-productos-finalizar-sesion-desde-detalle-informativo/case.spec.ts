import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductInformationPage } from '../../../../pages/productinformation.page';
import { CategoryPage } from '../../../../pages/category.page';
import { ProductListPage } from '../../../../pages/productlist.page';
import { ProductDetailPage } from '../../../../pages/productdetail.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Información de productos - Finalizar sesión desde detalle informativo', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);
  const productDetailPage = new ProductDetailPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await homePage.start(); };
  const replayStep_4 = async () => { await productInformationPage.openProductInformation(); };
  const replayStep_7 = async () => { await productListPage.selectVisibleItemByOrdinal('first'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productos', actionIntent: 'open_product_information', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductInformationPage', action: async () => { await productInformationPage.openProductInformation(); } }); // [target: Información de productos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Tarjetas', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_product_information', target: 'Información de productos', sensitive: false, replay: replayStep_4 }], lastSelectionStep: { stepIndex: 4, selectedTarget: 'Información de productos' },  expectedOwnerPage: 'CategoryPage', action: async () => { await categoryPage.selectCategory('Tarjetas'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Tarjeta de Crédito', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_product_information', target: 'Información de productos', sensitive: false, replay: replayStep_4 }], lastSelectionStep: { stepIndex: 4, selectedTarget: 'Información de productos' },  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Tarjeta de Crédito'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 7, target: 'Seleccionar el primer tarjeta visible del listado.', actionIntent: 'select_visible_item_by_ordinal', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_product_information', target: 'Información de productos', sensitive: false, replay: replayStep_4 }], action: async () => { await productListPage.selectVisibleItemByOrdinal("first"); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 8, target: 'Finalizar sesión', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_product_information', target: 'Información de productos', sensitive: false, replay: replayStep_4 }, { stepIndex: 7, actionIntent: 'select_visible_item_by_ordinal', target: 'el primer tarjeta visible del listado', sensitive: false, replay: replayStep_7 }], lastSelectionStep: { stepIndex: 7, selectedTarget: 'el primer tarjeta visible del listado' }, lastSelectionReplay: async () => { await productListPage.selectVisibleItemByOrdinal('first'); }, expectedOwnerPage: 'ProductListPage', action: async () => { await productDetailPage.clickPrimaryAction('Finalizar sesión'); } });
});