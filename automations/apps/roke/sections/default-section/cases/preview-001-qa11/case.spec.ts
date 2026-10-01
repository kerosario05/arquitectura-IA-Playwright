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

test('qa11', async ({ page }) => {
  process.env.APP_SLUG = 'roke';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'qa11';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await pageObject.click({
      stepIndex: 2,
      target: 'css:[aria-label="Explora nuestros productos"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Explora nuestros productos"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Explora nuestros productos\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Explora nuestros productos"},"stableDescendants":[],"semanticShape":["div"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"root"},"targetFingerprint":"{\"owner\":{\"tag\":\"button\"},\"stableDirectAttributes\":{},\"stableDescendants\":[],\"semanticShape\":[\"div\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"div\\\",1]],\\\"descendantEntries\\\":[[\\\"circle\\\",1],[\\\"div\\\",3],[\\\"h3\\\",1],[\\\"p\\\",1],[\\\"path\\\",1],[\\\"svg\\\",1]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 3,
      target: 'role:button|Tarjetas',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Tarjetas'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Explora nuestros productos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Tarjetas')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 4,
      target: 'role:button|Tarjeta de Crédito',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Tarjeta de Crédito'],
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Explora nuestros productos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:button|Tarjetas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Tarjetas')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Tarjeta de Crédito')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 5,
      target: 'role:div|[alt="Tarjeta Multicrédito"][src="/assets/images/tarjetas-de-credito-visa-multicredito.png"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:div|[alt="Tarjeta Multicrédito"][src="/assets/images/tarjetas-de-credito-visa-multicredito.png"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"role","value":"div|[alt=\"Tarjeta Multicrédito\"][src=\"/assets/images/tarjetas-de-credito-visa-multicredito.png\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"div"},"stableDescendants":[{"relation":"descendant","tag":"img","stableAttributes":{"alt":"Tarjeta Multicrédito","src":"/assets/images/tarjetas-de-credito-visa-multicredito.png"}}],"semanticShape":["div","h3"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1,"scopeIdentity":{"strategy":"id","value":"root"},"targetFingerprint":"{\"owner\":{\"tag\":\"div\"},\"stableDirectAttributes\":{},\"stableDescendants\":[{\"relation\":\"descendant\",\"tag\":\"img\",\"stableAttributes\":{\"src\":\"/assets/images/tarjetas-de-credito-visa-multicredito.png\"}}],\"semanticShape\":[\"div\",\"h3\"],\"topologySignature\":\"{\\\"childEntries\\\":[[\\\"div\\\",3],[\\\"h3\\\",1]],\\\"descendantEntries\\\":[[\\\"div\\\",11],[\\\"h3\\\",1],[\\\"img\\\",1],[\\\"path\\\",4],[\\\"span\\\",4],[\\\"svg\\\",4]]}\"}","captureScopeUnique":true,"captureTargetMatchCount":1},"confidence":0.85,"certificationTier":3},
      previousStepReplays: [{ stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Explora nuestros productos"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); } }, { stepIndex: 3, actionIntent: 'restore_recorded_context', target: 'role:button|Tarjetas', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Tarjetas')!)!.click(); } }, { stepIndex: 4, actionIntent: 'restore_recorded_context', target: 'role:button|Tarjeta de Crédito', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Tarjeta de Crédito')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:div|[alt="Tarjeta Multicrédito"][src="/assets/images/tarjetas-de-credito-visa-multicredito.png"]')!)!.click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
