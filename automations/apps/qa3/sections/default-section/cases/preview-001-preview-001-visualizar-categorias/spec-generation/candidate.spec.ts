import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('PREVIEW-001 Visualizar categorias', async ({ page }) => {
  process.env.APP_SLUG = 'qa3';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'PREVIEW-001 Visualizar categorias';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Abrir el flujo inicial de exploración.',
      action: async () => {
        await page.getByText('Iniciar', { exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'Clic en "Explora nuestros productos".',
      expectedEffect: 'Navegar a la vista de productos.',
      action: async () => {
        await page.getByText('Explora nuestros productos', { exact: true }).click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Tarjetas de credito',
      assertion: async () => {
        await expect(page.getByText('Tarjetas de credito', { exact: true })).toBeVisible();
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});