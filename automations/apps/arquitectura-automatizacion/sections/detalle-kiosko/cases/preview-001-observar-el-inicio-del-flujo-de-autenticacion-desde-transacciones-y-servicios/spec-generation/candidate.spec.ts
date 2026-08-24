import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';
import { HomePage } from '../../../../pages/home.page';

test('Observar el inicio del flujo de autenticacion desde Transacciones y servicios', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Observar el inicio del flujo de autenticacion desde Transacciones y servicios';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Activar el inicio del flujo de autenticacion',
      expectedEffect: 'Desencadenar el limite de autenticacion en el acceso privado',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Transacciones y servicios',
      actionIntent: 'Abrir la opcion Transacciones y servicios',
      expectedEffect: 'Mostrar la opcion seleccionada en la interfaz',
      action: async () => {
        await page.getByText('Transacciones y servicios', { exact: true }).click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Transacciones y servicios',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(2, 'Transacciones y servicios');
        const pageDiag = await scanCurrentPage(page);
        const authGate = await detectAuthGate(pageDiag);
        expect(authGate.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});