import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { resolve } from 'node:path';
import { config } from '../../../../../../../../src/config/env';
import { buildDataContext } from '../../../../../../../../src/data';
import { loadPromotedAppConfigSync, buildMergedConfig } from '../../../../../../../../src/automations/app-profile';
import { loadPromotedDataManifestSync, buildPromotedDataContext, requirePromotedData } from '../../../../../../../../src/data/promoted-data';

import { FormPage } from '../../../../pages/form.page';
import { LoginPage } from '../../../../pages/login.page';
import { ProductListPage } from '../../../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Login satisfactorio', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'portalempresarial';
  process.env.SECTION_SLUG = 'automatizacion-1';
  process.env.SCENARIO_ID = 'C44757';
  process.env.SCENARIO_TITLE = 'Login satisfactorio';


  const __appConfig = loadPromotedAppConfigSync({ appSlug: 'portalempresarial', configPath: 'automations/apps/portalempresarial/app.config.json' });
  const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;
  const __baseDataContext = buildDataContext(__runtimeConfig);
  const __promotedManifest = loadPromotedDataManifestSync(resolve(process.cwd(), 'automations/apps/portalempresarial/sections/automatizacion-1/cases/c44757-login-satisfactorio/promoted-data.json'));
  const dataContext = buildPromotedDataContext({
    baseDataContext: __baseDataContext,
    manifest: __promotedManifest,
    testDataProfile: __runtimeConfig.app.testDataProfile,
    autoGenerateTestData: __runtimeConfig.app.autoGenerateTestData,
    autoGenerateSensitiveData: __runtimeConfig.app.autoGenerateSensitiveData
  });

  const formPage = new FormPage(page);
  const loginPage = new LoginPage(page);
  const productListPage = new ProductListPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const authCompanyIdentifier = requirePromotedData(dataContext, 'auth.company_identifier', { fieldName: 'RNC de la empresa', stepIndex: 3 });
  const authUsername = requirePromotedData(dataContext, 'auth.username', { fieldName: 'Nombre de usuario', stepIndex: 4 });
  const authPassword = requirePromotedData(dataContext, 'auth.password', { fieldName: 'Contraseña', stepIndex: 5 });

  await promotedRuntime.fillPromotedField({ stepIndex: 3, field: 'RNC de la empresa', value: String(authCompanyIdentifier), sensitive: false, fill: async () => { await formPage.fillField('RNC de la empresa', authCompanyIdentifier); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 4, field: 'Nombre de usuario', value: String(authUsername), sensitive: false, fill: async () => { await loginPage.fillUsername(authUsername); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 5, field: 'Contraseña', value: String(authPassword), sensitive: false, fill: async () => { await loginPage.fillPassword(authPassword); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Continuar', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductDetailPage', action: async () => { await productListPage.clickPrimaryAction('Continuar'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 7, target: 'Salir', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Salir'); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});