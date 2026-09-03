import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';

test.describe('PREVIEW-001 - Visualizar la nueva pantalla principal y redirigir a autenticacion desde Estados de cuenta', () => {
  test('Visualizar la nueva pantalla principal y redirigir a autenticacion desde Estados de cuenta', async ({ page }) => {
    process.env.APP_SLUG = 'pruebaqa';
    process.env.SECTION_SLUG = 'detalle-kiosko';
    process.env.SCENARIO_ID = 'PREVIEW-001';
    process.env.SCENARIO_TITLE = 'Visualizar la nueva pantalla principal y redirigir a autenticacion desde Estados de cuenta';

    const promotedRuntime = createPromotedSpecRuntime(page);

    try {
      await promotedRuntime.expectPromotedVisible({
        stepIndex: 0,
        target: 'Estados de cuenta',
        assertion: async () => {
          await expect(page.getByText('Estados de cuenta')).toBeVisible();
        },
      });

      await promotedRuntime.expectPromotedVisible({
        stepIndex: 1,
        target: 'Consulta de balance',
        assertion: async () => {
          await expect(page.getByText('Consulta de balance')).toBeVisible();
        },
      });

      await promotedRuntime.expectPromotedVisible({
        stepIndex: 2,
        target: 'Cartas y certificaciones',
        assertion: async () => {
          await expect(page.getByText('Cartas y certificaciones')).toBeVisible();
        },
      });

      await promotedRuntime.expectPromotedVisible({
        stepIndex: 3,
        target: 'Canje de Puntos',
        assertion: async () => {
          await expect(page.getByText('Canje de Puntos')).toBeVisible();
        },
      });

      await promotedRuntime.expectPromotedVisible({
        stepIndex: 4,
        target: 'Explora nuestros productos',
        assertion: async () => {
          await expect(page.getByText('Explora nuestros productos')).toBeVisible();
        },
      });

      await promotedRuntime.clickPromotedTarget({
        stepIndex: 5,
        target: 'Estados de cuenta',
        actionIntent: 'Abrir la opcion Estados de cuenta para iniciar el flujo autenticado.',
        expectedEffect: 'Navegar al inicio del gate de autenticacion.',
        action: async () => {
          await page.getByText('Estados de cuenta').click();
        },
      });

      await promotedRuntime.expectPromotedVisible({
        stepIndex: 6,
        target: 'Iniciar sesión',
        assertion: async () => {
          await promotedRuntime.waitForPromotedUiStable(6, 'Iniciar sesión');
          const currentPage = await scanCurrentPage(page);
          const authGate = await detectAuthGate(currentPage);
          expect(authGate?.stage).toBe('identification_type_selection');
        },
      });
    } finally {
      await promotedRuntime.finishEvidence();
    }
  });
});