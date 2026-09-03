import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('Validar redireccion a autenticacion desde Estados de cuenta', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44734';
  process.env.SCENARIO_TITLE = 'Validar redireccion a autenticacion desde Estados de cuenta';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Estados de cuenta',
      actionIntent: 'click the Estados de cuenta entry',
      expectedEffect: 'navigate into the authentication gate flow',
      action: async () => {
        await page.getByText('Estados de cuenta', { exact: true }).click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Se observa el gate de autenticacion para Estados de cuenta.',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(2, 'Se observa el gate de autenticacion para Estados de cuenta.');
        const authGate = await detectAuthGate(await scanCurrentPage(page));
        expect(authGate?.stage).toBe('identification_type_selection');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
