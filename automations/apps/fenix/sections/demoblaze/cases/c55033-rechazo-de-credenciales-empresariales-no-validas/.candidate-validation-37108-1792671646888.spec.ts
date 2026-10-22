import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Rechazo de credenciales empresariales no válidas', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 124000));
  process.env.APP_SLUG = 'fenix';
  process.env.SECTION_SLUG = 'demoblaze';
  process.env.SCENARIO_ID = 'C55033';
  process.env.SCENARIO_TITLE = 'Rechazo de credenciales empresariales no válidas';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.click({
      stepIndex: 2,
      target: 'Empresarial',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [],
      action: async () => { await page.getByText('Empresarial').click(); }
    });
    await pageObject.fill({
      stepIndex: 3,
      target: 'RNC',
      value: String(process.env['PROMOTED_RNC'] ?? ''),
      valueKey: 'rnc',
      authGateExpected: true,
      fill: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 4,
      target: 'Usuario',
      value: String(process.env['PROMOTED_AUTH_USERNAME'] ?? ''),
      valueKey: 'auth.username',
      authGateExpected: true,
      fill: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_AUTH_USERNAME'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 5,
      target: 'Contraseña',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      authGateExpected: true,
      fill: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 6,
      target: 'Iniciar sesión',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_AUTH_USERNAME'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }],
      action: async () => { await page.getByText('Iniciar sesión').click(); }
    });
    await promotedRuntime.expectPromotedVisible({ stepIndex: 7, target: "text:Credenciales inválidas", polarity: 'positive', credentialRejectionTarget: "Credenciales inválidas", assertion: async () => {} });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 8,
      target: "text:comprobante de transacción exitosa",
      description: "Validar que no se muestre \"comprobante de transacción exitosa\"",
      polarity: 'negative',
      negativeVisibilityTarget: "comprobante de transacción exitosa",
      assertion: async () => {},
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
