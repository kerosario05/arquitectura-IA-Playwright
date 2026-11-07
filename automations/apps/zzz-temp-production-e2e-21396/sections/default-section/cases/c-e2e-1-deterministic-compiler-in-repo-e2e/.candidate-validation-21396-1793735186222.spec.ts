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

test('Deterministic compiler in-repo e2e', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 120000));
  process.env.APP_SLUG = 'zzz-temp-production-e2e-21396';
  process.env.SECTION_SLUG = 'default-section';
  process.env.SCENARIO_ID = 'C-E2E-1';
  process.env.SCENARIO_TITLE = 'Deterministic compiler in-repo e2e';
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
    await pageObject.click({
      stepIndex: 2,
      target: 'role:button|Ingresar',
      actionIntent: 'click',
      expectedEffect: 'ui_change',
      technicalTargetRefs: ['role:button|Ingresar'],
      previousStepReplays: [{ stepIndex: 1, actionIntent: 'restore_recorded_context', target: 'role:textbox|Usuario', sensitive: false, replay: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:textbox|Usuario')!)!.fill(String(process.env['PROMOTED_USUARIO'] ?? '')); } }],
      action: async () => { await recordedLocatorFactory(page, parseSerializedTechnicalTargetString('role:button|Ingresar')!)!.click(); }
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
