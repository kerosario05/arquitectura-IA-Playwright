import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductInformationPage } from '../../../../pages/productinformation.page';
import { CategoryPage } from '../../../../pages/category.page';
import { ProductListPage } from '../../../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar detalle informativo de préstamo personal', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const categoryPage = new CategoryPage(page);
  const productListPage = new ProductListPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await homePage.start(); };
  const replayStep_4 = async () => { await productInformationPage.openProductInformation(); };
  const replayStep_5 = async () => { await categoryPage.selectCategory('Préstamos'); };
  const replayStep_6 = async () => { await categoryPage.selectCategory('Préstamos personales'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productos', actionIntent: 'open_product_information', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductInformationPage', action: async () => { await productInformationPage.openProductInformation(); } }); // [target: Información de productos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Préstamos', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_product_information', target: 'Información de productos', sensitive: false, replay: replayStep_4 }], lastSelectionStep: { stepIndex: 4, selectedTarget: 'Información de productos' },  expectedOwnerPage: 'CategoryPage', action: async () => { await categoryPage.selectCategory('Préstamos'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Préstamos personales', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_product_information', target: 'Información de productos', sensitive: false, replay: replayStep_4 }, { stepIndex: 5, actionIntent: 'select_category', target: 'Préstamos', sensitive: false, replay: replayStep_5 }], lastSelectionStep: { stepIndex: 4, selectedTarget: 'Información de productos' },  expectedOwnerPage: 'CategoryPage', action: async () => { await categoryPage.selectCategory('Préstamos personales'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 7, target: 'el primer préstamo visible del listado', actionIntent: 'select_visible_item_by_ordinal', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_product_information', target: 'Información de productos', sensitive: false, replay: replayStep_4 }, { stepIndex: 5, actionIntent: 'select_category', target: 'Préstamos', sensitive: false, replay: replayStep_5 }, { stepIndex: 6, actionIntent: 'select_category', target: 'Préstamos personales', sensitive: false, replay: replayStep_6 }], action: async () => { await productListPage.selectVisibleItemByOrdinal("first"); } });
});