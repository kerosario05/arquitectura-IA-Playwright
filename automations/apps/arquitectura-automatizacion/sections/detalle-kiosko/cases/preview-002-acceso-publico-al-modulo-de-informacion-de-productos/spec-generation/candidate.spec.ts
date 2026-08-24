import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

import { HomePage } from '../../../../pages/home.page';
import { ProductInformationPage } from '../../../../pages/productinformation.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Acceso público al módulo de Información de productos', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-002';
  process.env.SCENARIO_TITLE = 'Acceso público al módulo de Información de productos';

  const homePage = new HomePage(page);
  const productInformationPage = new ProductInformationPage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto(process.env.APP_BASE_URL ?? '/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'Iniciar',
      actionIntent: 'start_session',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'HomePage',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      description: 'Validar que se muestre "¿Qué deseas realizar hoy?".',
      target: '¿Qué deseas realizar hoy?',
      assertion: async () => {
        await expect(page.getByText('¿Qué deseas realizar hoy?', { exact: true })).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'Información de productos',
      actionIntent: 'open_product_information',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'ProductInformationPage',
      action: async () => {
        await productInformationPage.openProductInformation();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});