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

test('Transferencias entre cuantas propias', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 300000));
  process.env.APP_SLUG = 'fenix';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Transferencias entre cuantas propias';
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
    await pageObject.fill({
      stepIndex: 9,
      target: 'text:SMS',
      value: String(process.env['PROMOTED_SMS'] ?? ''),
      valueKey: 'sms',
      technicalTargetRefs: ['text:SMS'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"IdentifyUserForm"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 10,
      target: 'text:SMS',
      value: String(process.env['PROMOTED_SMS'] ?? ''),
      valueKey: 'sms',
      technicalTargetRefs: ['text:SMS'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"IdentifyUserForm"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 11,
      target: 'text:SMS',
      value: String(process.env['PROMOTED_SMS'] ?? ''),
      valueKey: 'sms',
      technicalTargetRefs: ['text:SMS'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"IdentifyUserForm"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 12,
      target: 'text:SMS',
      value: String(process.env['PROMOTED_SMS'] ?? ''),
      valueKey: 'sms',
      technicalTargetRefs: ['text:SMS'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"IdentifyUserForm"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 13,
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
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 14,
      target: 'Continuar',
      polarity: "positive",
      expectedUrl: 'https://qa1.santacruz.do/onlinebanking/QueryBank/Summary',
      assertion: async () => { await expect(page).toHaveURL("https://qa1.santacruz.do/onlinebanking/QueryBank/Summary"); }
    });
    await pageObject.click({
      stepIndex: 15,
      target: 'text:Transferencias',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['text:Transferencias'],
      associatedField: 'Transferencias',
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"Transferencias","targetTag":"div","scopeIdentity":{"strategy":"id","value":"left-menu-accordion"},"runtimeResolutionRequired":true},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Transferencias')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 16,
      target: 'css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"/onlinebanking/Transfer/MyAccountsTransfer\"][id=\"TRANSFERS_INDIVIDUAL\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"/onlinebanking/Transfer/MyAccountsTransfer","id":"TRANSFERS_INDIVIDUAL"},"stableDescendants":[],"semanticShape":["div"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"menuid12"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"/onlinebanking/Transfer/MyAccountsTransfer\",\"id\":\"TRANSFERS_INDIVIDUAL\"},\"stableDescendants\":[],\"semanticShape\":[\"div\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"div\\\",1]],\\\"descendantEntries\\\":[[\\\"div\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'text:Transferencias', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Transferencias')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]')!)!.click(); }
    });
    await pageObject.select({
      stepIndex: 17,
      target: 'text:account-from-select-input',
      selectionIndex: 0,
      associatedField: 'account-from-select-input',
      technicalTargetRefs: ['text:account-from-select-input'],
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"Cuenta Corrientes / 11311000003156 / RD$162,312.94","scopeIdentity":{"strategy":"css","value":"div:has(> select[id=\"account-from-select-input\"])"},"runtimeResolutionRequired":true,"nativeSelection":{"controlIdentity":{"strategy":"id","value":"account-from-select-input"},"scopeIdentity":{"strategy":"css","value":"div:has(> select[id=\"account-from-select-input\"])"},"options":[{"value":"","label":"Seleccione una Cuenta","disabled":false},{"value":"-192973383173","label":"Cuenta Corrientes / 11311000003156 / RD$162,312.94","disabled":false},{"value":"-178671134322","label":"Cuenta de Ahorro / 21312020003368 / US$1,495.71","disabled":false}],"clickedOption":{"value":"-192973383173","label":"Cuenta Corrientes / 11311000003156 / RD$162,312.94"},"selectedValue":"-192973383173","selectionMode":"index","selectedOptionIndex":0},"captureMatchCount":1},
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { throw new Error('Recorded indexed selection requires runtime resolution'); }
    });
    await pageObject.select({
      stepIndex: 19,
      target: 'text:account-to-select-input',
      selectionIndex: 0,
      selectionField: 'account-to-select-input',
      associatedField: 'US$',
      technicalTargetRefs: ['text:account-to-select-input'],
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"Cuenta de Ahorro / 21312020003368 / US$1,495.71","scopeIdentity":{"strategy":"css","value":"div:has(> select[id=\"account-to-select-input\"])"},"runtimeResolutionRequired":true,"nativeSelection":{"controlIdentity":{"strategy":"id","value":"account-to-select-input"},"scopeIdentity":{"strategy":"css","value":"div:has(> select[id=\"account-to-select-input\"])"},"options":[{"value":"","label":"Seleccione una Cuenta","disabled":false},{"value":"-178671134322","label":"Cuenta de Ahorro / 21312020003368 / US$1,495.71","disabled":false}],"clickedOption":{"value":"-178671134322","label":"Cuenta de Ahorro / 21312020003368 / US$1,495.71"},"selectedValue":"-178671134322","selectionMode":"index","selectedOptionIndex":0},"captureMatchCount":1},
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { throw new Error('Recorded indexed selection requires runtime resolution'); }
    });
    await pageObject.fill({
      stepIndex: 20,
      target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]',
      value: '5.00',
      technicalTargetRefs: ['css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', 'css:#transactionDetails_0__AmountPayment', 'id:transactionDetails_0__AmountPayment'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill('5.00'); }
    });
    await pageObject.click({
      stepIndex: 21,
      target: 'role:button|Continuar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Continuar'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'text:Transferencias', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Transferencias')!)!.click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]')!)!.click(); } }, { stepIndex: 20, actionIntent: 'restore_recorded_context', target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill('5.00'); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 21,
      target: 'Continuar',
      polarity: "positive",
      expectedUrl: 'https://qa1.santacruz.do/onlinebanking/QueryBank/Summary',
      assertion: async () => { await expect(page).toHaveURL("https://qa1.santacruz.do/onlinebanking/QueryBank/Summary"); }
    });
    await pageObject.click({
      stepIndex: 22,
      target: 'css:[id="frmContinue"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="frmContinue"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"frmContinue\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"frmContinue"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"right-content-main"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{\"id\":\"frmContinue\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'text:Transferencias', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Transferencias')!)!.click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]')!)!.click(); } }, { stepIndex: 20, actionIntent: 'restore_recorded_context', target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill('5.00'); } }, { stepIndex: 21, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="frmContinue"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 22,
      target: 'Continuar',
      polarity: "positive",
      expectedUrl: 'https://qa1.santacruz.do/onlinebanking/QueryBank/Summary',
      assertion: async () => { await expect(page).toHaveURL("https://qa1.santacruz.do/onlinebanking/QueryBank/Summary"); }
    });
    await pageObject.click({
      stepIndex: 23,
      target: 'text:SMS',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['text:SMS'],
      associatedField: 'SMS',
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"SMS","targetTag":"div","scopeIdentity":{"strategy":"css","value":"div:has(a[id=\"token-resend-btn\"])"},"captureMatchCount":1,"runtimeResolutionRequired":true},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'text:Transferencias', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Transferencias')!)!.click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]')!)!.click(); } }, { stepIndex: 20, actionIntent: 'restore_recorded_context', target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill('5.00'); } }, { stepIndex: 21, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 22, actionIntent: 'restore_recorded_context', target: 'css:[id="frmContinue"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="frmContinue"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 24,
      target: 'text:Reenviar código en  29 segundos...',
      value: String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? ''),
      valueKey: 'reenviar_codigo_en_29_segundos',
      technicalTargetRefs: ['text:Reenviar código en  29 segundos...'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"requestchallengeform"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en  29 segundos...')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 25,
      target: 'text:Reenviar código en 29 segundos',
      value: String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? ''),
      valueKey: 'reenviar_codigo_en_29_segundos',
      technicalTargetRefs: ['text:Reenviar código en 29 segundos'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"requestchallengeform"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 26,
      target: 'text:Reenviar código en 29 segundos',
      value: String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? ''),
      valueKey: 'reenviar_codigo_en_29_segundos',
      technicalTargetRefs: ['text:Reenviar código en 29 segundos'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"requestchallengeform"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 27,
      target: 'text:Reenviar código en 29 segundos',
      value: String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? ''),
      valueKey: 'reenviar_codigo_en_29_segundos',
      technicalTargetRefs: ['text:Reenviar código en 29 segundos'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"requestchallengeform"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 28,
      target: 'text:Reenviar código en 29 segundos',
      value: String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? ''),
      valueKey: 'reenviar_codigo_en_29_segundos',
      technicalTargetRefs: ['text:Reenviar código en 29 segundos'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"requestchallengeform"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 29,
      target: 'text:Reenviar código en 29 segundos',
      value: String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? ''),
      valueKey: 'reenviar_codigo_en_29_segundos',
      technicalTargetRefs: ['text:Reenviar código en 29 segundos'],
      playwrightRecorderEvidence: {"kind":"segmented_input","targetTag":"input","scopeIdentity":{"strategy":"id","value":"requestchallengeform"},"captureMatchCount":1,"runtimeResolutionRequired":true,"segmentCount":6},
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 30,
      target: 'css:[id="validate_submit_token"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="validate_submit_token"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"validate_submit_token\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"input"},"stableDirectAttributes":{"id":"validate_submit_token"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"requestchallengeform"},"targetFingerprint":"{\"owner\":{\"tag\":\"input\"},\"stableDirectAttributes\":{\"id\":\"validate_submit_token\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#empresarial"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|RNC:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: true, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña:', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 6, target: 'role:textbox|Contraseña:', technicalTargetRefs: ['css:#PasswordE', 'id:PasswordE'], key: 'Enter' }); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.fill(String(process.env['PROMOTED_SMS'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'text:Transferencias', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Transferencias')!)!.click(); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="/onlinebanking/Transfer/MyAccountsTransfer"][id="TRANSFERS_INDIVIDUAL"]')!)!.click(); } }, { stepIndex: 20, actionIntent: 'restore_recorded_context', target: 'css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-val="true"][data-val-number="The field AmountPayment must be a number."][data-val-range="Monto a transferir debe ser mayor que 0."][data-val-range-max="1.79769313486232E+308"][data-val-range-min="0.01"][data-val-required="El campo \'Monto\' es requerido."][id="transactionDetails_0__AmountPayment"][name="transactionDetails[0].AmountPayment"]')!)!.fill('5.00'); } }, { stepIndex: 21, actionIntent: 'restore_recorded_context', target: 'role:button|Continuar', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Continuar')!)!.click(); } }, { stepIndex: 22, actionIntent: 'restore_recorded_context', target: 'css:[id="frmContinue"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="frmContinue"]')!)!.click(); } }, { stepIndex: 23, actionIntent: 'restore_recorded_context', target: 'text:SMS', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:SMS')!)!.click(); } }, { stepIndex: 24, actionIntent: 'restore_recorded_context', target: 'text:Reenviar código en  29 segundos...', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en  29 segundos...')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); } }, { stepIndex: 25, actionIntent: 'restore_recorded_context', target: 'text:Reenviar código en 29 segundos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); } }, { stepIndex: 26, actionIntent: 'restore_recorded_context', target: 'text:Reenviar código en 29 segundos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); } }, { stepIndex: 27, actionIntent: 'restore_recorded_context', target: 'text:Reenviar código en 29 segundos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); } }, { stepIndex: 28, actionIntent: 'restore_recorded_context', target: 'text:Reenviar código en 29 segundos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); } }, { stepIndex: 29, actionIntent: 'restore_recorded_context', target: 'text:Reenviar código en 29 segundos', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Reenviar código en 29 segundos')!)!.fill(String(process.env['PROMOTED_REENVIAR_CODIGO_EN_29_SEGUNDOS'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="validate_submit_token"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 30,
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
