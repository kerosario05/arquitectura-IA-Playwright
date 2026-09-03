import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-003';
process.env.SCENARIO_TITLE = 'Seleccionar Consulta de balance y observar redirección a autenticación';

test('Seleccionar Consulta de balance y observar redirección a autenticación', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Consulta de balance',
      actionIntent: 'Seleccionar la opción Consulta de balance',
      expectedEffect: 'Navegar hacia el flujo de autenticación del kiosco',
      action: async () => {
        await page.getByText('Consulta de balance', { exact: true }).click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(1, 'pantalla de autenticación del kiosco');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'pantalla de autenticación del kiosco',
      assertion: async () => {
        await expect(page.getByText('pantalla de autenticación del kiosco', { exact: true })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});