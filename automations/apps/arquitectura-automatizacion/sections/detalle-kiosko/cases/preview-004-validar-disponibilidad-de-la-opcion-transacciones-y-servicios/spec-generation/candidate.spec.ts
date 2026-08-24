import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { AuthFlow } from '../../../../flows/auth.flow';
import { HomePage } from '../../../../pages/home.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Validar disponibilidad de la opción Transacciones y servicios', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = "arquitectura-automatizacion";
  process.env.SECTION_SLUG = "detalle-kiosko";
  process.env.SCENARIO_ID = "PREVIEW-004";
  process.env.SCENARIO_TITLE = "Validar disponibilidad de la opción Transacciones y servicios";

  const homePage = new HomePage(page);
  const authFlow = new AuthFlow(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.safeReplayContext({
      stepIndex: 2,
      description: 'Execute login',
      sensitive: true,
      action: async () => {
        await authFlow.ensureAuthenticated();
      }
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
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      description: 'Opción autenticada disponible desde el selector inicial.',
      target: 'Transacciones y servicios',
      assertion: async () => {
        expect(await authFlow.isTransactionsEntryVisible()).toBe(true);
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});