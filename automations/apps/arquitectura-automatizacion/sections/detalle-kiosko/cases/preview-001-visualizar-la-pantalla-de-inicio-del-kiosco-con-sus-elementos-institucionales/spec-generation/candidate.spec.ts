import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Visualizar la pantalla de inicio del kiosco con sus elementos institucionales', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Visualizar la pantalla de inicio del kiosco con sus elementos institucionales';

  const homePage = new HomePage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      description: 'Validar que se muestre "mensaje de saludo".',
      target: 'backing_evidence_missing',
      assertion: async () => {
        throw new Error('Unresolved requirement: missing backed observable evidence for step 2 greeting message assertion.');
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
