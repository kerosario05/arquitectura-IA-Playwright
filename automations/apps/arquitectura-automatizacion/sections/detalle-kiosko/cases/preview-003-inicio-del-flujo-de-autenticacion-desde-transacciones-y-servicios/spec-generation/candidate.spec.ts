import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { AuthFlow } from '../../../../flows/auth.flow';
import { ProductListPage } from '../../../../pages/productlist.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Inicio del flujo de autenticación desde transacciones y servicios', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-003';
  process.env.SCENARIO_TITLE = 'Inicio del flujo de autenticación desde transacciones y servicios';

  const productListPage = new ProductListPage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const authFlow = new AuthFlow(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    const replayStep_1 = async () => {
      await page.goto('/');
      await page.waitForLoadState('domcontentloaded');
    };

    const replayStep_3 = async () => {
      await productListPage.selectProduct('kiosco');
    };

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'kiosco',
      actionIntent: 'select_product',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [
        {
          stepIndex: 1,
          actionIntent: 'navigate',
          target: '/',
          sensitive: false,
          replay: replayStep_1
        }
      ],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'ProductListPage',
      action: async () => {
        await productListPage.selectProduct('kiosco');
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'Transacciones y servicios',
      actionIntent: 'open_module',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [
        {
          stepIndex: 1,
          actionIntent: 'navigate',
          target: '/',
          sensitive: false,
          replay: replayStep_1
        },
        {
          stepIndex: 3,
          actionIntent: 'select_product',
          target: 'kiosco',
          sensitive: false,
          replay: replayStep_3
        }
      ],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'OperationsMenuPage',
      action: async () => {
        await operationsMenuPage.openModule('Transacciones y servicios');
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      description: 'Validar que se detecta una etapa observable del flujo de autenticación tras abrir Transacciones y servicios.',
      target: 'flujo de autenticación',
      assertion: async () => {
        const currentStage = await authFlow.detectCurrentStage();
        if (currentStage === 'unknown') {
          throw new Error('Auth gate stage could not be confirmed from observed evidence.');
        }
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});