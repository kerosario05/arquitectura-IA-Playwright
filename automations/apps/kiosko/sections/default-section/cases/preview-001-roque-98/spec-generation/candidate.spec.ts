import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
}

test('roque 98', async ({ page }) => {
  process.env.APP_SLUG = 'kiosko';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'roque 98';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    await pageObject.click({
      stepIndex: 1,
      target: 'css:[aria-label="Estados de cuenta"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Estados de cuenta"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Estados de cuenta\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Estados de cuenta"},"stableDescendants":[],"semanticShape":["div"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      previousStepReplays: [],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Estados de cuenta"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 2,
      target: 'role:button|T',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|T'],
      previousStepReplays: [{ stepIndex: 1, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Estados de cuenta"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Estados de cuenta"]')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|T')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 3,
      target: 'role:button|Cancelar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Cancelar'],
      previousStepReplays: [{ stepIndex: 1, actionIntent: 'restore_recorded_context', target: 'css:[aria-label="Estados de cuenta"]', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Estados de cuenta"]')!)!.click(); } }, { stepIndex: 2, actionIntent: 'restore_recorded_context', target: 'role:button|T', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|T')!)!.click(); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Cancelar')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 3,
      target: 'Cancelar',
      polarity: "positive",
      expectedUrl: 'https://172.27.4.50/',
      assertion: async () => { await expect(page).toHaveURL("https://172.27.4.50/"); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
