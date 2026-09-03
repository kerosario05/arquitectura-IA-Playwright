import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { ProductListPage } from '../../../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Seleccionar Cartas y certificaciones y observar redirección a autenticación', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44718';
  process.env.SCENARIO_TITLE = 'Seleccionar Cartas y certificaciones y observar redirección a autenticación';


  const productListPage = new ProductListPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 2, target: 'Cartas y certificaciones', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Cartas y certificaciones'); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});