import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { AuthFlow } from '../../../../flows/auth.flow';
import { HomePage } from '../../../../pages/home.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Iniciar frontera de autenticación desde Transacciones y servicios', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-005';
  process.env.SCENARIO_TITLE = 'Iniciar frontera de autenticación desde Transacciones y servicios';

  const homePage = new HomePage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const authFlow = new AuthFlow(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto(process.env.APP_BASE_URL!);
    await page.waitForLoadState('domcontentloaded');

    const replayStep_3 = async () => {
      await homePage.start();
    };

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
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'transacciones y servicios',
      actionIntent: 'open_module',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [
        {
          stepIndex: 3,
          actionIntent: 'start_session',
          target: 'Iniciar',
          sensitive: false,
          replay: replayStep_3
        }
      ],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'OperationsMenuPage',
      action: async () => {
        await operationsMenuPage.openModule('transacciones y servicios');
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'auth_gate_stage',
      description: 'Validar que se muestre "flujo de autenticación".',
      assertion: async () => {
        expect(await authFlow.detectCurrentStage()).toBeTruthy();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});