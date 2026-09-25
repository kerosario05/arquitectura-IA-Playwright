import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
}

test('Segunta Prueba', async ({ page }) => {
  process.env.APP_SLUG = 'portal-comercial';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Segunta Prueba';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    await pageObject.fill({
      stepIndex: 1,
      target: 'role:textbox|Usuario',
      value: String(process.env['PROMOTED_USUARIO'] ?? ''),
      valueKey: 'usuario',
      technicalTargetRefs: ['role:textbox|Usuario'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 2,
      target: 'role:textbox|Contraseña',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    await pageObject.press({
      stepIndex: 3,
      target: 'role:textbox|Contraseña',
      key: 'Enter'
    });
    await pageObject.click({
      stepIndex: 4,
      target: 'css:[href="/requests/create/multiproduct"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="/requests/create/multiproduct"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"/requests/create/multiproduct\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"/requests/create/multiproduct"},"stableDescendants":[],"semanticShape":["span"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="/requests/create/multiproduct"]')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 5,
      target: 'css:[data-pc-name="inputmask"][data-pc-section="root"]',
      value: String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? ''),
      valueKey: 'numero_de_identificacion',
      technicalTargetRefs: ['css:[data-pc-name="inputmask"][data-pc-section="root"]'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[data-pc-name="inputmask"][data-pc-section="root"]')!)!.fill(String(process.env['PROMOTED_NUMERO_DE_IDENTIFICACION'] ?? '')); }
    });
    await pageObject.click({
      stepIndex: 6,
      target: 'role:button',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button'],
      associatedField: 'Número de identificación',
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button')!)!.click(); }
    });
    await pageObject.click({
      stepIndex: 7,
      target: 'css:[aria-label="Depurar"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[aria-label="Depurar"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[aria-label=\"Depurar\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"button"},"stableDirectAttributes":{"aria-label":"Depurar"},"stableDescendants":[],"semanticShape":["span"],"landmarkAncestor":{"tag":"main"},"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[aria-label="Depurar"]')!)!.click(); }
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 7,
      target: 'Depurar',
      polarity: "positive",
      expectedUrl: 'https://srvqacgowb01.local.bsc.com:5000/requests/create/multiproduct',
      assertion: async () => { await expect(page).toHaveURL("https://srvqacgowb01.local.bsc.com:5000/requests/create/multiproduct"); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
