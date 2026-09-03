import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('Validar redireccion a autenticacion desde Consulta de balance', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44735';
  process.env.SCENARIO_TITLE = 'Validar redireccion a autenticacion desde Consulta de balance';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Consulta de balance',
      actionIntent: 'clic en Consulta de balance',
      expectedEffect: 'redirigir a la autenticacion del kiosco',
      action: async () => {
        await page.getByText('Consulta de balance', { exact: true }).click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Se observa el gate de autenticacion para Consulta de balance.',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(2, 'Se observa el gate de autenticacion para Consulta de balance.');
        const pageDiag = await scanCurrentPage(page);
        const authGate = await detectAuthGate(pageDiag);
        if (authGate?.stage !== 'identification_type_selection') {
          throw new Error('Expected identification_type_selection auth gate stage.');
        }
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
