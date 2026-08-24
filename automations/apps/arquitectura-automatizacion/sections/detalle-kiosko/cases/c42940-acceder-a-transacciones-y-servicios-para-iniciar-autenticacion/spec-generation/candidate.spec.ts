import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { AuthFlow } from '../../../../flows/auth.flow';
import { HomePage } from '../../../../pages/home.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Acceder a Transacciones y servicios para iniciar autenticacion', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C42940';
  process.env.SCENARIO_TITLE = 'Acceder a Transacciones y servicios para iniciar autenticacion';

  const homePage = new HomePage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const authFlow = new AuthFlow(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
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

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'transacciones y servicios',
      actionIntent: 'open_module',
      expectedEffect: 'ui_change',
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
      target: 'authentication gate',
      description: 'Validate auth gate start',
      assertion: async () => {
        await expect.poll(async () => authFlow.isTransactionsEntryVisible()).toBe(false);
        await expect.poll(async () => authFlow.detectCurrentStage()).not.toBe('transactions_menu');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});