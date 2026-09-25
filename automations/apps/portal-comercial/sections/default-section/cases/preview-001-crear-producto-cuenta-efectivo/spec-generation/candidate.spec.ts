import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { AuthFlow } from '../../../../flows/auth.flow';

process.env.APP_SLUG = 'portal-comercial';
process.env.SECTION_SLUG = 'default-section';
process.env.SCENARIO_ID = 'PREVIEW-001';
process.env.SCENARIO_TITLE = 'Crear Producto Cuenta Efectivo';

test('PREVIEW-001 - Crear Producto Cuenta Efectivo', async ({ page }) => {
  const promotedRuntime = createPromotedSpecRuntime(page);
  const authFlow = new AuthFlow(page);
  const username = process.env[['APP', 'USERNAME'].join('_')] ?? '';
  const password = process.env[['APP', 'PASSWORD'].join('_')] ?? '';

  try {
    await promotedRuntime.fillPromotedField({
      stepIndex: 1,
      target: 'Usuario',
      value: username,
      action: async () => {
        await page.locator('[id="username"]').fill(username);
      }
    });

    await promotedRuntime.fillPromotedField({
      stepIndex: 2,
      target: 'Contraseña',
      value: password,
      action: async () => {
        await page.locator('[id="password"]').fill(password);
      }
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'Iniciar sesión',
      actionIntent: 'Presionar el control de inicio de sesión',
      expectedEffect: 'La aplicación carga su pantalla inicial',
      action: async () => {
        await page.locator('[aria-label="Iniciar sesión"]').click();
      }
    });

    await promotedRuntime.waitForPromotedUiStable(3, 'Iniciar sesión');
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'Iniciar sesión',
      polarity: "positive",
      expectedUrl: 'https://srvqacgowb01.local.bsc.com:5000/requests/create/multiproduct',
      assertion: async () => {
        await expect(page).toHaveURL('https://srvqacgowb01.local.bsc.com:5000/requests/create/multiproduct');
      }
    });

    await authFlow.ensureAuthenticated();
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
