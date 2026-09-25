import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
}

test('Prueba', async ({ page }) => {
  process.env.APP_SLUG = 'prueba-kiosko';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Prueba';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    await pageObject.click({
      stepIndex: 1,
      target: 'css:[aria-label="Explora nuestros productos"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Explora nuestros productos"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Explora nuestros productos\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Explora nuestros productos"},"stableDescendants":[],"semanticShape":["div"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Explora nuestros productos"]')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 2,
      target: 'role:button|Tarjetas',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Tarjetas'],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Tarjetas')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 3,
      target: 'role:button|Tarjeta de\nCrédito',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Tarjeta de\nCrédito'],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Tarjeta de\nCrédito')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 4,
      target: 'role:div|[alt="Tarjeta de Crédito Visa Platinum"][src="/assets/images/tarjetas-de-credito-visa-platinum.png"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:div|[alt="Tarjeta de Crédito Visa Platinum"][src="/assets/images/tarjetas-de-credito-visa-platinum.png"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"role","value":"div|[alt=\"Tarjeta de Crédito Visa Platinum\"][src=\"/assets/images/tarjetas-de-credito-visa-platinum.png\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"div"},"stableDescendants":[{"relation":"descendant","tag":"img","stableAttributes":{"alt":"Tarjeta de Crédito Visa Platinum","src":"/assets/images/tarjetas-de-credito-visa-platinum.png"}}],"semanticShape":["div","h3"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":3},
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:div|[alt="Tarjeta de Crédito Visa Platinum"][src="/assets/images/tarjetas-de-credito-visa-platinum.png"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 4,
      target: 'Tarjeta de Crédito Visa Platinum',
      polarity: "positive",
      expectedUrl: 'https://172.27.4.50/product-extended?product=tarjeta-de-credito-visa-platinum',
      assertion: async () => { await expect(page).toHaveURL("https://172.27.4.50/product-extended?product=tarjeta-de-credito-visa-platinum"); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
