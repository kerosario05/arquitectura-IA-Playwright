import { test, expect, type Page } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('Redirigir a autenticacion desde Canje de Puntos', async ({ page }: { page: Page }) => {
  process.env.APP_SLUG = 'pruebaqa';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44659';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Canje de Puntos';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Canje de Puntos',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Canje de Puntos',
      actionIntent: 'Abrir la opcion Canje de Puntos',
      expectedEffect: 'Navegar al acceso autenticado del kiosco',
      action: async () => {
        await page.getByText('Canje de Puntos', { exact: true }).click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Canje de Puntos redirige al acceso autenticado del kiosco.');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Canje de Puntos redirige al acceso autenticado del kiosco.',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos', { exact: true })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
