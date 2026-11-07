export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  upload(options: Parameters<typeof this.runtime.uploadRecordedFiles>[0]) { return this.runtime.uploadRecordedFiles(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Login V2', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 270000));
  process.env.APP_SLUG = 'portal-comercial';
  process.env.SECTION_SLUG = 'api-tests';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Login V2';
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
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"/requests/create/multiproduct\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"/requests/create/multiproduct"},"stableDescendants":[],"semanticShape":["span"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"pv_id_5_2_1"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"/requests/create/multiproduct\"},\"stableDescendants\":[],\"semanticShape\":[\"span\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"span\\\",2]],\\\"descendantEntries\\\":[[\\\"span\\\",2]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      structuralSemanticFallbackRefs: ["role:link|Solicitud multiproducto"],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); }
    });
    const recordingPage_6 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 6,
      target: 'Número de identificación',
      value: String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? ''),
      valueKey: 'numero_de_identificacion',
      fill: async () => { await recordingPage_6.getByLabel('Número de identificación').fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); }
    });
    const recordingPage_7 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 7,
      target: 'css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: false, replay: async () => { await pageObject.press({ stepIndex: 4, target: 'role:textbox|Contraseña', technicalTargetRefs: ['css:#password', 'id:password'], key: 'Enter' }); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="/requests/create/multiproduct"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); } }, { stepIndex: 6, actionIntent: 'restore_recorded_context', target: 'Número de identificación', sensitive: false, replay: async () => { await recordingPage_6.getByLabel('Número de identificación').fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_7, parseSerializedTechnicalTargetString('css:div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]):not(:has(div:has-text("Número de identificación"):has(button[data-pc-name="button"][data-pc-section="root"]))) button[data-pc-name="button"][data-pc-section="root"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 7,
      target: 'Número de identificación',
      polarity: "positive",
      expectedUrl: 'https://srvqacgowb01.local.bsc.com:5000/requests/create/multiproduct',
      assertion: async () => { await expect(recordingPage_7).toHaveURL("https://srvqacgowb01.local.bsc.com:5000/requests/create/multiproduct"); },
      requireCompletionSignal: true,
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
