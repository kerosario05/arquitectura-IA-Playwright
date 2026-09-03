import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

test.describe('C44732 - Acceder sin autenticacion a Explora nuestros productos', () => {
  test('Acceder sin autenticacion a Explora nuestros productos', async ({ page }) => {
    process.env.APP_SLUG = 'bsc';
    process.env.SECTION_SLUG = 'detalle-kiosko';
    process.env.SCENARIO_ID = 'C44732';
    process.env.SCENARIO_TITLE = 'Acceder sin autenticacion a Explora nuestros productos';

    const promotedRuntime = createPromotedSpecRuntime(page);

    try {
      await promotedRuntime.expectPromotedVisible({
        stepIndex: 1,
        target: 'Explora nuestros productos',
        assertion: async () => {
          await expect(page.getByText('Explora nuestros productos')).toBeVisible();
        }
      });

      await promotedRuntime.clickPromotedTarget({
        stepIndex: 2,
        target: 'Explora nuestros productos',
        actionIntent: 'open the unauthenticated products information',
        expectedEffect: 'the products information is shown without authentication',
        action: async () => {
          await page.getByText('Explora nuestros productos').click();
        }
      });

      await promotedRuntime.expectPromotedVisible({
        stepIndex: 3,
        target: 'La opcion Explora nuestros productos abre la informacion de productos sin autenticacion.',
        assertion: async () => {
          await expect(page.getByText('La opcion Explora nuestros productos abre la informacion de productos sin autenticacion.')).toBeVisible();
        }
      });
    } finally {
      await promotedRuntime.finishEvidence();
    }
  });
});