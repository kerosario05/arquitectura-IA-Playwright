import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('Redirigir a autenticacion desde Canje de Puntos', async ({ page }) => {
  process.env.APP_SLUG = 'pruebaqa';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-004';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Canje de Puntos';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'Canje de Puntos',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Canje de Puntos',
      actionIntent: 'Redirigir a autenticacion desde Canje de Puntos',
      expectedEffect: 'Abrir el acceso autenticado del kiosco',
      action: async () => {
        await page.getByText('Canje de Puntos').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'Iniciar sesión');
    const authGateSnapshot = await scanCurrentPage(page);
    const authGate = detectAuthGate(authGateSnapshot);
    expect(authGate.stage).toBe('identification_type_selection');
  } finally {
    await promotedRuntime.finishEvidence();
  }
});