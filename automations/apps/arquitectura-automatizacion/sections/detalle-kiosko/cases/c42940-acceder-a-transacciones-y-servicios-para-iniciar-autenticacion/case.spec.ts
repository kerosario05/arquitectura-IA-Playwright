import { test, expect } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';
import { scanCurrentPage } from '../../../../../../../src/explorer/page-scanner';
import { detectAuthGate } from '../../../../../../../src/discovery/auth-gate-detector';

test('Acceder a Transacciones y servicios para iniciar autenticacion', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'C42940';
  process.env.SCENARIO_TITLE = 'Acceder a Transacciones y servicios para iniciar autenticacion';

  const promotedRuntime = createPromotedSpecRuntime(page);
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error('APP_BASE_URL is required');

  try {
    await page.goto(baseUrl);
    await page.waitForLoadState('domcontentloaded');

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 3,
      target: 'Iniciar',
      actionIntent: 'click_step',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [],
      lastSelectionStep: undefined,
      action: async () => {
        await page.getByRole('button', { name: /Iniciar/i }).first().click();
      },
    });

    await promotedRuntime.clickPromotedTarget({
      stepIndex: 4,
      target: 'transacciones y servicios',
      actionIntent: 'click_step',
      expectedEffect: 'ui_change',
      sensitive: false,
      previousStepReplays: [],
      lastSelectionStep: undefined,
      action: async () => {
        await page.getByRole('button', { name: /transacciones y servicios/i }).first().click();
      },
    });

    await promotedRuntime.expectPromotedVisible({
      stepIndex: 2,
      target: 'auth_gate',
      description: 'Auth gate should be observable after functional clicks.',
      assertion: async () => {
        let authGateStarted = false;
        for (let attempt = 0; attempt < 4; attempt += 1) {
          const authSnapshot = await scanCurrentPage(page);
          const authDetection = detectAuthGate(authSnapshot);
          authGateStarted = authDetection.detected
            || authDetection.stage === 'authenticated_landing'
            || authDetection.evidence.some((evidence: unknown) => /identificaci[oó]n|otp|transacciones y servicios/i.test(String(evidence)));
          if (authGateStarted) break;
          await page.waitForLoadState('domcontentloaded', { timeout: 1000 }).catch(() => undefined);
        }
        await expect(authGateStarted).toBeTruthy();
      },
    });
  } finally {
    await promotedRuntime.finishEvidence();
  }
});
