import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test('C44656 - Visualizar la nueva pantalla principal y redirigir a autenticacion desde Estados de cuenta', async ({ page }) => {
  process.env.APP_SLUG = 'pruebaqa';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C44656';
  process.env.SCENARIO_TITLE = 'Visualizar la nueva pantalla principal y redirigir a autenticacion desde Estados de cuenta';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: 'Estados de cuenta',
      assertion: async () => {
        await expect(page.getByText('Estados de cuenta')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'Consulta de balance',
      assertion: async () => {
        await expect(page.getByText('Consulta de balance')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'Cartas y certificaciones',
      assertion: async () => {
        await expect(page.getByText('Cartas y certificaciones')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'Canje de Puntos',
      assertion: async () => {
        await expect(page.getByText('Canje de Puntos')).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      target: 'Explora nuestros productos',
      assertion: async () => {
        await expect(page.getByText('Explora nuestros productos')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 6,
      target: 'Estados de cuenta',
      actionIntent: 'abrir la opcion Estados de cuenta',
      expectedEffect: 'inicia el acceso al flujo autenticado desde la nueva pantalla principal',
      action: async () => {
        await page.getByText('Estados de cuenta').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(7, 'La opcion Estados de cuenta inicia el acceso al flujo autenticado desde la nueva pantalla principal.');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 7,
      target: 'La opcion Estados de cuenta inicia el acceso al flujo autenticado desde la nueva pantalla principal.',
      assertion: async () => {
        await expect(page.getByText('Iniciar sesión')).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});