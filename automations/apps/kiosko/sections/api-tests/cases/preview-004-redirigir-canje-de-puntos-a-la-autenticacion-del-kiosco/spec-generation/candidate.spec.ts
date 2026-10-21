import { test, expect } from '@playwright/test';
import { scanCurrentPage } from '../../../../../../../../src/explorer/page-scanner';
import { detectAuthGate } from '../../../../../../../../src/discovery/auth-gate-detector';
import { createPromotedSpecRuntime } from '../../../../../../../../src/automations/runtime/promoted-spec-runtime';

class DeterministicPromotedPage {
  constructor(private readonly runtime: ReturnType<typeof createPromotedSpecRuntime>) {}
  fill(options: Parameters<typeof this.runtime.fillPromotedField>[0]) { return this.runtime.fillPromotedField(options); }
  click(options: Parameters<typeof this.runtime.clickPromotedTarget>[0]) { return this.runtime.clickPromotedTarget(options); }
  press(options: Parameters<typeof this.runtime.pressPromotedTarget>[0]) { return this.runtime.pressPromotedTarget(options); }
  select(options: Parameters<typeof this.runtime.selectPromotedItem>[0]) { return this.runtime.selectPromotedItem(options); }
}

test('Redirigir Canje de Puntos a la autenticación del kiosco', async ({ page }) => {
  test.setTimeout(Math.max(test.info().timeout, 76000));
  process.env.APP_SLUG = 'kiosko';
  process.env.SECTION_SLUG = 'api-tests';
  process.env.SCENARIO_ID = 'PREVIEW-004';
  process.env.SCENARIO_TITLE = 'Redirigir Canje de Puntos a la autenticación del kiosco';
  const promotedRuntime = createPromotedSpecRuntime(page);
  const pageObject = new DeterministicPromotedPage(promotedRuntime);
  try {
    const navigationUrl_1 = process.env.APP_BASE_URL;
    if (!navigationUrl_1) throw new Error('APP_BASE_URL is required');
    await page.goto(navigationUrl_1);
    await page.waitForLoadState('domcontentloaded');
    await promotedRuntime.expectPromotedVisible({ stepIndex: 2, target: 'authentication gate', polarity: 'positive', assertion: async () => {
      await expect.poll(async () => { const gate = detectAuthGate(await scanCurrentPage(page)); return gate.detected && gate.stage !== 'unknown' && gate.stage !== 'authenticated_landing'; }).toBe(true);
    } });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
