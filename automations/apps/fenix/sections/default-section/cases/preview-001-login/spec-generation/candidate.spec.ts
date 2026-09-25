import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime, parseSerializedTechnicalTargetString } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { recordedLocatorFactory } from '../../../../../../../../src/discovery/target-resolver';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
}

test('Login', async ({ page }) => {
  process.env.APP_SLUG = 'fenix';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'PREVIEW-001';
  process.env.SCENARIO_TITLE = 'Login';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    await pageObject.click({
      stepIndex: 1,
      target: 'css:[href="#empresarial"]',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['css:[href="#empresarial"]'],
      structuralTarget: {"interactionEvidence":[],"validatedByInteraction":true,"certifiedFrom":"recording","targetType":"structural","locatorCandidates":[{"strategy":"css","value":"[href=\"#empresarial\"]","confidence":0.85}],"structuralContext":{"owner":{"tag":"a"},"stableDirectAttributes":{"href":"#empresarial"},"stableDescendants":[],"semanticShape":["span"],"deterministicStructuralIdentity":true,"structuralIdentityMatchCount":1},"confidence":0.85,"certificationTier":1},
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('css:[href="#empresarial"]')!)!.click(); }
    });
    await pageObject.fill({
      stepIndex: 2,
      target: 'role:textbox|RNC:',
      value: String(process.env['PROMOTED_RNC'] ?? ''),
      valueKey: 'rnc',
      technicalTargetRefs: ['role:textbox|RNC:'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|RNC:')!)!.fill(String(process.env['PROMOTED_RNC'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 3,
      target: 'role:textbox|Usuario:',
      value: String(process.env['PROMOTED_USUARIO'] ?? ''),
      valueKey: 'usuario',
      technicalTargetRefs: ['role:textbox|Usuario:'],
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario:')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); }
    });
    await pageObject.fill({
      stepIndex: 4,
      target: 'role:textbox|Contraseña:',
      value: String(process.env['PROMOTED_CONTRASENA'] ?? ''),
      valueKey: 'contrasena',
      technicalTargetRefs: ['role:textbox|Contraseña:'],
      authGateExpected: true,
      fill: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Contraseña:')!)!.fill(String(process.env['PROMOTED_CONTRASENA'] ?? '')); }
    });
    await pageObject.press({
      stepIndex: 5,
      target: 'role:textbox|Contraseña:',
      key: 'Enter'
    });
    await promotedRuntime.expectPromotedVisible({
      stepIndex: 5,
      target: 'Contraseña:',
      polarity: "positive",
      expectedUrl: 'https://qa1.santacruz.do/onlinebanking/',
      assertion: async () => { await expect(page).toHaveURL("https://qa1.santacruz.do/onlinebanking/"); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
