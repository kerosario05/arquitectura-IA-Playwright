import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('Visualizar la nueva pantalla principal del kiosco con todas las opciones disponibles', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44745';
  process.env.SCENARIO_TITLE = 'Visualizar la nueva pantalla principal del kiosco con todas las opciones disponibles';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Estados de cuenta',
      assertion: async () => {
        await expect(page.getByText('Estados de cuenta', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Consulta de balance',
      assertion: async () => {
        await expect(page.getByText('Consulta de balance', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'Cartas y certificaciones',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'Canje de Puntos',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos', { exact: true })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
