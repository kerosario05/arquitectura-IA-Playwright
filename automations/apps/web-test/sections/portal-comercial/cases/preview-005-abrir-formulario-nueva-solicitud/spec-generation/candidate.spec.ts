import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Abrir formulario Nueva solicitud', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 100000));
  process.env.APP_SLUG = 'web-test';
  process.env.SECTION_SLUG = 'portal-comercial';
  process.env.SCENARIO_ID = 'PREVIEW-005';
  process.env.SCENARIO_TITLE = 'Abrir formulario Nueva solicitud';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.fill({
      stepIndex: 2,
      target: 'role:textbox|Usuario',
      value: String(process.env['PROMOTED_USUARIO'] ?? ''),
      valueKey: 'usuario',
      technicalTargetRefs: ['role:textbox|Usuario', 'css:#usuario', 'id:usuario'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 3,
      target: 'role:textbox|Contraseña',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña', 'css:#clave', 'id:clave'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 4,
      target: 'css:[id="btn-login"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="btn-login"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"btn-login\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"btn-login"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"login-form"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{\"id\":\"btn-login\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 5,
      target: 'css:[href="#/solicitud/nueva"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/solicitud/nueva"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/solicitud/nueva\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/solicitud/nueva"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"nav"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/solicitud/nueva\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      target: 'Nueva solicitud',
      polarity: "positive",
      expectedUrl: 'http://localhost:4310/#/solicitud/nueva',
      assertion: async () => { await expect(page).toHaveURL("http://localhost:4310/#/solicitud/nueva"); },
      requireCompletionSignal: true,
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
