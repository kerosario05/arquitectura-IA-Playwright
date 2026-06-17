import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductInformationPage } from '../../../../pages/productinformation.page';
import { ProductDetailPage } from '../../../../pages/productdetail.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Validar visualización de las categorías principales de productos', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'C0';
  process.env.SCENARIO_TITLE = 'Validar visualización de las categorías principales de productos';


  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const productDetailPage = new ProductDetailPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await productListPage.selectProduct('Iniciar'); };
  const replayStep_4 = async () => { await productListPage.selectProduct('Información de productos'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productos', actionIntent: 'open_product_information', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductInformationPage', action: async () => { await productInformationPage.openProductInformation(); } }); // [target: Información de productos]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 5, target: 'Tarjetas de crédito', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Tarjetas de crédito]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 6, target: 'Depósitos a Plazo', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Depósitos a Plazo]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 7, target: 'Cuentas de Efectivo', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Cuentas de Efectivo]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 8, target: 'Préstamos', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Préstamos]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 9, target: 'Solicitar', assertion: async () => { await productDetailPage.clickPrimaryAction('Solicitar'); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});