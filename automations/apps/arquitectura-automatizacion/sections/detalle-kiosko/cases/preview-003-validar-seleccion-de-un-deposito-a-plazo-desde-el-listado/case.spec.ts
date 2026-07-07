import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';
import { ProductListPage } from '../../../../pages/productlist.page';
import { AuthFlow, setAuthFlowTestData } from '../../../../flows/auth.flow';
import { resolvePromotedSpecAuthDataFromEnv } from '../../../../flows/auth.flow.helpers';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Validar selección de un depósito a plazo desde el listado', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'C0';
  process.env.SCENARIO_TITLE = 'Validar selección de un depósito a plazo desde el listado';


  const homePage = new HomePage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const productListPage = new ProductListPage(page);
    const authFlow = new AuthFlow(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await productListPage.selectProduct('Iniciar'); };
  const replayStep_4 = async () => { await productListPage.selectProduct('transacciones y servicios'); };
  const replayStep_5 = async () => { await productListPage.selectProduct('consulta de balance'); };
  const replayStep_6 = async () => { await productListPage.selectProduct('Depósitos a PlazosConsulta tus depósitos a plazos'); };
  const replayStep_7 = async () => { await productListPage.selectProduct('depósito a plazo'); };

    setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());
    const authFlowResult = await authFlow.ensureAuthenticated({
      alias: 'defaultClient',
      landing: 'transactions_menu',
    });
    if (!authFlowResult.success) {
      throw new Error(`auth_flow_failed_in_promoted_spec: ${authFlowResult.error || 'unknown_error'}`);
    }
  
  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'transacciones y servicios', actionIntent: 'open_module', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await operationsMenuPage.openModule('transacciones y servicios'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'consulta de balance', actionIntent: 'open_module', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'transacciones y servicios', sensitive: false, replay: replayStep_4 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await operationsMenuPage.openModule('consulta de balance'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Depósitos a PlazosConsulta tus depósitos a plazos', actionIntent: 'open_module', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'transacciones y servicios', sensitive: false, replay: replayStep_4 }, { stepIndex: 5, actionIntent: 'select_product', target: 'consulta de balance', sensitive: false, replay: replayStep_5 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await operationsMenuPage.openModule('Depósitos a PlazosConsulta tus depósitos a plazos'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 7, target: 'depósito a plazo', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'transacciones y servicios', sensitive: false, replay: replayStep_4 }, { stepIndex: 5, actionIntent: 'select_product', target: 'consulta de balance', sensitive: false, replay: replayStep_5 }, { stepIndex: 6, actionIntent: 'select_product', target: 'Depósitos a PlazosConsulta tus depósitos a plazos', sensitive: false, replay: replayStep_6 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('depósito a plazo'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 8, target: 'Seleccionar el primer depósito a plazo visible del listado.', actionIntent: 'select_visible_item_by_ordinal', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }, { stepIndex: 4, actionIntent: 'select_product', target: 'transacciones y servicios', sensitive: false, replay: replayStep_4 }, { stepIndex: 5, actionIntent: 'select_product', target: 'consulta de balance', sensitive: false, replay: replayStep_5 }, { stepIndex: 6, actionIntent: 'select_product', target: 'Depósitos a PlazosConsulta tus depósitos a plazos', sensitive: false, replay: replayStep_6 }, { stepIndex: 7, actionIntent: 'select_product', target: 'depósito a plazo', sensitive: false, replay: replayStep_7 }], action: async () => { await productListPage.selectVisibleItemByOrdinal("first"); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});