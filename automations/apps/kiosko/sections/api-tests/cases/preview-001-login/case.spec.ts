export const PROMOTED_SPEC_STRATEGY = "pom_runtime";
import { test } from '@playwright/test';
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

test('Login', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 100000));
  process.env.APP_SLUG = 'kiosko';
  process.env.SECTION_SLUG = 'api-tests';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Login';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    const recordingPage_2 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 2,
      target: 'css:[aria-label="Explora nuestros productos"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Explora nuestros productos"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Explora nuestros productos\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Explora nuestros productos"},"stableDescendants":[],"semanticShape":["div"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"root"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{},\"stableDescendants\":[],\"semanticShape\":[\"div\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"div\\\",1]],\\\"descendantEntries\\\":[[\\\"circle\\\",1],[\\\"div\\\",3],[\\\"h3\\\",1],[\\\"p\\\",1],[\\\"path\\\",1],[\\\"svg\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [],
      action: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); }
    });
    const recordingPage_3 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 3,
      target: 'role:button|Tarjetas',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Tarjetas'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Explora nuestros productos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:button|Tarjetas')!)!.click(); }
    });
    const recordingPage_4 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 4,
      target: 'role:button|Tarjeta de Crédito',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Tarjeta de Crédito'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Explora nuestros productos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:button|Tarjetas', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:button|Tarjetas')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_4, parseSerializedTechnicalTargetString('role:button|Tarjeta de Crédito')!)!.click(); }
    });
    const recordingPage_5 = await promotedRuntime.selectRecordedPage("tab-1", false);
    await pageObject.click({
      stepIndex: 5,
      target: 'css:[aria-label="Tarjeta Crédito Visa Clásica"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Tarjeta Crédito Visa Clásica"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Tarjeta Crédito Visa Clásica\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Tarjeta Crédito Visa Clásica"},"stableDescendants":[],"semanticShape":[],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"root"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{},\"stableDescendants\":[],\"semanticShape\":[],\"topologySignature\":\"\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Explora nuestros productos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_2, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:button|Tarjetas', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_3, parseSerializedTechnicalTargetString('role:button|Tarjetas')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:button|Tarjeta de Crédito', sensitive: false, replay: async () => { await recordedLocatorFactory(recordingPage_4, parseSerializedTechnicalTargetString('role:button|Tarjeta de Crédito')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(recordingPage_5, parseSerializedTechnicalTargetString('css:[aria-label="Tarjeta Crédito Visa Clásica"]')!)!.click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
