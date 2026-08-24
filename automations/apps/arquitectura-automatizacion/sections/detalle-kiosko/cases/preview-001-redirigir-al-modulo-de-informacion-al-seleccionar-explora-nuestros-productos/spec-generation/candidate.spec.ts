import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';

test('PREVIEW-001 - Redirigir al m\u00f3dulo de informaci\u00f3n al seleccionar Explora nuestros productos', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Redirigir al m\u00f3dulo de informaci\u00f3n al seleccionar Explora nuestros productos';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Click en Iniciar',
      expectedEffect: 'Abrir el flujo inicial de exploraci\u00f3n',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: '\u00bfQu\u00e9 deseas realizar hoy?',
      assertion: async () => {
        await expect(page.getByText('\u00bfQu\u00e9 deseas realizar hoy?')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Explora nuestros productos',
      actionIntent: 'Clic en Explora nuestros productos',
      expectedEffect: 'Navegar al m\u00f3dulo de informaci\u00f3n',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'm\u00f3dulo de informaci\u00f3n');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'm\u00f3dulo de informaci\u00f3n',
      assertion: async () => {
        await expect(page).toHaveURL(/https:\/\/172\.27\.4\.50\/product-catalog/);
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});