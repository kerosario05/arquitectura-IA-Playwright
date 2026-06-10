import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductDetailPage } from '../../../../pages/productdetail.page';
import { ProductListPage } from '../../../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar el detalle de un producto publicado', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'C0';
  process.env.SCENARIO_TITLE = 'Visualizar el detalle de un producto publicado';


  const homePage = new HomePage(page);
  const productDetailPage = new ProductDetailPage(page);
  const productListPage = new ProductListPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await productListPage.selectProduct('Iniciar'); };
  const replayStep_4 = async () => { await productListPage.selectProduct('Información de productosExplora nuestros productos bancarios'); };
  const replayStep_5 = async () => { await productListPage.selectVisibleItemByOrdinal('first', 'producto'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Información de productosExplora nuestros productos bancarios', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductDetailPage', action: async () => { await productDetailPage.clickPrimaryAction('Información de productosExplora nuestros productos bancarios'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Seleccionar el primer producto visible del listado.', actionIntent: 'select_visible_item_by_ordinal', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'Información de productosExplora nuestros productos bancarios', sensitive: false, replay: replayStep_4 }], action: async () => { await productListPage.selectVisibleItemByOrdinal("first", "producto"); } });
  await promotedRuntime.expectPromotedVisible({ stepIndex: 6, target: 'Beneficios', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Beneficios]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 7, target: 'Tasas', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Tasas]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 8, target: 'Información legal o notas aclaratorias', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Información legal o notas aclaratorias]
  await promotedRuntime.expectPromotedVisible({ stepIndex: 9, target: 'Solicitar', assertion: async () => { await productDetailPage.clickPrimaryAction('Solicitar'); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});