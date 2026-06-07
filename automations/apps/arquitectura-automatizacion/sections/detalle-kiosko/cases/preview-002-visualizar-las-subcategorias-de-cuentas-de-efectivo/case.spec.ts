import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { CategoryPage } from '../../../../pages/category.page';
import { ProductDetailPage } from '../../../../pages/productdetail.page';
import { AuthFlow, setAuthFlowTestData } from '../../../../flows/auth.flow';
import { resolvePromotedSpecAuthDataFromEnv } from '../../../../flows/auth.flow.helpers';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Visualizar las subcategorias de Cuentas de Efectivo', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  const homePage = new HomePage(page);
  const categoryPage = new CategoryPage(page);
  const productDetailPage = new ProductDetailPage(page);
    const authFlow = new AuthFlow(page);

  const promotedRuntime = createPromotedSpecRuntime(page);

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const replayStep_3 = async () => { await productListPage.selectProduct('Iniciar'); };
  const replayStep_4 = async () => { await productListPage.selectProduct('Cuentas de Efectivo'); };

  await promotedRuntime.clickPromotedTarget({ stepIndex: 3, target: 'Iniciar', actionIntent: 'start_session', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'HomePage', action: async () => { await homePage.start(); } }); // [target: Iniciar]
  
    setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());
    const authFlowResult = await authFlow.ensureAuthenticated({
      alias: 'defaultClient',
      landing: 'transactions_menu',
    });
    if (!authFlowResult.success) {
      throw new Error(`auth_flow_failed_in_promoted_spec: ${authFlowResult.error || 'unknown_error'}`);
    }
  
  await promotedRuntime.clickPromotedTarget({ stepIndex: 4, target: 'Cuentas de Efectivo', actionIntent: 'select_category', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 3, actionIntent: 'select_product', target: 'Iniciar', sensitive: false, replay: replayStep_3 }], lastSelectionStep: undefined,  expectedOwnerPage: 'CategoryPage', action: async () => { await categoryPage.selectCategory('Cuentas de Efectivo'); } });
  await promotedRuntime.expectPromotedVisible({ stepIndex: 5, target: 'Dólares', assertion: async () => { await productDetailPage.expectLoaded(); } }); // [target: Dólares]
});