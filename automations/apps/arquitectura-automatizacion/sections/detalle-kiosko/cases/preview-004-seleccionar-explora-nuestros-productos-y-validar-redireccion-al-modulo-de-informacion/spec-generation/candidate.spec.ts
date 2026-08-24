import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { ProductListPage } from '../../../../pages/productlist.page';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Seleccionar Explora nuestros productos y validar redireccion al modulo de informacion', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-004';
  process.env.SCENARIO_TITLE = 'Seleccionar Explora nuestros productos y validar redireccion al modulo de informacion';

  const homePage = new HomePage(page);
  const productListPage = new ProductListPage(page);
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.waitForPromotedUiStable({
      stepIndex: 2,
      target: 'public_product_entry',
      description: 'Preserve the observed functional order before selecting the first visible list item.'
    });

    const replayStep3 = async () => {
      await homePage.start();
    };
    const replayStep4 = async () => {
      await productListPage.selectProduct('Explora nuestros productosConoce sobre los beneficios de los productos BSC');
    };

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
      stepIndex: 3,
      target: 'Explora nuestros productosConoce sobre los beneficios de los productos BSC',
      description: 'Validar la transicion observada despues de seleccionar la opcion publica.',
      assertion: async () => {
        await expect(page.getByText('Explora nuestros productosConoce sobre los beneficios de los productos BSC', { exact: false })).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'Explora nuestros productosConoce sobre los beneficios de los productos BSC',
      actionIntent: 'select_product',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [
        {
          stepIndex: 3,
          actionIntent: 'start_session',
          target: 'Iniciar',
          sensitive: false,
          replay: replayStep3
        }
      ],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'ProductListPage',
      action: async () => {
        await productListPage.selectProduct('Explora nuestros productosConoce sobre los beneficios de los productos BSC');
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'DepÃ³sitos a plazo',
      description: 'Validar el primer elemento visible del listado observado durante discovery.',
      assertion: async () => {
        await expect(page.getByText('DepÃ³sitos a plazo', { exact: false })).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 5,
      target: 'el primer elemento visible del listado',
      actionIntent: 'select_first_visible_card',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [
        {
          stepIndex: 3,
          actionIntent: 'start_session',
          target: 'Iniciar',
          sensitive: false,
          replay: replayStep3
        },
        {
          stepIndex: 4,
          actionIntent: 'select_product',
          target: 'Explora nuestros productosConoce sobre los beneficios de los productos BSC',
          sensitive: false,
          replay: replayStep4
        }
      ],
      lastSelectionStep: undefined,
      expectedOwnerPage: 'ProductListPage',
      action: async () => {
        await productListPage.selectFirstVisibleCard();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      target: 'mÃ³dulo de informaciÃ³n',
      description: 'Validar que se muestre mÃ³dulo de informaciÃ³n tras la redirecciÃ³n observada.',
      assertion: async () => {
        await expect(page.getByText('mÃ³dulo de informaciÃ³n', { exact: false })).toBeVisible();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});