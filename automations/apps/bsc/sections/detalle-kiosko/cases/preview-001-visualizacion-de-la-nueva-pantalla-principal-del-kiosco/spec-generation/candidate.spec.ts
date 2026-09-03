import { expect, test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('Visualizacion de la nueva pantalla principal del kiosco', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Visualizacion de la nueva pantalla principal del kiosco';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'Estados de cuenta',
      assertion: async () => {
        await expect(page.getByText('Estados de cuenta', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Consulta de balance',
      assertion: async () => {
        await expect(page.getByText('Consulta de balance', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Cartas y certificaciones',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'Canje de Puntos',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'Explora nuestros productos',
      assertion: async () => {
        await expect(page.getByText('Explora nuestros productos', { exact: true })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});