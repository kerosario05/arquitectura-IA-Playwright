import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../src/automations/runtime/promoted-spec-runtime';

test('__SCENARIO_TITLE__', async ({ page }) => {
  process.env.APP_SLUG = '__APP_SLUG__';
  process.env.SECTION_SLUG = '__SECTION_SLUG__';
  process.env.SCENARIO_ID = '__SCENARIO_ID__';
  process.env.SCENARIO_TITLE = '__SCENARIO_TITLE__';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.loginPromotedTarget({
      stepIndex: 1,
      target: 'auth_flow',
      actionIntent: 'authenticate',
      expectedEffect: 'ui_change',
      action: async () => undefined,
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});

// Rejected by the runtime allowlist gate with:
// unknown_promoted_runtime_method:loginPromotedTarget
