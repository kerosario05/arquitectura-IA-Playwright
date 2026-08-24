import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../pages/home.page';

test('__SCENARIO_TITLE__', async ({ page }) => {
  process.env.APP_SLUG = '__APP_SLUG__';
  process.env.SECTION_SLUG = '__SECTION_SLUG__';
  process.env.SCENARIO_ID = '__SCENARIO_ID__';
  process.env.SCENARIO_TITLE = '__SCENARIO_TITLE__';

  const homePage = new HomePage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: '__PRIMARY_ACTION__',
      actionIntent: 'start_session',
      expectedEffect: 'ui_change',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: '__PRIMARY_ACTION__',
      description: 'Validate that the start entry point is observable.',
      assertion: async () => {
        await expect(page.getByRole('button', { name: /__PRIMARY_ACTION__/i })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
