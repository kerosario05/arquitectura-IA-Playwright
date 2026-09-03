import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('Validar redireccion a autenticacion desde Cartas y certificaciones', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44736';
  process.env.SCENARIO_TITLE = 'Validar redireccion a autenticacion desde Cartas y certificaciones';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Cartas y certificaciones',
      actionIntent: 'click the option',
      expectedEffect: 'open the authentication gate',
      action: async () => {
        await page.getByText('Cartas y certificaciones').click();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Se observa el gate de autenticacion para Cartas y certificaciones.',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(2, 'Se observa el gate de autenticacion para Cartas y certificaciones.');
        const currentPageState = await scanCurrentPage(page);
        const authGate = detectAuthGate(currentPageState);
        if (authGate?.stage !== 'identification_type_selection') {
          throw new Error('Expected identification_type_selection auth gate stage');
        }
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});