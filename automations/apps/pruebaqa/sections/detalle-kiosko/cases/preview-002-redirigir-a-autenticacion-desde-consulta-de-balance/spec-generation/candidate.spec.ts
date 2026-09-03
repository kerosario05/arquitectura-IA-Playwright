import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('PREVIEW-002 Redirigir a autenticacion desde Consulta de balance', async ({ page }) => {
  process.env.APP_SLUG = 'pruebaqa';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-002';
  process.env.SCENARIO_TITLE = 'Redirigir a autenticacion desde Consulta de balance';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 0,
      target: 'Consulta de balance',
      assertion: async () => {
        const pageDiag = await scanCurrentPage(page);
        const authGate = await detectAuthGate(pageDiag);
        expect(authGate?.stage).toBe('identification_type_selection');
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Consulta de balance',
      actionIntent: 'Clic en "Consulta de balance".',
      expectedEffect: 'Dirigir al mecanismo de autenticacion del kiosco.',
      action: async () => {
        await page.getByText('Consulta de balance').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'Iniciar sesión');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Iniciar sesión',
      assertion: async () => {
        const pageDiag = await scanCurrentPage(page);
        const authGate = await detectAuthGate(pageDiag);
        expect(authGate?.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});