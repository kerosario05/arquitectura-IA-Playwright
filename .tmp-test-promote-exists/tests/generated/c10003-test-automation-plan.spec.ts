import { test } from '@playwright/test';
import plan from '../../automations/plans/c10003-test-automation-plan.plan.json';

test('Test automation plan', async ({ page }) => {
  const { config } = await import('../../src/config/env');
  const { buildDataContext } = await import('../../src/data');
  const { executeExecutionPlan } = await import('../../src/runner/execution-plan-executor');

  const dataContext = buildDataContext(config);

  await executeExecutionPlan({
    page,
    plan,
    appBaseUrl: config.app.baseUrl,
    evidenceDir: './.artifacts/executions/generated/c10003-test-automation-plan'
  });
});