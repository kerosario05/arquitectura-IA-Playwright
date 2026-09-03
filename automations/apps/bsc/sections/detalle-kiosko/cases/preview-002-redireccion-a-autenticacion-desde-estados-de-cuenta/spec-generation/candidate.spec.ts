import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('PREVIEW-002 - Redireccion a autenticacion desde Estados de cuenta', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-002';
  process.env.SCENARIO_TITLE = 'Redireccion a autenticacion desde Estados de cuenta';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'Estados de cuenta',
      assertion: async () => {
        await expect(page.getByText('Estados de cuenta', { exact: true })).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Estados de cuenta',
      actionIntent: 'open the Estados de cuenta entry',
      expectedEffect: 'navigate to the kiosk authentication gate',
      action: async () => {
        await page.getByText('Estados de cuenta', { exact: true }).click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'pantalla de autenticación del kiosco para iniciar sesión');

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'pantalla de autenticación del kiosco para iniciar sesión',
      assertion: async () => {
        const pageDiag = await scanCurrentPage(page);
        const authGate = await detectAuthGate(pageDiag);
        expect(authGate?.stage).toBe('identification_type_selection');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});