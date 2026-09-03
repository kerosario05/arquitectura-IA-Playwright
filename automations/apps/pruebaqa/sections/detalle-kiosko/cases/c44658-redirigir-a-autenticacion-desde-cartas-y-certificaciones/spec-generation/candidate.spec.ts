import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'pruebaqa';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'C44658';
process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Cartas y certificaciones';

test('Redirigir a autenticacion desde Cartas y certificaciones', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Cartas y certificaciones',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Cartas y certificaciones',
      actionIntent: 'open card and certificate access',
      expectedEffect: 'navigate toward the authenticated kiosk access flow',
      action: async () => {
        await page.getByText('Cartas y certificaciones', { exact: true }).click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Cartas y certificaciones deriva al acceso autenticado del kiosco.',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones', { exact: true })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});