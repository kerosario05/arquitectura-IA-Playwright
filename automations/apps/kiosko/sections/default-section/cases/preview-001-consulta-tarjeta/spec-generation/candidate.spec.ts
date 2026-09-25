import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { ProductListPage } from '../../../../pages/productlist.page';
import { CategoryPage } from '../../../../pages/category.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Consulta Tarjeta', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'kiosko';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Consulta Tarjeta';


  const productListPage = new ProductListPage(page);
  const categoryPage = new CategoryPage(page);
  const operationsMenuPage = new OperationsMenuPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_2 = async () => { await productListPage.selectProduct('Explora nuestros productos'); };
  const replayStep_3 = async () => { await productListPage.selectProduct('Tarjetas'); };
  const replayStep_4 = async () => { await productListPage.selectProduct('Tarjeta de Crédito'); };
  const replayStep_5 = async () => { await productListPage.selectProduct('Tarjeta Crédito Visa Clásica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en línea con disponibilidad inmediata.'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 2, target: 'Explora nuestros productos', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Explora nuestros productos'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Tarjetas', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 2, actionIntent: 'select_product', target: 'Explora nuestros productos', sensitive: false, replay: replayStep_2 }], lastSelectionStep: { stepIndex: 2, selectedTarget: 'Explora nuestros productos' },  expectedOwnerPage: 'CategoryPage', action: async () => { await categoryPage.selectCategory('Tarjetas'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Tarjeta de Crédito', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 2, actionIntent: 'select_product', target: 'Explora nuestros productos', sensitive: false, replay: replayStep_2 }, { stepIndex: 3, actionIntent: 'select_product', target: 'Tarjetas', sensitive: false, replay: replayStep_3 }], lastSelectionStep: { stepIndex: 2, selectedTarget: 'Explora nuestros productos' },  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Tarjeta de Crédito'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Tarjeta Crédito Visa Clásica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en línea con disponibilidad inmediata.', actionIntent: 'open_module', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 2, actionIntent: 'select_product', target: 'Explora nuestros productos', sensitive: false, replay: replayStep_2 }, { stepIndex: 3, actionIntent: 'select_product', target: 'Tarjetas', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'Tarjeta de Crédito', sensitive: false, replay: replayStep_4 }], lastSelectionStep: { stepIndex: 2, selectedTarget: 'Explora nuestros productos' },  expectedOwnerPage: 'ProductListPage', action: async () => { await operationsMenuPage.openModule('Tarjeta Crédito Visa Clásica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en línea con disponibilidad inmediata.'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Finalizar sesión', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 2, actionIntent: 'select_product', target: 'Explora nuestros productos', sensitive: false, replay: replayStep_2 }, { stepIndex: 3, actionIntent: 'select_product', target: 'Tarjetas', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'Tarjeta de Crédito', sensitive: false, replay: replayStep_4 }, { stepIndex: 5, actionIntent: 'select_product', target: 'Tarjeta Crédito Visa Clásica Programa Puntos Santa Cruz por cada RD$100 o UD$3.00 generas un (1) Punto Santa Cruz. Pagos en línea con disponibilidad inmediata.', sensitive: false, replay: replayStep_5 }], lastSelectionStep: { stepIndex: 2, selectedTarget: 'Explora nuestros productos' }, lastSelectionReplay: async () => { await productListPage.selectProduct('Explora nuestros productos'); }, expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.clickPrimaryAction('Finalizar sesión'); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});