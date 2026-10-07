import { test } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Agregar un empleado manualmente con cédula', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 220000));
  process.env.APP_SLUG = 'portal-empresarial';
  process.env.SECTION_SLUG = 'api-tests';
  process.env.SCENARIO_ID = 'PREVIEW-004';
  process.env.SCENARIO_TITLE = 'Agregar un empleado manualmente con cédula';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.fill({
      stepIndex: 2,
      target: 'role:textbox|RNC de la empresa*',
      value: String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? ''),
      valueKey: 'rnc_de_la_empresa',
      technicalTargetRefs: ['role:textbox|RNC de la empresa*', 'css:#rnc', 'id:rnc'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 3,
      target: 'role:textbox|Nombre de usuario*',
      value: String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? ''),
      valueKey: 'nombre_de_usuario',
      technicalTargetRefs: ['role:textbox|Nombre de usuario*', 'css:#email', 'id:email'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 4,
      target: 'role:textbox|Contraseña*',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña*', 'css:#password', 'id:password'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    await pageObject.press({
      stepIndex: 5,
      target: 'role:textbox|Contraseña*',
      technicalTargetRefs: ['css:#password', 'id:password'],
      key: 'Enter'
    });
    await pageObject.click({
      stepIndex: 6,
      target: 'role:button|Gestión de Nóminas',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Gestión de Nóminas'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 5, target: 'role:textbox|Contraseña*', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 7,
      target: 'role:button|Crear Manualmente',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Crear Manualmente'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 5, target: 'role:textbox|Contraseña*', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 8,
      target: 'role:button|Close',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Close'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 5, target: 'role:textbox|Contraseña*', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 9,
      target: 'css:[aria-label="Seleccionar fila"][role="checkbox"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Seleccionar fila"][role="checkbox"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Seleccionar fila\"][role=\"checkbox\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button","role":"checkbox"},"stableDirectAttributes":{"aria-label":"Seleccionar fila","role":"checkbox"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      checkState: 'checked',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 5, target: 'role:textbox|Contraseña*', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:button|Close', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccionar fila"][role="checkbox"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 10,
      target: 'role:button',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button'],
      associatedField: 'Tipo de ID',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 5, target: 'role:textbox|Contraseña*', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:button|Close', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Seleccionar fila"][role="checkbox"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccionar fila"][role="checkbox"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 11,
      target: 'role:option|cédula',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:option|cédula'],
      selectionActivationField: 'Tipo de ID',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 5, target: 'role:textbox|Contraseña*', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:button|Close', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Seleccionar fila"][role="checkbox"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccionar fila"][role="checkbox"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:button', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|cédula')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 12,
      target: 'Colaborador',
      value: String(process.env['PROMOTED_COLABORADOR'] ?? ''),
      valueKey: 'colaborador',
      fill: async () => { await page.getByLabel('Colaborador').fill(String(process.env['PROMOTED_COLABORADOR'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 13,
      target: 'Puesto',
      value: String(process.env['PROMOTED_PUESTO'] ?? ''),
      valueKey: 'puesto',
      fill: async () => { await page.getByLabel('Puesto').fill(String(process.env['PROMOTED_PUESTO'] ?? '')); }
    });
    await pageObject.select({
      stepIndex: 14,
      target: 'role:combobox|Moneda',
      selectionValue: 'DOP',
      selectionField: 'Moneda',
      associatedField: 'Ingresos',
      technicalTargetRefs: ['role:combobox|Moneda'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await page.getByRole('option', { name: 'DOP', exact: true }).click(); }
    });
    await pageObject.fill({
      stepIndex: 15,
      target: 'Ingresos',
      value: String(process.env['PROMOTED_INGRESOS'] ?? ''),
      valueKey: 'ingresos',
      fill: async () => { await page.getByLabel('Ingresos').fill(String(process.env['PROMOTED_INGRESOS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 16,
      target: 'Correo electrónico',
      value: String(process.env['PROMOTED_CORREO_ELECTRONICO'] ?? ''),
      valueKey: 'correo_electronico',
      fill: async () => { await page.getByLabel('Correo electrónico').fill(String(process.env['PROMOTED_CORREO_ELECTRONICO'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 17,
      target: 'Teléfono residencial',
      value: String(process.env['PROMOTED_TELEFONO_RESIDENCIAL'] ?? ''),
      valueKey: 'telefono_residencial',
      fill: async () => { await page.getByLabel('Teléfono residencial').fill(String(process.env['PROMOTED_TELEFONO_RESIDENCIAL'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 18,
      target: 'Celular',
      value: String(process.env['PROMOTED_CELULAR'] ?? ''),
      valueKey: 'celular',
      fill: async () => { await page.getByLabel('Celular').fill(String(process.env['PROMOTED_CELULAR'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 19,
      target: 'Fecha de Ingreso',
      value: String(process.env['PROMOTED_FECHA_DE_INGRESO'] ?? ''),
      valueKey: 'fecha_de_ingreso',
      fill: async () => { await page.getByLabel('Fecha de Ingreso').fill(String(process.env['PROMOTED_FECHA_DE_INGRESO'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 20,
      target: 'role:button|Validar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Validar'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 5, target: 'role:textbox|Contraseña*', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:button|Close', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Seleccionar fila"][role="checkbox"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccionar fila"][role="checkbox"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:button', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'role:option|cédula', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|cédula')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'Colaborador', sensitive: false, replay: async () => { await page.getByLabel('Colaborador').fill(String(process.env['PROMOTED_COLABORADOR'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'Puesto', sensitive: false, replay: async () => { await page.getByLabel('Puesto').fill(String(process.env['PROMOTED_PUESTO'] ?? '')); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'Ingresos', sensitive: false, replay: async () => { await page.getByLabel('Ingresos').fill(String(process.env['PROMOTED_INGRESOS'] ?? '')); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'Correo electrónico', sensitive: false, replay: async () => { await page.getByLabel('Correo electrónico').fill(String(process.env['PROMOTED_CORREO_ELECTRONICO'] ?? '')); } }, { stepIndex: 17, actionIntent: 'restore_recorded_context', target: 'Teléfono residencial', sensitive: false, replay: async () => { await page.getByLabel('Teléfono residencial').fill(String(process.env['PROMOTED_TELEFONO_RESIDENCIAL'] ?? '')); } }, { stepIndex: 18, actionIntent: 'restore_recorded_context', target: 'Celular', sensitive: false, replay: async () => { await page.getByLabel('Celular').fill(String(process.env['PROMOTED_CELULAR'] ?? '')); } }, { stepIndex: 19, actionIntent: 'restore_recorded_context', target: 'Fecha de Ingreso', sensitive: false, replay: async () => { await page.getByLabel('Fecha de Ingreso').fill(String(process.env['PROMOTED_FECHA_DE_INGRESO'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Validar')!)!.click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
