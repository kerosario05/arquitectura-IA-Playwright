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

test('Descargar plantilla para carga de nómina', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 116000));
  process.env.APP_SLUG = 'portal-empresarial';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Descargar plantilla para carga de nómina';
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
      target: 'css:[href="/templates/PlantillaGestionEmpresarial.xlsx"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="/templates/PlantillaGestionEmpresarial.xlsx"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"/templates/PlantillaGestionEmpresarial.xlsx\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"/templates/PlantillaGestionEmpresarial.xlsx"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC de la empresa*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC de la empresa*')!)!.fill(String(process.env['PROMOTED_RNC_DE_LA_EMPRESA'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre de usuario*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre de usuario*')!)!.fill(String(process.env['PROMOTED_NOMBRE_DE_USUARIO'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña*')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña*', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 5, target: 'role:textbox|Contraseña*', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:button|Gestión de Nóminas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Gestión de Nóminas')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="/templates/PlantillaGestionEmpresarial.xlsx"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 7,
      target: 'click aquí para descargar',
      polarity: "positive",
      expectedUrl: 'https://172.27.4.31/payroll/electronicPayroll',
      assertion: async () => { await expect(page).toHaveURL("https://172.27.4.31/payroll/electronicPayroll"); },
      requireCompletionSignal: true,
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
