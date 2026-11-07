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

test('Adjuntar Documentos', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 124000));
  process.env.APP_SLUG = 'web-test';
  process.env.SECTION_SLUG = 'api-tests';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Adjuntar Documentos';
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
      technicalTargetRefs: ['role:textbox|Usuario', 'css:#usuario', 'id:usuario'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); }
    });
    const recordingPage_3 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.fill({
      stepIndex: 3,
      target: 'role:textbox|Contraseña',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña', 'css:#clave', 'id:clave'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    const recordingPage_4 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 4,
      target: 'css:[id="btn-login"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[id="btn-login"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[id=\"btn-login\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"id":"btn-login"},"stableDescendants":[],"semanticShape":[],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"login-form"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{\"id\":\"btn-login\"},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_4, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); }
    });
    const recordingPage_5 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 5,
      target: 'css:[href="#/solicitud/nueva"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#/solicitud/nueva"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#/solicitud/nueva\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#/solicitud/nueva"},"stableDescendants":[],"semanticShape":["svg"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"app"},"targetFingerprint":"{\"owner\":{\"tag\":\"a\"},\"stableDirectAttributes\":{\"href\":\"#/solicitud/nueva\"},\"stableDescendants\":[],\"semanticShape\":[\"svg\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"svg\\\",1]],\\\"descendantEntries\\\":[[\\\"path\\\",2],[\\\"svg\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_4, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); }
    });
    const recordingPage_6 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await promotedRuntime.completeRecordedFilePickerClick({
      stepIndex: 6,
      target: "Seleccionar documento",
      uploadStepIndex: 7,
    });
    const recordingPage_7 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await promotedRuntime.uploadRecordedFiles({
      stepIndex: 7,
      projectSlug: 'web-test',
      technicalTargetRefs: ["aria-label:Seleccionar documento","css:#doc-file","id:doc-file"],
      fileAssets: [{"fileRef":"653366c8-45ff-4f75-adb1-111b6525e8b6","filename":"evidencia-9ba20fa6-ad5a-47b7-893c-bbca38f5cdb0.pdf","contentType":"application/pdf","size":2110686,"sha256":"1f364f4fe18b82dc8873f6f364ca03e4e1a6630624373f5e33312d1333153d27"}],
      fileSetValueKey: 'recorded_upload_13',
    });
    const recordingPage_8 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 8,
      target: 'role:button|Cargar documento',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Cargar documento'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:textbox|Contraseña', sensitive: true, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'css:[id="btn-login"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_4, parseSerializedTechnicalTargetString('css:[id="btn-login"]')!)!.click(); } }, { stepIndex: 5, actionIntent: 'restore_recorded_context', target: 'css:[href="#/solicitud/nueva"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[href="#/solicitud/nueva"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_8, parseSerializedTechnicalTargetString('role:button|Cargar documento')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 8,
      target: 'Cargar documento',
      polarity: "positive",
      expectedUrl: 'http://localhost:4310/#/solicitud/nueva',
      assertion: async () => { await expect(recordingPage_8).toHaveURL("http://localhost:4310/#/solicitud/nueva"); },
      requireCompletionSignal: true,
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
