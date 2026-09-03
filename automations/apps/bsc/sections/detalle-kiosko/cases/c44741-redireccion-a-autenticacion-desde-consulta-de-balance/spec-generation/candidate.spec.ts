import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test('C44741 - Redireccion a autenticacion desde Consulta de balance', async ({ page }) => {
  process.env.APP_SLUG = 'bsc';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44741';
  process.env.SCENARIO_TITLE = 'Redireccion a autenticacion desde Consulta de balance';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const operationsMenuPage = new OperationsMenuPage(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Consulta de balance',
      assertion: async () => {
        await operationsMenuPage.expectModuleVisible('Consulta de balance');
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Consulta de balance',
      actionIntent: 'open the balance consultation entry',
      expectedEffect: 'navigate into the balance consultation flow',
      action: async () => {
        await operationsMenuPage.openModule('Consulta de balance');
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'Consulta de balance redirige a la autenticacion del kiosco.',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(3, 'Consulta de balance redirige a la autenticacion del kiosco.');
        const authGateState = await detectAuthGate(await scanCurrentPage(page));
        expect(authGateState).toBeTruthy();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});