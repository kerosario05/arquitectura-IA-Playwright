import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
import { scanCurrentPage } from '../../../../src/explorer/page-scanner';
import { detectAuthGate } from '../../../../src/discovery/auth-gate-detector';
import { HomePage } from '../../pages/home.page';
import { OperationsMenuPage } from '../../pages/operationsmenu.page';

test('__SCENARIO_TITLE__', async ({ page }) => {
  process.env.APP_SLUG = '__APP_SLUG__';
  process.env.SECTION_SLUG = '__SECTION_SLUG__';
  process.env.SCENARIO_ID = '__SCENARIO_ID__';
  process.env.SCENARIO_TITLE = '__SCENARIO_TITLE__';

  const homePage = new HomePage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto(process.env.APP_BASE_URL ?? '/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: '__PRIMARY_ACTION__',
      actionIntent: 'click_step',
      expectedEffect: 'ui_change',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: '__MODULE_NAME__',
      actionIntent: 'click_step',
      expectedEffect: 'ui_change',
      action: async () => {
        await operationsMenuPage.openModule('__MODULE_NAME__');
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'auth_gate',
      description: 'Auth gate should be observable after functional clicks.',
      assertion: async () => {
        let authGateStarted = false;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const authSnapshot = await scanCurrentPage(page);
          const authDetection = detectAuthGate(authSnapshot);
          authGateStarted = authDetection.detected
            || authDetection.stage === 'authenticated_landing'
            || authDetection.evidence.some((evidence: unknown) => /identificaci(?:o|\u00f3)n|otp|__MODULE_NAME__/i.test(String(evidence)));
          if (authGateStarted) break;
          await page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => undefined);
        }
        await expect(authGateStarted).toBeTruthy();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
