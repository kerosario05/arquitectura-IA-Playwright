import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';
import { ProductDetailPage } from '../../../../pages/productdetail.page';
import { ProductListPage } from '../../../../pages/productlist.page';
import { AuthFlow, setAuthFlowTestData } from '../../../../flows/auth.flow';
import { resolvePromotedSpecAuthDataFromEnv } from '../../../../flows/auth.flow.helpers';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Consulta de balance - Visualizar detalle de depósito a plazo activo', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  const homePage = new HomePage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const productDetailPage = new ProductDetailPage(page);
  const productListPage = new ProductListPage(page);
    const authFlow = new AuthFlow(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await homePage.start(); };
  const replayStep_4 = async () => { await operationsMenuPage.openModule('Transacciones y servicios'); };
  const replayStep_7 = async () => { await productListPage.selectProduct('Depósitos a plazos'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Transacciones y servicios', actionIntent: 'open_module', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await operationsMenuPage.openModule('Transacciones y servicios'); } });
  
    setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());
    const authFlowResult = await authFlow.ensureAuthenticated({
      alias: 'defaultClient',
      landing: 'transactions_menu',
    });
    if (!authFlowResult.success) {
      throw new Error(`auth_flow_failed_in_promoted_spec: ${authFlowResult.error || 'unknown_error'}`);
    }
  
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Consulta de balance', actionIntent: 'open_module', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_module', target: 'Transacciones y servicios', sensitive: false, replay: replayStep_4 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await operationsMenuPage.openModule('Consulta de balance'); } });
  await promotedRuntime.expectPromotedVisible({ stepIndex: 6, target: 'Depósitos a plazos', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Depósitos a plazos]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 7, target: 'Depósitos a plazos', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_module', target: 'Transacciones y servicios', sensitive: false, replay: replayStep_4 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Depósitos a plazos'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 8, target: 'Seleccionar el primer depósito visible del listado.', actionIntent: 'select_visible_item_by_ordinal', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'start_session', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'open_module', target: 'Transacciones y servicios', sensitive: false, replay: replayStep_4 }, { stepIndex: 7, actionIntent: 'select_product', target: 'Depósitos a plazos', sensitive: false, replay: replayStep_7 }], action: async () => { await productListPage.selectVisibleItemByOrdinal("first"); } });
});