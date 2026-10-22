export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Transferencia exitosa entre cuentas propias con verificación de acceso y token', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 332000));
  process.env.APP_SLUG = 'fenix';
  process.env.SECTION_SLUG = 'demoblaze';
  process.env.SCENARIO_ID = 'C55032';
  process.env.SCENARIO_TITLE = 'Transferencia exitosa entre cuentas propias con verificación de acceso y token';
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
      value: String(process.env['PROMOTED_USUARIO'] ?? ''),
      valueKey: 'usuario',
      authGateExpected: true,
      fill: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); }
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
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }],
      action: async () => { await page.getByText('Iniciar sesión').click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 7,
      target: 'se muestre la pantalla de "verificación de usuario"',
      polarity: "positive",
      expectedUrl: 'https://qa1.santacruz.do/onlinebanking/IdentifyUser',
      assertion: async () => { await expect(page).toHaveURL("https://qa1.santacruz.do/onlinebanking/IdentifyUser"); }
    });
    await pageObject.click({
      stepIndex: 8,
      target: 'SMS',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Iniciar sesión', sensitive: false, replay: async () => { await page.getByText('Iniciar sesión').click(); } }],
      action: async () => { await page.getByText('SMS').click(); }
    });
    await pageObject.fill({
      stepIndex: 9,
      target: 'text:Código',
      value: String(process.env['PROMOTED_CODIGO_ACCESO'] ?? ''),
      valueKey: 'codigo_acceso',
      technicalTargetRefs: ['text:Código'],
      playwrightRecorderEvidence: {"kind":"segmented_input","scopeIdentity":{"strategy":"css","value":"#IdentifyUserForm"},"segmentCount":6,"runtimeResolutionRequired":true,"captureMatchCount":1},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Código')!, true)!.fill(String(process.env['PROMOTED_CODIGO_ACCESO'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 10,
      target: 'continuar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Iniciar sesión', sensitive: false, replay: async () => { await page.getByText('Iniciar sesión').click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'SMS', sensitive: false, replay: async () => { await page.getByText('SMS').click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Código', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Código')!, true)!.fill(String(process.env['PROMOTED_CODIGO_ACCESO'] ?? '')); } }],
      action: async () => { await page.getByText('continuar').click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 11,
      target: 'text:Resumen | Cuentas por Pagar',
      description: 'Validar que se muestre "resumen de sus productos"',
      polarity: 'positive',
      assertion: async () => { await Promise.all(["Resumen","Cuentas por Pagar"].map((text) => expect(page.getByText(text, { exact: true }).filter({ visible: true }).first()).toBeVisible())); }
    });
    await pageObject.click({
      stepIndex: 12,
      target: 'Transferencias',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Iniciar sesión', sensitive: false, replay: async () => { await page.getByText('Iniciar sesión').click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'SMS', sensitive: false, replay: async () => { await page.getByText('SMS').click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Código', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Código')!, true)!.fill(String(process.env['PROMOTED_CODIGO_ACCESO'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'continuar', sensitive: false, replay: async () => { await page.getByText('continuar').click(); } }],
      action: async () => { await page.getByText('Transferencias').click(); }
    });
    await pageObject.click({
      stepIndex: 13,
      target: 'Cuentas Propias',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Iniciar sesión', sensitive: false, replay: async () => { await page.getByText('Iniciar sesión').click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'SMS', sensitive: false, replay: async () => { await page.getByText('SMS').click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Código', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Código')!, true)!.fill(String(process.env['PROMOTED_CODIGO_ACCESO'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'continuar', sensitive: false, replay: async () => { await page.getByText('continuar').click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'Transferencias', sensitive: false, replay: async () => { await page.getByText('Transferencias').click(); } }],
      action: async () => { await page.getByText('Cuentas Propias').click(); }
    });
    await pageObject.select({
      stepIndex: 14,
      target: 'Cuenta de origen',
      selectionValue: 'Cuenta Corriente',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await page.getByRole('option', { name: 'Cuenta Corriente', exact: true }).click(); }
    });
    await pageObject.select({
      stepIndex: 15,
      target: 'Cuenta de destino',
      selectionValue: 'Cuenta de Ahorros',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await page.getByRole('option', { name: 'Cuenta de Ahorros', exact: true }).click(); }
    });
    await pageObject.fill({
      stepIndex: 16,
      target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]',
      value: String(process.env['PROMOTED_MONTO'] ?? ''),
      valueKey: 'monto',
      technicalTargetRefs: ['css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill(String(process.env['PROMOTED_MONTO'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 17,
      target: 'Continuar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Iniciar sesión', sensitive: false, replay: async () => { await page.getByText('Iniciar sesión').click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'SMS', sensitive: false, replay: async () => { await page.getByText('SMS').click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Código', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Código')!, true)!.fill(String(process.env['PROMOTED_CODIGO_ACCESO'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'continuar', sensitive: false, replay: async () => { await page.getByText('continuar').click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'Transferencias', sensitive: false, replay: async () => { await page.getByText('Transferencias').click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'Cuentas Propias', sensitive: false, replay: async () => { await page.getByText('Cuentas Propias').click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill(String(process.env['PROMOTED_MONTO'] ?? '')); } }],
      action: async () => { await page.getByText('Continuar').click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 18,
      target: 'text:Transferencias a Mis Cuentas',
      description: 'Validar que se muestre "la confirmación de la transferencia"',
      polarity: 'positive',
      assertion: async () => { await expect(page.getByText('Transferencias a Mis Cuentas', { exact: true }).filter({ visible: true }).first()).toBeVisible(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 19,
      target: 'text:Cuenta Origen | Cuenta Destino',
      description: 'Validar que la confirmación muestre las "cuentas seleccionadas".',
      polarity: 'positive',
      assertion: async () => { await Promise.all(["Cuenta Origen","Cuenta Destino"].map((text) => expect(page.getByText(text, { exact: true }).filter({ visible: true }).first()).toBeVisible())); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 20,
      target: 'text:Monto a Acreditar',
      description: 'Validar que la confirmación muestre el "monto".',
      polarity: 'positive',
      assertion: async () => { await expect(page.getByText('Monto a Acreditar', { exact: true }).filter({ visible: true }).first()).toBeVisible(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 21,
      target: 'text:Comisión',
      description: 'Validar que la confirmación muestre la "comisión".',
      polarity: 'positive',
      assertion: async () => { await expect(page.getByText('Comisión', { exact: true }).filter({ visible: true }).first()).toBeVisible(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 22,
      target: 'text:Impuesto 0.20%',
      description: 'Validar que la confirmación muestre los "impuestos".',
      polarity: 'positive',
      assertion: async () => { await expect(page.getByText('Impuesto 0.20%', { exact: true }).filter({ visible: true }).first()).toBeVisible(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 23,
      target: 'text:Tasa de Cambio',
      description: 'Validar que se muestre "tasa de cambio"',
      polarity: 'positive',
      assertion: async () => { await expect(page.getByText('Tasa de Cambio', { exact: true }).filter({ visible: true }).first()).toBeVisible(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 24,
      target: 'text:Total a Debitar',
      description: 'Validar que la confirmación muestre el "total a debitar".',
      polarity: 'positive',
      assertion: async () => { await expect(page.getByText('Total a Debitar', { exact: true }).filter({ visible: true }).first()).toBeVisible(); }
    });
    await pageObject.click({
      stepIndex: 25,
      target: 'Continuar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Iniciar sesión', sensitive: false, replay: async () => { await page.getByText('Iniciar sesión').click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'SMS', sensitive: false, replay: async () => { await page.getByText('SMS').click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Código', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Código')!, true)!.fill(String(process.env['PROMOTED_CODIGO_ACCESO'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'continuar', sensitive: false, replay: async () => { await page.getByText('continuar').click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'Transferencias', sensitive: false, replay: async () => { await page.getByText('Transferencias').click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'Cuentas Propias', sensitive: false, replay: async () => { await page.getByText('Cuentas Propias').click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill(String(process.env['PROMOTED_MONTO'] ?? '')); } }, { stepIndex: 17, actionIntent: 'restore_recorded_context', target: 'Continuar', sensitive: false, replay: async () => { await page.getByText('Continuar').click(); } }],
      action: async () => { await page.getByText('Continuar').click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 26,
      target: 'se muestre la pantalla de "validación de identidad"',
      polarity: "positive",
      expectedUrl: 'https://qa1.santacruz.do/onlinebanking/QueryBank/Summary',
      assertion: async () => { await expect(page).toHaveURL("https://qa1.santacruz.do/onlinebanking/QueryBank/Summary"); }
    });
    await pageObject.click({
      stepIndex: 27,
      target: 'SMS',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Iniciar sesión', sensitive: false, replay: async () => { await page.getByText('Iniciar sesión').click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'SMS', sensitive: false, replay: async () => { await page.getByText('SMS').click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Código', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Código')!, true)!.fill(String(process.env['PROMOTED_CODIGO_ACCESO'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'continuar', sensitive: false, replay: async () => { await page.getByText('continuar').click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'Transferencias', sensitive: false, replay: async () => { await page.getByText('Transferencias').click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'Cuentas Propias', sensitive: false, replay: async () => { await page.getByText('Cuentas Propias').click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill(String(process.env['PROMOTED_MONTO'] ?? '')); } }, { stepIndex: 17, actionIntent: 'restore_recorded_context', target: 'Continuar', sensitive: false, replay: async () => { await page.getByText('Continuar').click(); } }, { stepIndex: 25, actionIntent: 'restore_recorded_context', target: 'Continuar', sensitive: false, replay: async () => { await page.getByText('Continuar').click(); } }],
      action: async () => { await page.getByText('SMS').click(); }
    });
    await pageObject.fill({
      stepIndex: 28,
      target: 'text:Token',
      value: String(process.env['PROMOTED_TOKEN_AUTORIZACION'] ?? ''),
      valueKey: 'token_autorizacion',
      technicalTargetRefs: ['text:Token'],
      playwrightRecorderEvidence: {"kind":"segmented_input","scopeIdentity":{"strategy":"css","value":"#requestchallengeform"},"segmentCount":6,"runtimeResolutionRequired":true,"captureMatchCount":1},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Token')!, true)!.fill(String(process.env['PROMOTED_TOKEN_AUTORIZACION'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 29,
      target: 'Continuar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'Empresarial', sensitive: false, replay: async () => { await page.getByText('Empresarial').click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Iniciar sesión', sensitive: false, replay: async () => { await page.getByText('Iniciar sesión').click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'SMS', sensitive: false, replay: async () => { await page.getByText('SMS').click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Código', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Código')!, true)!.fill(String(process.env['PROMOTED_CODIGO_ACCESO'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'continuar', sensitive: false, replay: async () => { await page.getByText('continuar').click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'Transferencias', sensitive: false, replay: async () => { await page.getByText('Transferencias').click(); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'Cuentas Propias', sensitive: false, replay: async () => { await page.getByText('Cuentas Propias').click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill(String(process.env['PROMOTED_MONTO'] ?? '')); } }, { stepIndex: 17, actionIntent: 'restore_recorded_context', target: 'Continuar', sensitive: false, replay: async () => { await page.getByText('Continuar').click(); } }, { stepIndex: 25, actionIntent: 'restore_recorded_context', target: 'Continuar', sensitive: false, replay: async () => { await page.getByText('Continuar').click(); } }, { stepIndex: 27, actionIntent: 'restore_recorded_context', target: 'SMS', sensitive: false, replay: async () => { await page.getByText('SMS').click(); } }, { stepIndex: 28, actionIntent: 'restore_recorded_context', target: 'text:Token', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Token')!, true)!.fill(String(process.env['PROMOTED_TOKEN_AUTORIZACION'] ?? '')); } }],
      action: async () => { await page.getByText('Continuar').click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 30,
      target: 'text:Comprobante | Transacción Exitosa | # Referencia:',
      description: 'El comprobante de transacción exitosa muestra la referencia de la operación.',
      polarity: 'positive',
      assertion: async () => { await Promise.all(["Comprobante","Transacción Exitosa","# Referencia:"].map((text) => expect(page.getByText(text, { exact: true }).filter({ visible: true }).first()).toBeVisible())); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 31,
      target: 'text:Monto a Acreditar: | Transferencias a Mis Cuentas',
      description: 'Validar que el comprobante muestre el "monto de la transferencia".',
      polarity: 'positive',
      assertion: async () => { await Promise.all(["Monto a Acreditar:","Transferencias a Mis Cuentas"].map((text) => expect(page.getByText(text, { exact: true }).filter({ visible: true }).first()).toBeVisible())); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 32,
      target: 'text:Cuenta Origen | Cuenta Destino',
      description: 'Validar que el comprobante muestre las "cuentas involucradas".',
      polarity: 'positive',
      assertion: async () => { await Promise.all(["Cuenta Origen","Cuenta Destino"].map((text) => expect(page.getByText(text, { exact: true }).filter({ visible: true }).first()).toBeVisible())); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 33,
      target: 'pattern:date_time',
      description: 'Validar que el comprobante muestre la "fecha y hora".',
      polarity: 'positive',
      assertion: async () => { await expect(page.getByText(new RegExp("\\b(?:\\d{1,2}[./-]\\d{1,2}[./-]\\d{2,4}|\\d{4}[./-]\\d{1,2}[./-]\\d{1,2})\\s+\\d{1,2}:\\d{2}(?::\\d{2})?\\s*(?:a\\.?m\\.?|p\\.?m\\.?)?\\b", 'i')).filter({ visible: true }).first()).toBeVisible(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 34,
      target: 'text:# Referencia: | Transacción Exitosa',
      description: 'Validar que el comprobante muestre la "referencia de la operación".',
      polarity: 'positive',
      assertion: async () => { await Promise.all(["# Referencia:","Transacción Exitosa"].map((text) => expect(page.getByText(text, { exact: true }).filter({ visible: true }).first()).toBeVisible())); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
