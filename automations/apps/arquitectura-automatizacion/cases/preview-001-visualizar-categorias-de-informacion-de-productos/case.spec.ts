import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../pages/home.page';
import { ProductInformationPage } from '../../pages/productinformation.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar categorías de Información de productos', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await productListPage.selectProduct('Iniciar'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productos', actionIntent: 'open_product_information', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductInformationPage', action: async () => { await productInformationPage.openProductInformation(); } }); // [target: Información de productos]
});