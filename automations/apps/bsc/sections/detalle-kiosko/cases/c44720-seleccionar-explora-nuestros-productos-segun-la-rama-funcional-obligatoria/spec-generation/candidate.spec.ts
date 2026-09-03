import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

process.env.APP_SLUG = 'bsc';
process.env.SECTION_SLUG = 'detalle-kiosko';
process.env.SCENARIO_ID = 'C44720';
process.env.SCENARIO_TITLE = 'Seleccionar Explora nuestros productos según la rama funcional obligatoria';

test('C44720 - Seleccionar Explora nuestros productos según la rama funcional obligatoria', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await promotedRuntime.clickPromotedTarget({
      stepIndex: 1,
      target: 'Explora nuestros productos',
      actionIntent: 'Clic en "Explora nuestros productos".',
      expectedEffect: 'Iniciar la rama funcional obligatoria del contrato.',
      action: async () => {
        await page.getByText('Explora nuestros productos').click();
      },
    });

    await promotedRuntime.waitForPromotedUiStable(2, 'La opción sigue la rama funcional exigida por el contrato de cobertura.');
  } finally {
    await promotedRuntime.finishEvidence();
  }
});