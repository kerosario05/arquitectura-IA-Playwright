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
  test.setTimeout(Math.max(test.info().timeout, 132000));
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
      target: 'role:textbox|RNC:',
      value: String(process.env['PROMOTED_RNC'] ?? ''),
      valueKey: 'rnc',
      technicalTargetRefs: ['role:textbox|RNC:', 'css:#Enterprise', 'id:Enterprise'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 4,
      target: 'role:textbox|Usuario:',
      value: String(process.env['PROMOTED_USUARIO'] ?? ''),
      valueKey: 'usuario',
      technicalTargetRefs: ['role:textbox|Usuario:', 'css:#UserNameE', 'id:UserNameE'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 5,
      target: 'role:textbox|Contraseña:',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña:', 'css:#PasswordE', 'id:PasswordE'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    await pageObject.press({
      stepIndex: 6,
      target: 'role:textbox|Contraseña:',
      technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'],
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
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }],
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
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 14,
      target: 'Continuar',
      polarity: "positive",
      expectedUrl: 'https://qa1.santacruz.do/onlinebanking/QueryBank/Summary',
      assertion: async () => { await expect(page).toHaveURL("https://qa1.santacruz.do/onlinebanking/QueryBank/Summary"); },
      requireCompletionSignal: true,
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
