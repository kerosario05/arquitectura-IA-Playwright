import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('PREVIEW-005 Seleccionar Explora nuestros productos desde la pantalla principal', async ({ page }) => {
  process.env.APP_SLUG = 'pruebaqa';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-005';
  process.env.SCENARIO_TITLE = 'Seleccionar Explora nuestros productos desde la pantalla principal';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    const baseUrl = process.env.APP_BASE_URL;
    if (!baseUrl) throw new Error('APP_BASE_URL is required');
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'Explora nuestros productos',
      assertion: async () => {
        await expect(page.getByText('Explora nuestros productos')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'Seleccionar la opcion desde la pantalla principal',
      expectedEffect: 'Navega o revela el siguiente estado funcional de la opcion',
      action: async () => {
        await page.getByText('Explora nuestros productos').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'Iniciar sesión');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Iniciar sesión',
      assertion: async () => {
        await expect(page.getByText('Iniciar sesión')).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});