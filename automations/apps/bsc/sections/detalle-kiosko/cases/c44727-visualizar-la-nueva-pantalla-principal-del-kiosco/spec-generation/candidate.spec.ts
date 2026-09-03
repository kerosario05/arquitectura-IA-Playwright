import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'C44727';
process.env.SCENARIO_TITLE = 'Visualizar la nueva pantalla principal del kiosco';

test('C44727 - Visualizar la nueva pantalla principal del kiosco', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Estados de cuenta',
      assertion: async () => {
        await expect(page.getByText('Estados de cuenta')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Consulta de balance',
      assertion: async () => {
        await expect(page.getByText('Consulta de balance')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'Cartas y certificaciones',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'Canje de Puntos',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos')).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
