import { expect, test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';

process.env.APP_SLUG = 'qa3';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Validar acceso al catalogo inicial de productos desde el menu del kiosco';

test('PREVIEW-001 - Validar acceso al catalogo inicial de productos desde el menu del kiosco', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Abrir el menu del kiosco desde la pantalla inicial.',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'Clic en "Explora nuestros productos".',
      expectedEffect: 'Abrir el catalogo inicial de productos.',
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
