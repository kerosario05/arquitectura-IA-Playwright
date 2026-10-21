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

test('Crear Cuenta Cliente', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 204000));
  process.env.APP_SLUG = 'portal-ventas-digital';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Crear Cuenta Cliente';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.click({
      stepIndex: 2,
      target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#"][id="nav-item-cuentas"][role="button"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#\"][id=\"nav-item-cuentas\"][role=\"button\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a","role":"button"},"stableDirectAttributes":{"href":"#","id":"nav-item-cuentas","role":"button"},"stableDescendants":[{"relation":"descendant","tag":"clippath","stableAttributes":{"id":"clip0_2384_5575"}}],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"nav-app-product-types"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\",\"role\":\"button\"},\"stableDirectAttributes\":{\"href\":\"#\",\"id\":\"nav-item-cuentas\",\"role\":\"button\"},\"stableDescendants\":[{\"relation\":\"descendant\",\"tag\":\"clippath\",\"stableAttributes\":{\"id\":\"clip0_2384_5575\"}}],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",3]],\\\"descendantEntries\\\":[[\\\"circle\\\",1],[\\\"clippath\\\",1],[\\\"defs\\\",1],[\\\"g\\\",1],[\\\"path\\\",6],[\\\"rect\\\",1],[\\\"span\\\",5],[\\\"svg\\\",2]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 3,
      target: 'css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"btn-solicitar-cuenta-de-ahorros-personal-en-pesos\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"btn-solicitar-cuenta-de-ahorros-personal-en-pesos"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"card-cuenta-de-ahorros-personal-en-pesos"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{\"id\":\"btn-solicitar-cuenta-de-ahorros-personal-en-pesos\"},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",1]],\\\"descendantEntries\\\":[[\\\"circle\\\",1],[\\\"path\\\",1],[\\\"span\\\",1],[\\\"svg\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 4,
      target: 'css:#x_DocumentId',
      value: String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? ''),
      valueKey: 'numero_de_identificacion',
      technicalTargetRefs: ['css:#x_DocumentId', 'id:x_DocumentId'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#x_DocumentId')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 5,
      target: 'role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-labelledby=\"el_AcceptTermsAndConditions\"][id=\"base-ui-_r_1i_\"][role=\"checkbox\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"span","role":"checkbox"},"stableDirectAttributes":{"aria-labelledby":"el_AcceptTermsAndConditions","id":"base-ui-_r_1i_","role":"checkbox"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"el_AcceptTermsAndConditions"},"targetFingerprint":"{\"owner\":{\"tag\":\"span\",\"role\":\"checkbox\"},\"stableDirectAttributes\":{\"id\":\"base-ui-_r_1i_\",\"role\":\"checkbox\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":false,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      checkState: 'checked',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:#x_DocumentId', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#x_DocumentId')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 6,
      target: 'css:[id="btn-identity-validate"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="btn-identity-validate"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"btn-identity-validate\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"btn-identity-validate"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"_r_1c_"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{\"id\":\"btn-identity-validate\"},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",1]],\\\"descendantEntries\\\":[[\\\"circle\\\",1],[\\\"path\\\",1],[\\\"span\\\",1],[\\\"svg\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:#x_DocumentId', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#x_DocumentId')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-validate"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 7,
      target: 'text:Selecciona la cuenta de tu preferencia',
      description: 'Se muestra "Selecciona la cuenta de tu preferencia"',
      polarity: 'positive',
      assertion: async () => { await expect(page.getByText('Selecciona la cuenta de tu preferencia', { exact: true })).toBeVisible(); }
    });
    await pageObject.click({
      stepIndex: 8,
      target: 'css:[id="btn-identity-confirm-and-continue"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="btn-identity-confirm-and-continue"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"btn-identity-confirm-and-continue\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"btn-identity-confirm-and-continue"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"_r_2e_"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{\"id\":\"btn-identity-confirm-and-continue\"},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",1]],\\\"descendantEntries\\\":[[\\\"circle\\\",1],[\\\"path\\\",1],[\\\"span\\\",1],[\\\"svg\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:#x_DocumentId', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#x_DocumentId')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-validate"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-validate"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-confirm-and-continue"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 9,
      target: 'text:Seleccione',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['text:Seleccione'],
      associatedField: 'Seleccione',
      playwrightRecorderEvidence: {"kind":"text","normalizedName":"Seleccione","targetTag":"div","scopeIdentity":{"strategy":"css","value":"div:has(input[id=\"react-select-6-input\"])"},"captureMatchCount":1,"runtimeResolutionRequired":true},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:#x_DocumentId', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#x_DocumentId')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-validate"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-validate"]')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-confirm-and-continue"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-confirm-and-continue"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Seleccione')!, true)!.click(); }
    });
    await pageObject.click({
      stepIndex: 10,
      target: 'role:option|829-***-0396',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:option|829-***-0396'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"react-select-6-option-1\"][role=\"option\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"div","role":"option"},"stableDirectAttributes":{"id":"react-select-6-option-1","role":"option"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"react-select-6-listbox"},"targetFingerprint":"{\"owner\":{\"tag\":\"div\",\"role\":\"option\"},\"stableDirectAttributes\":{\"id\":\"react-select-6-option-1\",\"role\":\"option\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      selectionActivationField: 'Seleccione',
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:#x_DocumentId', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#x_DocumentId')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-validate"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-validate"]')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-confirm-and-continue"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-confirm-and-continue"]')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Seleccione', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Seleccione')!, true)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|829-***-0396')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 11,
      target: 'css:[id="btn-send-sms-otp"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="btn-send-sms-otp"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"btn-send-sms-otp\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"btn-send-sms-otp"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:#x_DocumentId', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#x_DocumentId')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-validate"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-validate"]')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-confirm-and-continue"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-confirm-and-continue"]')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Seleccione', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Seleccione')!, true)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:option|829-***-0396', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|829-***-0396')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-send-sms-otp"]')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 12,
      target: 'role:textbox|Please enter verification code. Digit 1',
      value: String(process.env['PROMOTED_PLEASE_ENTER_VERIFICATION_CODE_DIGIT_1'] ?? ''),
      valueKey: 'please_enter_verification_code_digit_1',
      technicalTargetRefs: ['role:textbox|Please enter verification code. Digit 1'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Please enter verification code. Digit 1')!)!.fill(String(process.env['PROMOTED_PLEASE_ENTER_VERIFICATION_CODE_DIGIT_1'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 13,
      target: 'role:textbox|OTP digit 2',
      value: String(process.env['PROMOTED_OTP_DIGIT_2'] ?? ''),
      valueKey: 'otp_digit_2',
      technicalTargetRefs: ['role:textbox|OTP digit 2'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 2')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_2'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 14,
      target: 'role:textbox|OTP digit 3',
      value: String(process.env['PROMOTED_OTP_DIGIT_3'] ?? ''),
      valueKey: 'otp_digit_3',
      technicalTargetRefs: ['role:textbox|OTP digit 3'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 3')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_3'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 15,
      target: 'role:textbox|OTP digit 4',
      value: String(process.env['PROMOTED_OTP_DIGIT_4'] ?? ''),
      valueKey: 'otp_digit_4',
      technicalTargetRefs: ['role:textbox|OTP digit 4'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 4')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_4'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 16,
      target: 'role:textbox|OTP digit 5',
      value: String(process.env['PROMOTED_OTP_DIGIT_5'] ?? ''),
      valueKey: 'otp_digit_5',
      technicalTargetRefs: ['role:textbox|OTP digit 5'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 5')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_5'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 17,
      target: 'role:textbox|OTP digit 6',
      value: String(process.env['PROMOTED_OTP_DIGIT_6'] ?? ''),
      valueKey: 'otp_digit_6',
      technicalTargetRefs: ['role:textbox|OTP digit 6'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 6')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_6'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 18,
      target: 'css:[id="btn-validate-sms-otp"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="btn-validate-sms-otp"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"btn-validate-sms-otp\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"btn-validate-sms-otp"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[href="#"][id="nav-item-cuentas"][role="button"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#"][id="nav-item-cuentas"][role="button"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-solicitar-cuenta-de-ahorros-personal-en-pesos"]')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:#x_DocumentId', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:#x_DocumentId')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:checkbox|Acepto los Términos y Condiciones de la Aplicación Móvil, Web, Portal(es) y/o Pl')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-validate"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-validate"]')!)!.click(); } }, { stepIndex: 8, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-identity-confirm-and-continue"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-identity-confirm-and-continue"]')!)!.click(); } }, { stepIndex: 9, actionIntent: 'restore_recorded_context', target: 'text:Seleccione', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('text:Seleccione')!, true)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'role:option|829-***-0396', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:option|829-***-0396')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-send-sms-otp"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-send-sms-otp"]')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'role:textbox|Please enter verification code. Digit 1', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Please enter verification code. Digit 1')!)!.fill(String(process.env['PROMOTED_PLEASE_ENTER_VERIFICATION_CODE_DIGIT_1'] ?? '')); } }, { stepIndex: 13, actionIntent: 'restore_recorded_context', target: 'role:textbox|OTP digit 2', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 2')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_2'] ?? '')); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'role:textbox|OTP digit 3', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 3')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_3'] ?? '')); } }, { stepIndex: 15, actionIntent: 'restore_recorded_context', target: 'role:textbox|OTP digit 4', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 4')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_4'] ?? '')); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'role:textbox|OTP digit 5', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 5')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_5'] ?? '')); } }, { stepIndex: 17, actionIntent: 'restore_recorded_context', target: 'role:textbox|OTP digit 6', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|OTP digit 6')!)!.fill(String(process.env['PROMOTED_OTP_DIGIT_6'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[id="btn-validate-sms-otp"]')!)!.click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
