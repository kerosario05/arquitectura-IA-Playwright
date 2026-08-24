import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../src/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';
import { CategoryPage } from '../../../../pages/category.page';
import { AuthFlow } from '../../../../flows/auth.flow';

test('PREVIEW-005 - Iniciar autenticacion al seleccionar Transacciones y servicios', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-005';
  process.env.SCENARIO_TITLE = 'Iniciar autenticacion al seleccionar Transacciones y servicios';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);
  const categoryPage = new CategoryPage(page);
  const authFlow = new AuthFlow(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      description: 'Navigate to https://172.27.4.50',
      target: 'APP_BASE_URL',
      action: async () => {
        await homePage.open();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      description: 'Clic en "Iniciar".',
      target: 'Iniciar',
      action: async () => {
        await homePage.start();
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      description: 'Clic en "Transacciones y servicios".',
      target: 'Transacciones y serviciosRealiza operaciones con tus cuentas',
      action: async () => {
        await categoryPage.selectCategory('Transacciones y serviciosRealiza operaciones con tus cuentas');
      }
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      description: 'autenticación',
      target: 'auth_gate_runtime_state',
      assertion: async () => {
        await authFlow.ensureStageReady();
        const currentStage = await authFlow.detectCurrentStage();
        if (currentStage !== 'identification_type_selection') {
          throw new Error(`Expected auth gate stage identification_type_selection but received ${currentStage}`);
        }
      }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
