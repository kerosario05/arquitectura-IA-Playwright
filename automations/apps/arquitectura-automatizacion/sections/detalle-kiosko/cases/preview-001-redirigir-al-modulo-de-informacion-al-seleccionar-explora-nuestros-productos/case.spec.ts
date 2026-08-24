import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { HomePage } from '../../../../pages/home.page';

test('PREVIEW-001 - Redirigir al módulo de información al seleccionar Explora nuestros productos', async ({ page }) => {
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Redirigir al módulo de información al seleccionar Explora nuestros productos';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 0,
      target: 'Iniciar',
      actionIntent: 'Clic en "Iniciar".',
      expectedEffect: 'Abrir el flujo inicial de la interfaz',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      target: '¿Qué deseas realizar hoy?',
      assertion: async () => {
        await expect(page.getByText('¿Qué deseas realizar hoy?')).toBeVisible();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 2,
      target: 'Explora nuestros productos',
      actionIntent: 'Clic en "Explora nuestros productos".',
      expectedEffect: 'Navegar al módulo de información',
      action: async () => {
        await homePage.start();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'módulo de información',
      assertion: async () => {
        await promotedRuntime.waitForPromotedUiStable(3, 'módulo de información');
        await expect(page.url()).toContain('https://172.27.4.50/product-catalog');
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
