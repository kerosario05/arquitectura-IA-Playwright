import { test } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  upload(options: Parameters<typeof this.runtime.uploadRecordedFiles>[0]) { return this.runtime.uploadRecordedFiles(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Crear Cliente V2', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 444000));
  process.env.APP_SLUG = 'portal-comercial';
  process.env.SECTION_SLUG = 'api-tests';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Crear Cliente V2';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    const recordingPage_2 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 2,
      target: 'role:textbox|Usuario',
      value: String(process.env['PROMOTED_USUARIO'] ?? ''),
      valueKey: 'usuario',
      technicalTargetRefs: ['role:textbox|Usuario', 'css:#username', 'id:username'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); }
    });
    const recordingPage_3 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 3,
      target: 'role:textbox|Contraseña',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña', 'css:#password', 'id:password'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    const recordingPage_4 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.press({
      stepIndex: 4,
      target: 'role:textbox|Contraseña',
      technicalTargetRefs: ['css:#password', 'id:password'],
      key: 'Enter'
    });
    const recordingPage_5 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 5,
      target: 'css:[href="/requests/create/multiproduct"]',
      actionIntent: 'click',
      expectedEffect: 'navigation',
      technicalTargetRefs: ['css:[href="/requests/create/multiproduct"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"/requests/create/multiproduct\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"/requests/create/multiproduct"},"stableDescendants":[],"semanticShape":["span"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"pv_id_5_0_1"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"/requests/create/multiproduct\"},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",2]],\\\"descendantEntries\\\":[[\\\"span\\\",2]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:link|Solicitud multiproducto"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); }
    });
    const recordingPage_6 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 6,
      target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]',
      value: String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? ''),
      valueKey: 'numero_de_identificacion',
      technicalTargetRefs: ['css:[data-pc-name="inputmask"][data-pc-section="root"]'],
      fill: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); }
    });
    const recordingPage_7 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 7,
      target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); }
    });
    const recordingPage_8 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 8,
      target: 'U5ZQWPJQ 95Z5PPW WZUJP J4ZJXU5',
      selectionValue: 'U5ZQWPJQ 95Z5PPW WZUJP J4ZJXU5',
      selectionField: 'Oficial',
      associatedField: 'Oficial',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_8.getByRole('option', { name: 'U5ZQWPJQ 95Z5PPW WZUJP J4ZJXU5', exact: true }).click(); }
    });
    await pageObject.select({
      stepIndex: 9,
      target: 'U5ZQWPJQ UJ4JQ 45S5PY5 9WCU5XUW',
      selectionValue: 'U5ZQWPJQ UJ4JQ 45S5PY5 9WCU5XUW',
      selectionField: 'Promotor',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await page.getByRole('option', { name: 'U5ZQWPJQ UJ4JQ 45S5PY5 9WCU5XUW', exact: true }).click(); }
    });
    const recordingPage_10 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 10,
      target: 'css:[aria-label="Depurar"]',
      actionIntent: 'click',
      expectedEffect: 'navigation',
      technicalTargetRefs: ['css:[aria-label="Depurar"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Depurar\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Depurar"},"stableDescendants":[],"semanticShape":["span"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"__nuxt"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",2]],\\\"descendantEntries\\\":[[\\\"span\\\",2]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:button|Depurar"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); }
    });
    const recordingPage_11 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 11,
      target: 'label:¿No posee correo electrónico?',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['label:¿No posee correo electrónico?'],
      associatedField: '¿No posee correo electrónico?',
      checkableCaptionOwner: true,
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Depurar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_11, parseSerializedTechnicalTargetString('label:¿No posee correo electrónico?')!)!.click(); }
    });
    const recordingPage_12 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 12,
      target: 'css:[aria-label="Añadir contacto"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Añadir contacto"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Añadir contacto\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Añadir contacto"},"stableDescendants":[],"semanticShape":["span"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"pv_id_35_content"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",2]],\\\"descendantEntries\\\":[[\\\"span\\\",2]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:button|Añadir contacto"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Depurar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'label:¿No posee correo electrónico?', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_11, parseSerializedTechnicalTargetString('label:¿No posee correo electrónico?')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_12, parseSerializedTechnicalTargetString('css:[aria-label="Añadir contacto"]')!)!.click(); }
    });
    const recordingPage_13 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 13,
      target: 'css:[aria-label="Celular"][id="pv_id_54_0"][role="option"]',
      selectionValue: 'Celular',
      selectionField: 'Tipo',
      associatedField: 'Tipo',
      technicalTargetRefs: ['css:[aria-label="Celular"][id="pv_id_54_0"][role="option"]'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_13.getByRole('option', { name: 'Celular', exact: true }).click(); }
    });
    const recordingPage_14 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 14,
      target: 'Contacto',
      value: String(process.env['PROMOTED_CONTACTO'] ?? ''),
      valueKey: 'contacto',
      fill: async () => { await recordingPage_14.getByLabel('Contacto').fill(String(process.env['PROMOTED_CONTACTO'] ?? '')); }
    });
    const recordingPage_15 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 15,
      target: 'css:[aria-label="Casa"][id="pv_id_53_0"][role="option"]',
      selectionValue: 'Casa',
      selectionField: 'Ubicación',
      associatedField: 'Ubicación',
      technicalTargetRefs: ['css:[aria-label="Casa"][id="pv_id_53_0"][role="option"]'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_15.getByRole('option', { name: 'Casa', exact: true }).click(); }
    });
    const recordingPage_16 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 16,
      target: 'css:[aria-label="Aceptar"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Aceptar"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Aceptar\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Aceptar"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:button|Aceptar"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Depurar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'label:¿No posee correo electrónico?', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_11, parseSerializedTechnicalTargetString('label:¿No posee correo electrónico?')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir contacto"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_12, parseSerializedTechnicalTargetString('css:[aria-label="Añadir contacto"]')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'Contacto', sensitive: false, replay: async () => { await recordingPage_14.getByLabel('Contacto').fill(String(process.env['PROMOTED_CONTACTO'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_16, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); }
    });
    const recordingPage_17 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 17,
      target: 'css:[aria-label="CULTIVO DE PIMIENTA"][id="pv_id_49_0"][role="option"]',
      selectionValue: 'CULTIVO DE PIMIENTA',
      selectionField: 'Actividad económica',
      associatedField: 'Actividad económica',
      technicalTargetRefs: ['css:[aria-label="CULTIVO DE PIMIENTA"][id="pv_id_49_0"][role="option"]'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_17.getByRole('option', { name: 'CULTIVO DE PIMIENTA', exact: true }).click(); }
    });
    const recordingPage_18 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 18,
      target: 'css:[aria-label="Mediana Empresa Zona Francas"][id="pv_id_59_0"][role="option"]',
      selectionValue: 'Mediana Empresa Zona Francas',
      selectionField: 'Tipo de cliente',
      associatedField: 'Tipo de cliente',
      technicalTargetRefs: ['css:[aria-label="Mediana Empresa Zona Francas"][id="pv_id_59_0"][role="option"]'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_18.getByRole('option', { name: 'Mediana Empresa Zona Francas', exact: true }).click(); }
    });
    const recordingPage_19 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 19,
      target: 'css:[aria-label="Miembros del poder legislativo"][id="pv_id_50_3"][role="option"]',
      selectionValue: 'Miembros del poder legislativo',
      selectionField: 'Ocupación',
      associatedField: 'Ocupación',
      technicalTargetRefs: ['css:[aria-label="Miembros del poder legislativo"][id="pv_id_50_3"][role="option"]'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_19.getByRole('option', { name: 'Miembros del poder legislativo', exact: true }).click(); }
    });
    const recordingPage_20 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 20,
      target: 'css:[aria-label="Añadir datos laborales"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Añadir datos laborales"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Añadir datos laborales\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Añadir datos laborales"},"stableDescendants":[],"semanticShape":["span"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"pv_id_41_content"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",2]],\\\"descendantEntries\\\":[[\\\"span\\\",2]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:button|Añadir datos laborales"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Depurar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'label:¿No posee correo electrónico?', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_11, parseSerializedTechnicalTargetString('label:¿No posee correo electrónico?')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir contacto"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_12, parseSerializedTechnicalTargetString('css:[aria-label="Añadir contacto"]')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'Contacto', sensitive: false, replay: async () => { await recordingPage_14.getByLabel('Contacto').fill(String(process.env['PROMOTED_CONTACTO'] ?? '')); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Aceptar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_16, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_20, parseSerializedTechnicalTargetString('css:[aria-label="Añadir datos laborales"]')!)!.click(); }
    });
    const recordingPage_21 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 21,
      target: 'Nombre de la empresa / Actividad independiente',
      value: String(process.env['PROMOTED_NOMBRE_DE_LA_EMPRESA_ACTIVIDAD_INDEPENDI'] ?? ''),
      valueKey: 'nombre_de_la_empresa_actividad_independi',
      fill: async () => { await recordingPage_21.getByLabel('Nombre de la empresa / Actividad independiente').fill(String(process.env['PROMOTED_NOMBRE_DE_LA_EMPRESA_ACTIVIDAD_INDEPENDI'] ?? '')); }
    });
    const recordingPage_22 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 22,
      target: 'Departamento / Área',
      value: String(process.env['PROMOTED_DEPARTAMENTO_AREA'] ?? ''),
      valueKey: 'departamento_area',
      fill: async () => { await recordingPage_22.getByLabel('Departamento / Área').fill(String(process.env['PROMOTED_DEPARTAMENTO_AREA'] ?? '')); }
    });
    const recordingPage_23 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 23,
      target: 'Puesto que ocupa',
      value: String(process.env['PROMOTED_PUESTO_QUE_OCUPA'] ?? ''),
      valueKey: 'puesto_que_ocupa',
      fill: async () => { await recordingPage_23.getByLabel('Puesto que ocupa').fill(String(process.env['PROMOTED_PUESTO_QUE_OCUPA'] ?? '')); }
    });
    const recordingPage_24 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 24,
      target: 'Ingeniero',
      selectionValue: 'Ingeniero',
      selectionField: 'Cargo',
      associatedField: 'Cargo',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_24.getByRole('option', { name: 'Ingeniero', exact: true }).click(); }
    });
    const recordingPage_25 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 25,
      target: 'css:[aria-label="Salario"][id="pv_id_74_0"][role="option"]',
      selectionValue: 'Salario',
      selectionField: 'Tipo de ingreso',
      associatedField: 'Tipo de ingreso',
      technicalTargetRefs: ['css:[aria-label="Salario"][id="pv_id_74_0"][role="option"]'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_25.getByRole('option', { name: 'Salario', exact: true }).click(); }
    });
    const recordingPage_26 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 26,
      target: 'css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]',
      value: String(process.env['PROMOTED_SALARIO'] ?? ''),
      valueKey: 'salario',
      technicalTargetRefs: ['css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]'],
      fill: async () => { await recordedLocatorFactory(recordingPage_26, parseSerializedTechnicalTargetString('css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_SALARIO'] ?? '')); }
    });
    const recordingPage_27 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 27,
      target: 'role:radio|Sí',
      actionIntent: 'click',
      expectedEffect: 'selection_state_change',
      technicalTargetRefs: ['role:radio|Sí'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Sí\"][role=\"radio\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"div","role":"radio"},"stableDirectAttributes":{"aria-label":"Sí","role":"radio"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"pv_id_63_content"},"targetFingerprint":"{\"owner\":{\"tag\":\"div\",\"role\":\"radio\"},\"stableDirectAttributes\":{\"role\":\"radio\"},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",1]],\\\"descendantEntries\\\":[[\\\"span\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:radio|Sí"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Depurar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'label:¿No posee correo electrónico?', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_11, parseSerializedTechnicalTargetString('label:¿No posee correo electrónico?')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir contacto"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_12, parseSerializedTechnicalTargetString('css:[aria-label="Añadir contacto"]')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'Contacto', sensitive: false, replay: async () => { await recordingPage_14.getByLabel('Contacto').fill(String(process.env['PROMOTED_CONTACTO'] ?? '')); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Aceptar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_16, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); } }, { stepIndex: 20, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir datos laborales"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_20, parseSerializedTechnicalTargetString('css:[aria-label="Añadir datos laborales"]')!)!.click(); } }, { stepIndex: 21, actionIntent: 'restore_recorded_context', target: 'Nombre de la empresa / Actividad independiente', sensitive: false, replay: async () => { await recordingPage_21.getByLabel('Nombre de la empresa / Actividad independiente').fill(String(process.env['PROMOTED_NOMBRE_DE_LA_EMPRESA_ACTIVIDAD_INDEPENDI'] ?? '')); } }, { stepIndex: 22, actionIntent: 'restore_recorded_context', target: 'Departamento / Área', sensitive: false, replay: async () => { await recordingPage_22.getByLabel('Departamento / Área').fill(String(process.env['PROMOTED_DEPARTAMENTO_AREA'] ?? '')); } }, { stepIndex: 23, actionIntent: 'restore_recorded_context', target: 'Puesto que ocupa', sensitive: false, replay: async () => { await recordingPage_23.getByLabel('Puesto que ocupa').fill(String(process.env['PROMOTED_PUESTO_QUE_OCUPA'] ?? '')); } }, { stepIndex: 26, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_26, parseSerializedTechnicalTargetString('css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_SALARIO'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_27, parseSerializedTechnicalTargetString('role:radio|Sí')!)!.click(); }
    });
    const recordingPage_28 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 28,
      target: 'Fecha de ingreso',
      value: String(process.env['PROMOTED_FECHA_DE_INGRESO'] ?? ''),
      valueKey: 'fecha_de_ingreso',
      fill: async () => { await recordingPage_28.getByLabel('Fecha de ingreso').fill(String(process.env['PROMOTED_FECHA_DE_INGRESO'] ?? '')); }
    });
    const recordingPage_29 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 29,
      target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]',
      value: String(process.env['PROMOTED_TELEFONO'] ?? ''),
      valueKey: 'telefono',
      technicalTargetRefs: ['css:[data-pc-name="inputmask"][data-pc-section="root"]'],
      fill: async () => { await recordedLocatorFactory(recordingPage_29, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_TELEFONO'] ?? '')); }
    });
    const recordingPage_30 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 30,
      target: 'Extensión',
      value: String(process.env['PROMOTED_EXTENSION'] ?? ''),
      valueKey: 'extension',
      fill: async () => { await recordingPage_30.getByLabel('Extensión').fill(String(process.env['PROMOTED_EXTENSION'] ?? '')); }
    });
    const recordingPage_31 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 31,
      target: 'Calle / Avenida / Autopista',
      value: String(process.env['PROMOTED_CALLE_AVENIDA_AUTOPISTA'] ?? ''),
      valueKey: 'calle_avenida_autopista',
      fill: async () => { await recordingPage_31.getByLabel('Calle / Avenida / Autopista').fill(String(process.env['PROMOTED_CALLE_AVENIDA_AUTOPISTA'] ?? '')); }
    });
    const recordingPage_32 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 32,
      target: 'Nombre edificio',
      value: String(process.env['PROMOTED_NOMBRE_EDIFICIO'] ?? ''),
      valueKey: 'nombre_edificio',
      fill: async () => { await recordingPage_32.getByLabel('Nombre edificio').fill(String(process.env['PROMOTED_NOMBRE_EDIFICIO'] ?? '')); }
    });
    const recordingPage_33 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 33,
      target: 'Número casa / edificio',
      value: String(process.env['PROMOTED_NUMERO_CASA_EDIFICIO'] ?? ''),
      valueKey: 'numero_casa_edificio',
      fill: async () => { await recordingPage_33.getByLabel('Número casa / edificio').fill(String(process.env['PROMOTED_NUMERO_CASA_EDIFICIO'] ?? '')); }
    });
    const recordingPage_34 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 34,
      target: 'Número apartamento',
      value: String(process.env['PROMOTED_NUMERO_APARTAMENTO'] ?? ''),
      valueKey: 'numero_apartamento',
      fill: async () => { await recordingPage_34.getByLabel('Número apartamento').fill(String(process.env['PROMOTED_NUMERO_APARTAMENTO'] ?? '')); }
    });
    await pageObject.select({
      stepIndex: 35,
      target: 'css:[aria-label="Distrito Nacional"][id="pv_id_72_0"][role="option"]',
      selectionValue: 'Distrito Nacional',
      selectionField: 'Región',
      associatedField: 'Distrito Nacional',
      technicalTargetRefs: ['css:[aria-label="Distrito Nacional"][id="pv_id_72_0"][role="option"]'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await page.getByRole('option', { name: 'Distrito Nacional', exact: true }).click(); }
    });
    await pageObject.select({
      stepIndex: 36,
      target: 'Distrito Nacional',
      selectionValue: 'Distrito Nacional',
      selectionField: 'Provincia',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await page.getByRole('option', { name: 'Distrito Nacional', exact: true }).click(); }
    });
    const recordingPage_37 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 37,
      target: 'Santo Domingo',
      selectionValue: 'Santo Domingo',
      selectionField: 'Municipio',
      associatedField: 'Municipio',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_37.getByRole('option', { name: 'Santo Domingo', exact: true }).click(); }
    });
    const recordingPage_38 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 38,
      target: 'Santo Domingo De Guzmán',
      selectionValue: 'Santo Domingo De Guzmán',
      selectionField: 'Localidad',
      associatedField: 'Localidad',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_38.getByRole('option', { name: 'Santo Domingo De Guzmán', exact: true }).click(); }
    });
    const recordingPage_39 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 39,
      target: 'Agua Dulce',
      selectionValue: 'Agua Dulce',
      selectionField: 'Sector',
      associatedField: 'Sector',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_39.getByRole('option', { name: 'Agua Dulce', exact: true }).click(); }
    });
    const recordingPage_40 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 40,
      target: 'Referencia',
      value: String(process.env['PROMOTED_REFERENCIA'] ?? ''),
      valueKey: 'referencia',
      fill: async () => { await recordingPage_40.getByLabel('Referencia').fill(String(process.env['PROMOTED_REFERENCIA'] ?? '')); }
    });
    const recordingPage_41 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 41,
      target: 'css:[aria-label="Aceptar"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Aceptar"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Aceptar\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Aceptar"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:button|Aceptar"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Depurar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'label:¿No posee correo electrónico?', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_11, parseSerializedTechnicalTargetString('label:¿No posee correo electrónico?')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir contacto"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_12, parseSerializedTechnicalTargetString('css:[aria-label="Añadir contacto"]')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'Contacto', sensitive: false, replay: async () => { await recordingPage_14.getByLabel('Contacto').fill(String(process.env['PROMOTED_CONTACTO'] ?? '')); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Aceptar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_16, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); } }, { stepIndex: 20, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir datos laborales"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_20, parseSerializedTechnicalTargetString('css:[aria-label="Añadir datos laborales"]')!)!.click(); } }, { stepIndex: 21, actionIntent: 'restore_recorded_context', target: 'Nombre de la empresa / Actividad independiente', sensitive: false, replay: async () => { await recordingPage_21.getByLabel('Nombre de la empresa / Actividad independiente').fill(String(process.env['PROMOTED_NOMBRE_DE_LA_EMPRESA_ACTIVIDAD_INDEPENDI'] ?? '')); } }, { stepIndex: 22, actionIntent: 'restore_recorded_context', target: 'Departamento / Área', sensitive: false, replay: async () => { await recordingPage_22.getByLabel('Departamento / Área').fill(String(process.env['PROMOTED_DEPARTAMENTO_AREA'] ?? '')); } }, { stepIndex: 23, actionIntent: 'restore_recorded_context', target: 'Puesto que ocupa', sensitive: false, replay: async () => { await recordingPage_23.getByLabel('Puesto que ocupa').fill(String(process.env['PROMOTED_PUESTO_QUE_OCUPA'] ?? '')); } }, { stepIndex: 26, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_26, parseSerializedTechnicalTargetString('css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_SALARIO'] ?? '')); } }, { stepIndex: 27, actionIntent: 'restore_recorded_context', target: 'role:radio|Sí', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_27, parseSerializedTechnicalTargetString('role:radio|Sí')!)!.click(); } }, { stepIndex: 28, actionIntent: 'restore_recorded_context', target: 'Fecha de ingreso', sensitive: false, replay: async () => { await recordingPage_28.getByLabel('Fecha de ingreso').fill(String(process.env['PROMOTED_FECHA_DE_INGRESO'] ?? '')); } }, { stepIndex: 29, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_29, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_TELEFONO'] ?? '')); } }, { stepIndex: 30, actionIntent: 'restore_recorded_context', target: 'Extensión', sensitive: false, replay: async () => { await recordingPage_30.getByLabel('Extensión').fill(String(process.env['PROMOTED_EXTENSION'] ?? '')); } }, { stepIndex: 31, actionIntent: 'restore_recorded_context', target: 'Calle / Avenida / Autopista', sensitive: false, replay: async () => { await recordingPage_31.getByLabel('Calle / Avenida / Autopista').fill(String(process.env['PROMOTED_CALLE_AVENIDA_AUTOPISTA'] ?? '')); } }, { stepIndex: 32, actionIntent: 'restore_recorded_context', target: 'Nombre edificio', sensitive: false, replay: async () => { await recordingPage_32.getByLabel('Nombre edificio').fill(String(process.env['PROMOTED_NOMBRE_EDIFICIO'] ?? '')); } }, { stepIndex: 33, actionIntent: 'restore_recorded_context', target: 'Número casa / edificio', sensitive: false, replay: async () => { await recordingPage_33.getByLabel('Número casa / edificio').fill(String(process.env['PROMOTED_NUMERO_CASA_EDIFICIO'] ?? '')); } }, { stepIndex: 34, actionIntent: 'restore_recorded_context', target: 'Número apartamento', sensitive: false, replay: async () => { await recordingPage_34.getByLabel('Número apartamento').fill(String(process.env['PROMOTED_NUMERO_APARTAMENTO'] ?? '')); } }, { stepIndex: 40, actionIntent: 'restore_recorded_context', target: 'Referencia', sensitive: false, replay: async () => { await recordingPage_40.getByLabel('Referencia').fill(String(process.env['PROMOTED_REFERENCIA'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_41, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); }
    });
    const recordingPage_42 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 42,
      target: 'css:[aria-label="Continuar"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Continuar"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Continuar\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Continuar"},"stableDescendants":[],"semanticShape":["span"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"__nuxt"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",2]],\\\"descendantEntries\\\":[[\\\"span\\\",2]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:button|Continuar"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Depurar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'label:¿No posee correo electrónico?', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_11, parseSerializedTechnicalTargetString('label:¿No posee correo electrónico?')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir contacto"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_12, parseSerializedTechnicalTargetString('css:[aria-label="Añadir contacto"]')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'Contacto', sensitive: false, replay: async () => { await recordingPage_14.getByLabel('Contacto').fill(String(process.env['PROMOTED_CONTACTO'] ?? '')); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Aceptar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_16, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); } }, { stepIndex: 20, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir datos laborales"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_20, parseSerializedTechnicalTargetString('css:[aria-label="Añadir datos laborales"]')!)!.click(); } }, { stepIndex: 21, actionIntent: 'restore_recorded_context', target: 'Nombre de la empresa / Actividad independiente', sensitive: false, replay: async () => { await recordingPage_21.getByLabel('Nombre de la empresa / Actividad independiente').fill(String(process.env['PROMOTED_NOMBRE_DE_LA_EMPRESA_ACTIVIDAD_INDEPENDI'] ?? '')); } }, { stepIndex: 22, actionIntent: 'restore_recorded_context', target: 'Departamento / Área', sensitive: false, replay: async () => { await recordingPage_22.getByLabel('Departamento / Área').fill(String(process.env['PROMOTED_DEPARTAMENTO_AREA'] ?? '')); } }, { stepIndex: 23, actionIntent: 'restore_recorded_context', target: 'Puesto que ocupa', sensitive: false, replay: async () => { await recordingPage_23.getByLabel('Puesto que ocupa').fill(String(process.env['PROMOTED_PUESTO_QUE_OCUPA'] ?? '')); } }, { stepIndex: 26, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_26, parseSerializedTechnicalTargetString('css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_SALARIO'] ?? '')); } }, { stepIndex: 27, actionIntent: 'restore_recorded_context', target: 'role:radio|Sí', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_27, parseSerializedTechnicalTargetString('role:radio|Sí')!)!.click(); } }, { stepIndex: 28, actionIntent: 'restore_recorded_context', target: 'Fecha de ingreso', sensitive: false, replay: async () => { await recordingPage_28.getByLabel('Fecha de ingreso').fill(String(process.env['PROMOTED_FECHA_DE_INGRESO'] ?? '')); } }, { stepIndex: 29, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_29, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_TELEFONO'] ?? '')); } }, { stepIndex: 30, actionIntent: 'restore_recorded_context', target: 'Extensión', sensitive: false, replay: async () => { await recordingPage_30.getByLabel('Extensión').fill(String(process.env['PROMOTED_EXTENSION'] ?? '')); } }, { stepIndex: 31, actionIntent: 'restore_recorded_context', target: 'Calle / Avenida / Autopista', sensitive: false, replay: async () => { await recordingPage_31.getByLabel('Calle / Avenida / Autopista').fill(String(process.env['PROMOTED_CALLE_AVENIDA_AUTOPISTA'] ?? '')); } }, { stepIndex: 32, actionIntent: 'restore_recorded_context', target: 'Nombre edificio', sensitive: false, replay: async () => { await recordingPage_32.getByLabel('Nombre edificio').fill(String(process.env['PROMOTED_NOMBRE_EDIFICIO'] ?? '')); } }, { stepIndex: 33, actionIntent: 'restore_recorded_context', target: 'Número casa / edificio', sensitive: false, replay: async () => { await recordingPage_33.getByLabel('Número casa / edificio').fill(String(process.env['PROMOTED_NUMERO_CASA_EDIFICIO'] ?? '')); } }, { stepIndex: 34, actionIntent: 'restore_recorded_context', target: 'Número apartamento', sensitive: false, replay: async () => { await recordingPage_34.getByLabel('Número apartamento').fill(String(process.env['PROMOTED_NUMERO_APARTAMENTO'] ?? '')); } }, { stepIndex: 40, actionIntent: 'restore_recorded_context', target: 'Referencia', sensitive: false, replay: async () => { await recordingPage_40.getByLabel('Referencia').fill(String(process.env['PROMOTED_REFERENCIA'] ?? '')); } }, { stepIndex: 41, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Aceptar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_41, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_42, parseSerializedTechnicalTargetString('css:[aria-label="Continuar"]')!)!.click(); }
    });
    const recordingPage_43 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 43,
      target: 'Sistema de Prestamos',
      selectionValue: 'Sistema de Prestamos',
      selectionField: 'Categoría de producto',
      associatedField: 'Categoría de producto',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_43.getByRole('option', { name: 'Sistema de Prestamos', exact: true }).click(); }
    });
    const recordingPage_44 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 44,
      target: '24 - PRESTAMOS PERSONALES FACILES',
      selectionValue: '24 - PRESTAMOS PERSONALES FACILES',
      selectionField: 'Producto',
      associatedField: 'Producto',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_44.getByRole('option', { name: '24 - PRESTAMOS PERSONALES FACILES', exact: true }).click(); }
    });
    await pageObject.click({
      stepIndex: 45,
      target: 'css:[aria-label="Seleccione una opción"][role="combobox"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Seleccione una opción"][role="combobox"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Seleccione una opción\"][role=\"combobox\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"span","role":"combobox"},"stableDirectAttributes":{"aria-label":"Seleccione una opción","role":"combobox"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"pv_id_94"},"targetFingerprint":"{\"owner\":{\"tag\":\"span\",\"role\":\"combobox\"},\"stableDirectAttributes\":{\"role\":\"combobox\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:combobox|Seleccione una opción"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_6, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }, { stepIndex: 7, actionIntent: 'restore_recorded_context', target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); } }, { stepIndex: 10, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Depurar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_10, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); } }, { stepIndex: 11, actionIntent: 'restore_recorded_context', target: 'label:¿No posee correo electrónico?', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_11, parseSerializedTechnicalTargetString('label:¿No posee correo electrónico?')!)!.click(); } }, { stepIndex: 12, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir contacto"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_12, parseSerializedTechnicalTargetString('css:[aria-label="Añadir contacto"]')!)!.click(); } }, { stepIndex: 14, actionIntent: 'restore_recorded_context', target: 'Contacto', sensitive: false, replay: async () => { await recordingPage_14.getByLabel('Contacto').fill(String(process.env['PROMOTED_CONTACTO'] ?? '')); } }, { stepIndex: 16, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Aceptar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_16, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); } }, { stepIndex: 20, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Añadir datos laborales"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_20, parseSerializedTechnicalTargetString('css:[aria-label="Añadir datos laborales"]')!)!.click(); } }, { stepIndex: 21, actionIntent: 'restore_recorded_context', target: 'Nombre de la empresa / Actividad independiente', sensitive: false, replay: async () => { await recordingPage_21.getByLabel('Nombre de la empresa / Actividad independiente').fill(String(process.env['PROMOTED_NOMBRE_DE_LA_EMPRESA_ACTIVIDAD_INDEPENDI'] ?? '')); } }, { stepIndex: 22, actionIntent: 'restore_recorded_context', target: 'Departamento / Área', sensitive: false, replay: async () => { await recordingPage_22.getByLabel('Departamento / Área').fill(String(process.env['PROMOTED_DEPARTAMENTO_AREA'] ?? '')); } }, { stepIndex: 23, actionIntent: 'restore_recorded_context', target: 'Puesto que ocupa', sensitive: false, replay: async () => { await recordingPage_23.getByLabel('Puesto que ocupa').fill(String(process.env['PROMOTED_PUESTO_QUE_OCUPA'] ?? '')); } }, { stepIndex: 26, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_26, parseSerializedTechnicalTargetString('css:[data-pc-extend="inputtext"][data-pc-name="input"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_SALARIO'] ?? '')); } }, { stepIndex: 27, actionIntent: 'restore_recorded_context', target: 'role:radio|Sí', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_27, parseSerializedTechnicalTargetString('role:radio|Sí')!)!.click(); } }, { stepIndex: 28, actionIntent: 'restore_recorded_context', target: 'Fecha de ingreso', sensitive: false, replay: async () => { await recordingPage_28.getByLabel('Fecha de ingreso').fill(String(process.env['PROMOTED_FECHA_DE_INGRESO'] ?? '')); } }, { stepIndex: 29, actionIntent: 'restore_recorded_context', target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_29, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_TELEFONO'] ?? '')); } }, { stepIndex: 30, actionIntent: 'restore_recorded_context', target: 'Extensión', sensitive: false, replay: async () => { await recordingPage_30.getByLabel('Extensión').fill(String(process.env['PROMOTED_EXTENSION'] ?? '')); } }, { stepIndex: 31, actionIntent: 'restore_recorded_context', target: 'Calle / Avenida / Autopista', sensitive: false, replay: async () => { await recordingPage_31.getByLabel('Calle / Avenida / Autopista').fill(String(process.env['PROMOTED_CALLE_AVENIDA_AUTOPISTA'] ?? '')); } }, { stepIndex: 32, actionIntent: 'restore_recorded_context', target: 'Nombre edificio', sensitive: false, replay: async () => { await recordingPage_32.getByLabel('Nombre edificio').fill(String(process.env['PROMOTED_NOMBRE_EDIFICIO'] ?? '')); } }, { stepIndex: 33, actionIntent: 'restore_recorded_context', target: 'Número casa / edificio', sensitive: false, replay: async () => { await recordingPage_33.getByLabel('Número casa / edificio').fill(String(process.env['PROMOTED_NUMERO_CASA_EDIFICIO'] ?? '')); } }, { stepIndex: 34, actionIntent: 'restore_recorded_context', target: 'Número apartamento', sensitive: false, replay: async () => { await recordingPage_34.getByLabel('Número apartamento').fill(String(process.env['PROMOTED_NUMERO_APARTAMENTO'] ?? '')); } }, { stepIndex: 40, actionIntent: 'restore_recorded_context', target: 'Referencia', sensitive: false, replay: async () => { await recordingPage_40.getByLabel('Referencia').fill(String(process.env['PROMOTED_REFERENCIA'] ?? '')); } }, { stepIndex: 41, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Aceptar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_41, parseSerializedTechnicalTargetString('css:[aria-label="Aceptar"]')!)!.click(); } }, { stepIndex: 42, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Continuar"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_42, parseSerializedTechnicalTargetString('css:[aria-label="Continuar"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Seleccione una opción"][role="combobox"]')!)!.click(); }
    });
    const recordingPage_46 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 46,
      target: 'PRÉSTAMOS PERSONALES NUEVOS',
      selectionValue: 'PRÉSTAMOS PERSONALES NUEVOS',
      selectionField: 'Seleccione una opción',
      associatedField: 'Seleccione una opción',
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_46.getByRole('option', { name: 'PRÉSTAMOS PERSONALES NUEVOS', exact: true }).click(); }
    });
    const recordingPage_47 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 47,
      target: 'Monto solicitado',
      value: String(process.env['PROMOTED_MONTO_SOLICITADO'] ?? ''),
      valueKey: 'monto_solicitado',
      fill: async () => { await recordingPage_47.getByLabel('Monto solicitado').fill(String(process.env['PROMOTED_MONTO_SOLICITADO'] ?? '')); }
    });
    const recordingPage_48 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.select({
      stepIndex: 48,
      target: 'css:[aria-label="6 meses"][id="pv_id_93_0"][role="option"]',
      selectionValue: '6 meses',
      selectionField: 'Plazo',
      associatedField: 'Plazo',
      technicalTargetRefs: ['css:[aria-label="6 meses"][id="pv_id_93_0"][role="option"]'],
      actionIntent: 'select',
      expectedEffect: 'selection_state_change',
      action: async () => { await recordingPage_48.getByRole('option', { name: '6 meses', exact: true }).click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
