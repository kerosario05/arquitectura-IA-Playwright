import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { AuthFlow } from '../../../../flows/auth.flow';
import { HomePage } from '../../../../pages/home.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Seleccionar Transacciones y servicios e iniciar el flujo de autenticacion', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-005';
  process.env.SCENARIO_TITLE = 'Seleccionar Transacciones y servicios e iniciar el flujo de autenticacion';

  const homePage = new HomePage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const authFlow = new AuthFlow(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
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
      stepIndex: 3,
      target: 'Transacciones y serviciosRealiza operaciones con tus cuentas',
      actionIntent: 'open_module',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'OperationsMenuPage',
      action: async () => {
        await operationsMenuPage.openModule('Transacciones y serviciosRealiza operaciones con tus cuentas');
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'flujo de autenticaciA3n',
      description: 'Validar que se muestre \"flujo de autenticaciA3n\".',
      assertion: async () => {
        const currentStage = await authFlow.detectCurrentStage();
        expect(currentStage).toBeTruthy();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});