import { expect, test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('PREVIEW-003 Redirigir a autenticacion desde Cartas y certificaciones', async ({ page }) => {
  process.env.APP_SLUG = 'pruebaqa';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-003';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Cartas y certificaciones';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'Cartas y certificaciones',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Cartas y certificaciones',
      actionIntent: 'Clic en Cartas y certificaciones',
      expectedEffect: 'Derivar al acceso autenticado del kiosco',
      action: async () => {
        await page.getByText('Cartas y certificaciones').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'Iniciar sesión');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Iniciar sesión',
      assertion: async () => {
        const pageScan = await scanCurrentPage(page);
        const authGate = detectAuthGate(pageScan);
        expect(authGate?.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});