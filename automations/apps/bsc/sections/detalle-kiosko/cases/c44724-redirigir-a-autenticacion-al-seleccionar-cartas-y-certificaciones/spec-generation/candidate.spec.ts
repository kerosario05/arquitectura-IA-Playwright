import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'C44724';
process.env.SCENARIO_TITLE = 'Redirigir a autenticacion al seleccionar Cartas y certificaciones';

test('Redirigir a autenticacion al seleccionar Cartas y certificaciones', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Cartas y certificaciones',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Cartas y certificaciones',
      actionIntent: 'Seleccionar Cartas y certificaciones',
      expectedEffect: 'Abrir la ruta que redirige al flujo de autenticacion del kiosco',
      action: async () => {
        await page.getByText('Cartas y certificaciones').click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'La opcion Cartas y certificaciones redirige a la autenticacion del kiosco.',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(3, 'La opcion Cartas y certificaciones redirige a la autenticacion del kiosco.');
        const gate = detectAuthGate(await scanCurrentPage(page));
        expect(gate?.stage).toBe('identification_type_selection');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
