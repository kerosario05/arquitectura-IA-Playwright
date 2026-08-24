import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { OperationsMenuPage } from '../../../../pages/operationsmenu.page';
import { AuthFlow } from '../../../../flows/auth.flow';

test('PREVIEW-003 - Direccionamiento autenticado desde Transacciones y servicios', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-003';
  process.env.SCENARIO_TITLE = 'Direccionamiento autenticado desde Transacciones y servicios';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);
  const operationsMenuPage = new OperationsMenuPage(page);
  const authFlow = new AuthFlow(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'start flow',
      expectedEffect: 'landing content becomes available',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: '¿Qué deseas realizar hoy?',
      assertion: async () => {
        await expect(page.getByText('¿Qué deseas realizar hoy?')).toBeVisible();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'Transacciones y servicios',
      actionIntent: 'open transactions and services module',
      expectedEffect: 'authentication gate starts after selecting the module',
      action: async () => {
        await operationsMenuPage.openModule('Transacciones y servicios');
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      target: 'flujo de autenticación',
      assertion: async () => {
        await expect(await authFlow.detectCurrentStage()).toBe('identification_type_selection');
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
