import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { LoginPage } from '../../../../pages/login.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Validar que las pantallas iniciales no muestren informacion financiera', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));

  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-006';
  process.env.SCENARIO_TITLE = 'Validar que las pantallas iniciales no muestren informacion financiera';

  const homePage = new HomePage(page);
  const loginPage = new LoginPage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'login',
      actionIntent: 'authenticate',
      expectedEffect: 'authenticated_session',
      sensitive: true,
      previousStepReplays: [
        async () => {
          await page.goto('/');
          await page.waitForLoadState('domcontentloaded');
        }
      ],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'LoginPage',
      action: async () => {
        await loginPage.expectLoginFormVisible();
        await loginPage.fillUsername(process.env.APP_USERNAME ?? '');
        await loginPage.fillPassword(process.env.APP_PASSWORD ?? '');
        await loginPage.submitLogin();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'Iniciar',
      actionIntent: 'start_session',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [
        async () => {
          await page.goto('/');
          await page.waitForLoadState('domcontentloaded');
        },
        async () => {
          await loginPage.expectLoginFormVisible();
          await loginPage.fillUsername(process.env.APP_USERNAME ?? '');
          await loginPage.fillPassword(process.env.APP_PASSWORD ?? '');
          await loginPage.submitLogin();
        }
      ],
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