import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';

process.env.APP_SLUG = 'qa3';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Validar que la categoria Cuentas de Efectivo se muestre en el catalogo';

test('PREVIEW-001 Validar que la categoria Cuentas de Efectivo se muestre en el catalogo', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Abrir el acceso inicial para continuar al catálogo.',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'Clic en "Explora nuestros productos".',
      expectedEffect: 'Abrir la sección de productos.',
      action: async () => {
        await page.getByText('Explora nuestros productos').click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Cuentas de Efectivo',
      assertion: async () => {
        await expect(page.getByText('Cuentas de Efectivo')).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});