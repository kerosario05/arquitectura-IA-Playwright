import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductListPage } from '../../../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Redirigir al modulo de informacion desde Explora nuestros productos', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-004';
  process.env.SCENARIO_TITLE = 'Redirigir al modulo de informacion desde Explora nuestros productos';


  const homePage = new HomePage(page);
  const productListPage = new ProductListPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_2 = async () => { await productListPage.selectProduct('Iniciar'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 2, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Explora nuestros productosConoce sobre los beneficios de los productos BSC', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 2, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_2 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Explora nuestros productosConoce sobre los beneficios de los productos BSC'); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});