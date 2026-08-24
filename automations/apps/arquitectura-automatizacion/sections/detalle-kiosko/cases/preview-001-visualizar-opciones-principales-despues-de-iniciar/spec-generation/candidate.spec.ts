import { test, expect } from '@playwright/test';
import { HomePage } from '../../../../pages/home.page';
import { createPromotedSpecRuntime } from '../../../../src/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'arquitectura-automatizacion';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Visualizar opciones principales despues de iniciar';

test('PREVIEW-001 - Visualizar opciones principales despues de iniciar', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);
  const homePage = new HomePage(page);

  try {
    await homePage.open();

    await homePage.start();

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 1,
      description: 'Validar que se muestre "¿Qué deseas realizar hoy?".',
      target: { strategy: 'text', value: '¿Qué deseas realizar hoy?' },
      assertion: async () => {
        await expect(page.getByText('¿Qué deseas realizar hoy?', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      description: 'Validar que se muestre "Información de productos".',
      target: { strategy: 'text', value: 'Información de productos' },
      assertion: async () => {
        await expect(page.getByText('Información de productos', { exact: true })).toBeVisible();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      description: 'Validar que se muestre "Transacciones y servicios".',
      target: { strategy: 'text', value: 'Transacciones y servicios' },
      assertion: async () => {
        await expect(page.getByText('Transacciones y servicios', { exact: true })).toBeVisible();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
