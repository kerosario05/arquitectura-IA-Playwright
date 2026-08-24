import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';

test('__SCENARIO_TITLE__', async ({ page }) => {
  process.env.APP_SLUG = '__APP_SLUG__';
  process.env.SECTION_SLUG = '__SECTION_SLUG__';
  process.env.SCENARIO_ID = '__SCENARIO_ID__';
  process.env.SCENARIO_TITLE = '__SCENARIO_TITLE__';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'imaginary_banner',
      description: 'Rejected because the selector and text are invented and not backed by discovery evidence.',
      assertion: async () => {
        await expect(page.getByText(/imaginary success banner/i)).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
