import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Visualización de opciones principales tras iniciar el kiosco', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Visualización de opciones principales tras iniciar el kiosco';

  const homePage = new HomePage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      description: 'Execute login',
      target: 'Iniciar',
      assertion: async () => {
        await expect(page.getByRole('button', { name: 'Iniciar', exact: false })).toBeVisible();
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
  } finally {
    await promotedRuntime.finishEvidence();
  }
});