import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';

export const PROMOTED_SPEC_STRATEGY = "pom_runtime";

test('Redirigir a autenticación al seleccionar Consulta de balance', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  // Evidence metadata
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-003';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticación al seleccionar Consulta de balance';


  const operationsMenuPage = new OperationsMenuPage(page);

  const promotedRuntime = createPromotedSpecRuntime(page);
  try {

  await page.goto('/');
  await page.waitForLoadState('domcontentloaded');

  await promotedRuntime.clickPromotedTarget({ stepIndex: 2, target: 'Consulta de balance', actionIntent: 'open_module', expectedEffect: 'ui_change', sensitive: false, previousStepReplays: [], lastSelectionStep: undefined,  expectedOwnerPage: 'ProductListPage', action: async () => { await operationsMenuPage.openModule('Consulta de balance'); } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});