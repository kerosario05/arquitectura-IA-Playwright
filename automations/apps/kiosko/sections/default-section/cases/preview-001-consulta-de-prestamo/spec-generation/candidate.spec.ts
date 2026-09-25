import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'kiosko';
process.env.SECTION_SLUG = 'default-section';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Consulta de prestamo';

test('PREVIEW-001 - Consulta de prestamo', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'click',
      expectedEffect: 'Abrir la exploración de productos',
      action: async () => {
        await page.getByText('Explora nuestros productos', { exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'PrÃ©stamos',
      actionIntent: 'click',
      expectedEffect: 'Abrir la categoría de préstamos',
      action: async () => {
        await page.getByText('PrÃ©stamos', { exact: true }).click();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'PrÃ©stamo Personal',
      actionIntent: 'click',
      expectedEffect: 'Abrir el préstamo personal',
      action: async () => {
        await page.getByText('PrÃ©stamo Personal', { exact: true }).click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'PrÃ©stamo Personal');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'PrÃ©stamo Personal',
      polarity: 'positive',
      expectedUrl: 'https://172.27.4.50/',
      assertion: async () => {
        await expect(page).toHaveURL('https://172.27.4.50/');
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'Finalizar sesiÃ³n',
      actionIntent: 'click',
      expectedEffect: 'Finalizar la sesión',
      action: async () => {
        await page.getByText('Finalizar sesiÃ³n', { exact: true }).click();
      }
    });
      await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: "Finalizar sesión",
      polarity: "positive",
      expectedUrl: "https://172.27.4.50/",
      assertion: async () => {
        await expect(page).toHaveURL("https://172.27.4.50/");
      },
    });

} finally {
    await promotedRuntime.finishEvidence();
  }
});
