import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductInformationPage } from '../../../../pages/productinformation.page';
import { ProductListPage } from '../../../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar detalle del primer deposito a plazo', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'C0';
  process.env.SCENARIO_TITLE = 'Visualizar detalle del primer deposito a plazo';


  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const productListPage = new ProductListPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await productListPage.selectProduct('Iniciar'); };
  const replayStep_4 = async () => { await productListPage.selectProduct('Información de productos'); };
  const replayStep_5 = async () => { await productListPage.selectProduct('Depósitos a Plazo'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productos', actionIntent: 'open_product_information', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductInformationPage', action: async () => { await productInformationPage.openProductInformation(); } }); // [target: Información de productos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Depósitos a Plazo', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'Información de productos', sensitive: false, replay: replayStep_4 }], lastSelectionStep: { stepIndex: 4, selectedTarget: 'Información de productos' },  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Depósitos a Plazo'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Seleccionar el primer producto visible del listado.', actionIntent: 'select_visible_item_by_ordinal', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'Información de productos', sensitive: false, replay: replayStep_4 }, { stepIndex: 5, actionIntent: 'select_product', target: 'Depósitos a Plazo', sensitive: false, replay: replayStep_5 }], action: async () => { await productListPage.selectVisibleItemByOrdinal("first", "producto"); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});