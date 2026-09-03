import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-006';
process.env.SCENARIO_TITLE = 'Seleccionar Explora nuestros productos según la rama funcional obligatoria';

test('PREVIEW-006 - Seleccionar Explora nuestros productos según la rama funcional obligatoria', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Explora nuestros productos',
      actionIntent: 'Clic en "Explora nuestros productos".',
      expectedEffect: 'Abrir la ruta de autenticación del kiosco.',
      action: async () => {
        await page.getByText('Explora nuestros productos').click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'pantalla de autenticación del kiosco',
      assertion: async () => {
        await expect(page.getByText('pantalla de autenticación del kiosco')).toBeVisible();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});