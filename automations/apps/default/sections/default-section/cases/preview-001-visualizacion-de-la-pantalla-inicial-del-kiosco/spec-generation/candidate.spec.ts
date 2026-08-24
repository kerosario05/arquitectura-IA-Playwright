import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config } from '../../../../../../../src/config/env';
import { buildDataContext } from '../../../../../../../src/data';
import { executeExecutionPlan } from '../../../../../../../src/runner/execution-plan-executor';
import { loadPromotedAppConfigSync, buildMergedConfig } from '../../../../../../../src/automations/app-profile';
import type { ExecutionPlan } from '../../../../../../../src/types/execution-plan.types';

export const PROMOTED_SPEC_STRATEGY = "inline_executor";

const SPEC_APP_PROFILE = 'default';
const SPEC_APP_CONFIG_PATH = 'automations/apps/default/app.config.json';
const SPEC_PLAN_PATH = 'automations/apps/default/sections/default-section/cases/preview-001-visualizacion-de-la-pantalla-inicial-del-kiosco/plan.json';

const __appConfig = loadPromotedAppConfigSync({
  appSlug: SPEC_APP_PROFILE,
  configPath: resolve(process.cwd(), SPEC_APP_CONFIG_PATH)
});
const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;

const planPath = resolve(process.cwd(), SPEC_PLAN_PATH);
const plan = JSON.parse(readFileSync(planPath, 'utf8')) as ExecutionPlan;

test('Visualizacion de la pantalla inicial del kiosco', async ({ page }) => {
  process.env.APP_SLUG = 'default';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Visualizacion de la pantalla inicial del kiosco';

  const dataContext = buildDataContext(__runtimeConfig);
  await executeExecutionPlan({
    page,
    plan,
    dataContext,
    appBaseUrl: __runtimeConfig.app.baseUrl,
    runtimeConfig: __runtimeConfig,
    evidenceDir: resolve(process.cwd(), 'automations/apps/default/sections/default-section/cases/preview-001-visualizacion-de-la-pantalla-inicial-del-kiosco/runs')
  });
});