import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { AuthFlow } from '../../../../flows/auth.flow';
import { HomePage } from '../../../../pages/home.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Inicio del flujo autenticado desde transacciones y servicios', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-003';
  process.env.SCENARIO_TITLE = 'Inicio del flujo autenticado desde transacciones y servicios';

  const appBaseUrl = process.env.APP_BASE_URL;
  if (!appBaseUrl) {
    throw new Error('APP_BASE_URL is required');
  }

  const homePage = new HomePage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const authFlow = new AuthFlow(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto(appBaseUrl);
    await page.waitForLoadState('domcontentloaded');

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

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      description: 'Validar que se muestre "¿Qué deseas realizar hoy?".',
      target: '¿Qué deseas realizar hoy?',
      assertion: async () => {
        await expect(page.getByText('¿Qué deseas realizar hoy?', { exact: true })).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'transacciones y servicios',
      actionIntent: 'open_module',
      expectedEffect: 'auth_gate_start',
      sensitive: false,
      previousStepReplays: [],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'OperationsMenuPage',
      action: async () => {
        await operationsMenuPage.openModule('transacciones y servicios');
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      description: 'Validar que la opción protegida deriva al límite de autenticación.',
      target: 'auth_gate',
      assertion: async () => {
        const detectedStage = await authFlow.detectCurrentStage();
        expect(detectedStage).toBeTruthy();
        expect(await authFlow.isStageControlReady()).toBeTruthy();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});