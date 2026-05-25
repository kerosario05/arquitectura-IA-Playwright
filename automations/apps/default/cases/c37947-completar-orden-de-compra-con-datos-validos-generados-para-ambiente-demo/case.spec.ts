import { test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../../../../../src/config/env';
import { buildDataContext } from '../../../../../src/data';
import { executeExecutionPlan } from '../../../../../src/runner/execution-plan-executor';
import { loadPromotedAppConfigSync, buildMergedConfig } from '../../../../../src/automations/app-profile';
import type { ExecutionPlan } from '../../../../../src/types/execution-plan.types';

const SPEC_APP_PROFILE = 'default';
const SPEC_APP_CONFIG_PATH = 'automations/apps/default/app.config.json';
const SPEC_PLAN_PATH = 'automations/apps/default/cases/c37947-completar-orden-de-compra-con-datos-validos-generados-para-ambiente-demo/plan.json';

const __appConfig = loadPromotedAppConfigSync({
  appSlug: SPEC_APP_PROFILE,
  configPath: resolve(process.cwd(), SPEC_APP_CONFIG_PATH)
});
const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;

const planPath = resolve(process.cwd(), SPEC_PLAN_PATH);
const plan = JSON.parse(readFileSync(planPath, 'utf8')) as ExecutionPlan;

test('Completar orden de compra con datos válidos generados para ambiente demo', async ({ page }) => {
  const dataContext = buildDataContext(__runtimeConfig);
  await executeExecutionPlan({
    page,
    plan,
    dataContext,
    appBaseUrl: __runtimeConfig.app.baseUrl,
    runtimeConfig: __runtimeConfig,
    evidenceDir: resolve(process.cwd(), 'automations/apps/default/cases/c37947-completar-orden-de-compra-con-datos-validos-generados-para-ambiente-demo/runs')
  });
});