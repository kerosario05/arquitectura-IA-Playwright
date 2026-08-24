import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductInformationPage } from '../../../../pages/productinformation.page';
import { CategoryPage } from '../../../../pages/category.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Visualizar las subopciones de Cuentas de Efectivo', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-002';
  process.env.SCENARIO_TITLE = 'Visualizar las subopciones de Cuentas de Efectivo';

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const categoryPage = new CategoryPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {
    await page.goto(process.env.APP_BASE_URL!);
    await page.waitForLoadState('domcontentloaded');

    const replayStep_3 = async () => {
      await homePage.start();
    };
    const replayStep_4 = async () => {
      await productInformationPage.openProductInformation();
    };

    await promotedRuntime.waitForPromotedUiStable({
      stepIndex: 2,
      target: 'APP_LOGIN_MODE=no_login',
      actionIntent: 'confirm_no_login_mode',
      expectedEffect: 'ui_stable',
      sensitive: false,
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'Iniciar',
      actionIntent: 'start_session',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'HomePage',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'Información de productos',
      actionIntent: 'open_product_information',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [
        {
          stepIndex: 3,
          actionIntent: 'start_session',
          target: 'Iniciar',
          sensitive: false,
          replay: replayStep_3,
        },
      ],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'ProductInformationPage',
      action: async () => {
        await productInformationPage.openProductInformation();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 5,
      target: 'Cuentas de Efectivo',
      actionIntent: 'select_category',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [
        {
          stepIndex: 3,
          actionIntent: 'start_session',
          target: 'Iniciar',
          sensitive: false,
          replay: replayStep_3,
        },
        {
          stepIndex: 4,
          actionIntent: 'open_product_information',
          target: 'Información de productos',
          sensitive: false,
          replay: replayStep_4,
        },
      ],
      lastSelectionStep: {
        stepIndex: 4,
        selectedTarget: 'Información de productos',
      },
      expectedOwnerPage: 'CategoryPage',
      action: async () => {
        await categoryPage.selectCategory('Cuentas de Efectivo');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});