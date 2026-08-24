import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../src/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { ProductDetailPage } from '../../../../pages/productdetail.page';

test('PREVIEW-002 - Direccionamiento publico a informacion desde Explora nuestros productos', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-002';
  process.env.SCENARIO_TITLE = 'Direccionamiento publico a informacion desde Explora nuestros productos';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);
  const productDetailPage = new ProductDetailPage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      description: 'Clic en "Iniciar".',
      target: { strategy: 'text', value: 'Iniciar' },
      action: async () => {
        await page.getByText('Iniciar', { exact: true }).click();
      }
    });

    await promotedRuntime.safeReplayContext({
      stepIndex: 1,
      description: 'Navigate to https://172.27.4.50',
      target: { strategy: 'page_object', value: 'HomePage.open' },
      action: async () => {
        await homePage.open();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      description: 'Clic en "Iniciar".',
      target: { strategy: 'role:button', value: 'Iniciar', exact: false },
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      description: 'Clic en "Explora nuestros productos".',
      target: {
        strategy: 'product_condition',
        value: 'Explora nuestros productosConoce sobre los beneficios de los productos BSC',
        exact: false
      },
      action: async () => {
        await productDetailPage.clickPrimaryAction('Explora nuestros productosConoce sobre los beneficios de los productos BSC');
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      description: 'Clic en "Explora nuestros productos".',
      target: { strategy: 'text', value: 'Explora nuestros productos' },
      action: async () => {
        await page.getByText('Explora nuestros productos', { exact: true }).click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      description: 'Validar que se muestre "módulo de información".',
      target: { strategy: 'text', value: 'módulo de información' },
      assertion: async () => {
        await expect(page.getByText('módulo de información', { exact: true })).toBeVisible();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
