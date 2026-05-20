import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../../src/config/env';
import { buildDataContext } from '../../src/data';
import { executeExecutionPlan } from '../../src/runner/execution-plan-executor';
import { shouldRunGeneratedSpec, buildGeneratedSpecSkipReason } from '../../src/runner/generated-spec-filter';
import type { ExecutionPlan } from '../../src/types/execution-plan.types';

const SPEC_APP_PROFILE = 'default';

const planPath = resolve(
  process.cwd(),
  'automations/plans/c37616-c37372-acceso-al-modulo-informacion-de-productos.plan.json'
);

const plan = JSON.parse(readFileSync(planPath, 'utf8')) as ExecutionPlan;

test('C37372 - Acceso al modulo Informacion de productos', async ({ page }) => {
  test.skip(!shouldRunGeneratedSpec({ specProfile: SPEC_APP_PROFILE }),
    buildGeneratedSpecSkipReason({ specProfile: SPEC_APP_PROFILE }) ?? ''
  );

  const dataContext = buildDataContext(config);

  await executeExecutionPlan({
    page,
    plan,
    dataContext,
    appBaseUrl: config.app.baseUrl,
    evidenceDir: './.artifacts/executions/generated/c37616-c37372-acceso-al-modulo-informacion-de-productos'
  });
});
