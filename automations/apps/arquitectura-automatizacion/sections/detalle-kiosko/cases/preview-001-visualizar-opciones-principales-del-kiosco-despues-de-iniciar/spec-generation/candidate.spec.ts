import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Visualizar opciones principales del kiosco despu\u00e9s de iniciar', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Visualizar opciones principales del kiosco despu\u00e9s de iniciar';

  const homePage = new HomePage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      description: 'Validar que se muestre "Informaci\u00f3n de productos".',
      target: 'Informaci\u00f3n de productos',
      assertion: async () => {
        throw new Error('Unresolved promoted assertion for step 2: no backed observable evidence, auth flow, or allowed runtime action was provided to implement the required login validation safely.');
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