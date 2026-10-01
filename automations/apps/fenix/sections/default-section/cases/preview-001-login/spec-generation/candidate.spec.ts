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

test('Login', async ({ page }) => {
  process.env.APP_SLUG = 'fenix';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Login';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.click({
      stepIndex: 2,
      target: 'css:[href="#empresarial"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#empresarial"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#empresarial\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#empresarial"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"login-box-parent"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#empresarial\"},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",1]],\\\"descendantEntries\\\":[[\\\"span\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); }
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
    await pageObject.press({
      stepIndex: 6,
      target: 'role:textbox|Contraseña:',
      key: 'Enter'
    });
    await pageObject.click({
      stepIndex: 7,
      target: 'text:SMS',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['text:SMS'],
      associatedField: 'SMS',
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"SMS","targetTag":"div","scopeIdentity":{"strategy":"id","value":"IdentifyUserForm"},"runtimeResolutionRequired":true},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', key: 'Enter' }); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 8,
      target: 'text:SMS',
      value: String(process.env['PROMOTED_SMS'] ?? ''),
      valueKey: 'sms',
      technicalTargetRefs: ['text:SMS'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"IdentifyUserForm"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 14,
      target: 'role:button|Continuar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Continuar'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 15,
      target: 'css:[id="profile-dropdown"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="profile-dropdown"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"profile-dropdown\"]","confidence":0.6}],"structuralContext":{"owner":{"tag":"div"},"stableDirectAttributes":{"id":"profile-dropdown"},"stableDescendants":[{"relation":"descendant","tag":"a","stableAttributes":{"href":"/onlinebanking/UserProfile/MyProfile","id":"ib-header-detail-btn"}},{"relation":"descendant","tag":"div","stableAttributes":{"id":"customer-name"}},{"relation":"descendant","tag":"div","stableAttributes":{"id":"customer-user"}},{"relation":"descendant","tag":"div","stableAttributes":{"id":"profile-name"}}],"semanticShape":["div","i"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"profile-dd-menu-container"},"targetFingerprint":"{\"owner\":{\"tag\":\"div\"},\"stableDirectAttributes\":{\"id\":\"profile-dropdown\"},\"stableDescendants\":[{\"relation\":\"descendant\",\"tag\":\"a\",\"stableAttributes\":{\"href\":\"/onlinebanking/UserProfile/MyProfile\",\"id\":\"ib-header-detail-btn\"}},{\"relation\":\"descendant\",\"tag\":\"div\",\"stableAttributes\":{\"id\":\"customer-name\"}},{\"relation\":\"descendant\",\"tag\":\"div\",\"stableAttributes\":{\"id\":\"customer-user\"}},{\"relation\":\"descendant\",\"tag\":\"div\",\"stableAttributes\":{\"id\":\"profile-name\"}}],\"semanticShape\":[\"div\",\"i\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"div\\\",2],[\\\"i\\\",1]],\\\"descendantEntries\\\":[[\\\"a\\\",1],[\\\"div\\\",4],[\\\"i\\\",2]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.6,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="profile-dropdown"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 16,
      target: 'css:[href="#"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#"},"stableDescendants":[],"semanticShape":["i","span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"profile-dropdown-menu"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#\"},\"stableDescendants\":[],\"semanticShape\":[\"i\",\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"i\\\",1],[\\\"span\\\",1]],\\\"descendantEntries\\\":[[\\\"i\\\",1],[\\\"span\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'css:[id="profile-dropdown"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="profile-dropdown"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 17,
      target: 'css:[href="/onlinebanking/Home/Logout"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="/onlinebanking/Home/Logout"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"/onlinebanking/Home/Logout\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"/onlinebanking/Home/Logout"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"exit-popup"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"/onlinebanking/Home/Logout\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'RNC', sensitive: true, replay: async () => { await page.getByLabel('RNC').fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'Usuario', sensitive: true, replay: async () => { await page.getByLabel('Usuario').fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'Contraseña', sensitive: true, replay: async () => { await page.getByLabel('Contraseña').fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'css:[id="profile-dropdown"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="profile-dropdown"]')!)!.click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[href="#"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="/onlinebanking/Home/Logout"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 17,
      target: 'Aceptar',
      polarity: "positive",
      expectedUrl: 'https://qa1.santacruz.do/onlinebanking/',
      assertion: async () => { await expect(page).toHaveURL("https://qa1.santacruz.do/onlinebanking/"); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
