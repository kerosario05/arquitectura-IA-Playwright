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

test('Validar cédula con formato erróneo al agregar empleado manualmente', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 164000));
  process.env.APP_SLUG = 'portal-empresarial';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Validar cédula con formato erróneo al agregar empleado manualmente';
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
    await pageObject.click({
      stepIndex: 5,
      target: 'role:button|Continuar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Continuar'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 6,
      target: 'role:button|Gestión de Nóminas',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Gestión de Nóminas'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 7,
      target: 'role:button|Crear Manualmente',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Crear Manualmente'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 8,
      target: 'role:button|Close',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Close'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }],
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
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:button|Close', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccionar fila"][role="checkbox"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 10,
      target: 'role:button',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button'],
      associatedField: 'Tipo de ID',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:button|Close', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Seleccionar fila"][role="checkbox"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccionar fila"][role="checkbox"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 11,
      target: 'role:option|cédula',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:option|cédula'],
      selectionActivationField: 'Tipo de ID',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:button|Close', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Seleccionar fila"][role="checkbox"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccionar fila"][role="checkbox"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:button', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|cédula')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 12,
      target: 'Colaborador',
      value: String(process.env['PROMOTED_COLABORADOR'] ?? ''),
      valueKey: 'colaborador',
      fill: async () => { await page.getByLabel('Colaborador').fill(String(process.env['PROMOTED_COLABORADOR'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 13,
      target: 'role:button',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button'],
      associatedField: 'Puesto',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'role:button|Crear Manualmente', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Crear Manualmente')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'role:button|Close', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Close')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Seleccionar fila"][role="checkbox"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccionar fila"][role="checkbox"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:button', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'role:option|cédula', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|cédula')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'Colaborador', sensitive: false, replay: async () => { await page.getByLabel('Colaborador').fill(String(process.env['PROMOTED_COLABORADOR'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 13,
      target: 'Puesto',
      polarity: "positive",
      expectedUrl: 'https://172.27.4.31/payroll/manualCreationTable',
      assertion: async () => { await expect(page).toHaveURL("https://172.27.4.31/payroll/manualCreationTable"); },
      requireCompletionSignal: true,
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
