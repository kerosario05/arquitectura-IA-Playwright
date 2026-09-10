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
import { AuthFlow, setAuthFlowTestData } from '../../../../flows/auth.flow';
import { resolvePromotedSpecAuthDataFromEnv } from '../../../../flows/auth.flow.helpers';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Validar cédula con formato erróneo al agregar empleado manualmente', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'portalempresarial';
  process.env.SECTION_SLUG = 'automatizacion-1';
  process.env.SCENARIO_ID = 'C44758';
  process.env.SCENARIO_TITLE = 'Validar cédula con formato erróneo al agregar empleado manualmente';


  const __appConfig = loadPromotedAppConfigSync({ appSlug: 'portalempresarial', configPath: 'automations/apps/portalempresarial/app.config.json' });
  const __runtimeConfig = __appConfig ? buildMergedConfig(__appConfig, config) : config;
  const __baseDataContext = buildDataContext(__runtimeConfig);
  const __promotedManifest = loadPromotedDataManifestSync(resolve(process.cwd(), 'automations/apps/portalempresarial/sections/automatizacion-1/cases/c44758-validar-cedula-con-formato-erroneo-al-agregar-empleado-manualmente/promoted-data.json'));
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
    const authFlow = new AuthFlow(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  const authCompanyIdentifier = requirePromotedData(dataContext, 'auth.company_identifier', { fieldName: 'RNC de la empresa', stepIndex: 2 });
  const authUsername = requirePromotedData(dataContext, 'auth.username', { fieldName: 'Nombre de usuario', stepIndex: 3 });
  const authPassword = requirePromotedData(dataContext, 'auth.password', { fieldName: 'Contraseña', stepIndex: 4 });
  const employeeInvalidDocument = requirePromotedData(dataContext, 'employee.invalid_document', { fieldName: 'Colaborador', stepIndex: 11 });

  const replayStep_6 = async () => { await productListPage.selectProduct('Salir'); };
  const replayStep_7 = async () => { await productListPage.selectProduct('Gestión de Nóminas'); };
  const replayStep_8 = async () => { await productListPage.selectProduct('Crear Manualmente'); };
  const replayStep_9 = async () => { await productListPage.selectProduct('close'); };
  const replayStep_10 = async () => { await productListPage.selectProduct('Cédula'); };

  await promotedRuntime.fillPromotedField({ stepIndex: 2, field: 'RNC de la empresa', value: String(authCompanyIdentifier), sensitive: false, fill: async () => { await formPage.fillField('RNC de la empresa', authCompanyIdentifier); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 3, field: 'Nombre de usuario', value: String(authUsername), sensitive: false, fill: async () => { await loginPage.fillUsername(authUsername); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 4, field: 'Contraseña', value: String(authPassword), sensitive: false, fill: async () => { await loginPage.fillPassword(authPassword); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 5, target: 'Continuar', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductDetailPage', action: async () => { await productListPage.clickPrimaryAction('Continuar'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 6, target: 'Salir', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Salir'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 7, target: 'Gestión de Nóminas', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 6, actionIntent: 'select_product', target: 'Salir', sensitive: false, replay: replayStep_6 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Gestión de Nóminas'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 8, target: 'Crear Manualmente', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 6, actionIntent: 'select_product', target: 'Salir', sensitive: false, replay: replayStep_6 }, { stepIndex: 7, actionIntent: 'select_product', target: 'Gestión de Nóminas', sensitive: false, replay: replayStep_7 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductDetailPage', action: async () => { await productListPage.clickPrimaryAction('Crear Manualmente'); } });
  
    setAuthFlowTestData(resolvePromotedSpecAuthDataFromEnv());
    const authFlowResult = await authFlow.ensureAuthenticated({
      alias: 'defaultClient',
      landing: 'transactions_menu',
    });
    if (!authFlowResult.success) {
      throw new Error(`auth_flow_failed_in_promoted_spec: ${authFlowResult.error || 'unknown_error'}`);
    }
  
  await promotedRuntime.clickPromotedTarget({ stepIndex: 9, target: 'close', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 6, actionIntent: 'select_product', target: 'Salir', sensitive: false, replay: replayStep_6 }, { stepIndex: 7, actionIntent: 'select_product', target: 'Gestión de Nóminas', sensitive: false, replay: replayStep_7 }, { stepIndex: 8, actionIntent: 'select_product', target: 'Crear Manualmente', sensitive: false, replay: replayStep_8 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('close'); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 10, target: 'Cédula', actionIntent: 'click_primary_action', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 6, actionIntent: 'select_product', target: 'Salir', sensitive: false, replay: replayStep_6 }, { stepIndex: 7, actionIntent: 'select_product', target: 'Gestión de Nóminas', sensitive: false, replay: replayStep_7 }, { stepIndex: 8, actionIntent: 'select_product', target: 'Crear Manualmente', sensitive: false, replay: replayStep_8 }, { stepIndex: 9, actionIntent: 'select_product', target: 'close', sensitive: false, replay: replayStep_9 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductDetailPage', action: async () => { await productListPage.clickPrimaryAction('Cédula'); } });
  await promotedRuntime.fillPromotedField({ stepIndex: 11, field: 'Colaborador', value: String(employeeInvalidDocument), sensitive: false, fill: async () => { await formPage.fillField('Colaborador', employeeInvalidDocument); } });
  await promotedRuntime.clickPromotedTarget({ stepIndex: 12, target: 'Puesto', actionIntent: 'select_product', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [{ stepIndex: 6, actionIntent: 'select_product', target: 'Salir', sensitive: false, replay: replayStep_6 }, { stepIndex: 7, actionIntent: 'select_product', target: 'Gestión de Nóminas', sensitive: false, replay: replayStep_7 }, { stepIndex: 8, actionIntent: 'select_product', target: 'Crear Manualmente', sensitive: false, replay: replayStep_8 }, { stepIndex: 9, actionIntent: 'select_product', target: 'close', sensitive: false, replay: replayStep_9 }, { stepIndex: 10, actionIntent: 'select_product', target: 'Cédula', sensitive: false, replay: replayStep_10 }], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await productListPage.selectProduct('Puesto'); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});