export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
import { test } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Captura web completa', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 108000));
  process.env.APP_SLUG = 'recording-regression-ec6fffc2';
  process.env.SECTION_SLUG = 'motor-de-grabacion';
  process.env.SCENARIO_ID = 'REC-ENGINE-001';
  process.env.SCENARIO_TITLE = 'Captura web completa';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.click({
      stepIndex: 2,
      target: 'css:[data-testid="open-form"][href="/form"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[data-testid="open-form"][href="/form"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[data-testid=\"open-form\"][href=\"/form\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"data-testid":"open-form","href":"/form"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-testid="open-form"][href="/form"]')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 3,
      target: 'role:textbox|Nombre',
      value: String(process.env['PROMOTED_NOMBRE'] ?? ''),
      valueKey: 'nombre',
      technicalTargetRefs: ['role:textbox|Nombre', 'css:#profile-name', 'id:profile-name'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre')!)!.fill(String(process.env['PROMOTED_NOMBRE'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 4,
      target: 'role:textbox|Contraseña',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña', 'css:#profile-password', 'id:profile-password'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    await pageObject.select({
      stepIndex: 5,
      target: 'text:USD',
      valueKey: 'moneda_seleccion',
      selectionValue: String(process.env['PROMOTED_MONEDA_SELECCION'] ?? ''),
      selectionIndex: 1,
      associatedField: 'Moneda',
      technicalTargetRefs: ['text:USD'],
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"USD","scopeIdentity":{"strategy":"css","value":"select[id=\"profile-currency\"]"},"runtimeResolutionRequired":true,"nativeSelection":{"controlIdentity":{"strategy":"id","value":"profile-currency"},"scopeIdentity":{"strategy":"css","value":"select[id=\"profile-currency\"]"},"fieldLabel":"Moneda","options":[{"value":"DOP","label":"DOP","disabled":false},{"value":"USD","label":"USD","disabled":false}],"selectedValue":"USD","clickedOption":{"value":"USD","label":"USD"},"selectionMode":"index","selectedOptionIndex":1},"captureMatchCount":1},
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { throw new Error('Recorded indexed selection requires runtime resolution'); }
    });
    await pageObject.click({
      stepIndex: 6,
      target: 'role:button|Guardar perfil',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Guardar perfil'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[data-testid="open-form"][href="/form"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-testid="open-form"][href="/form"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Nombre', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Nombre')!)!.fill(String(process.env['PROMOTED_NOMBRE'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Guardar perfil')!)!.click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
