import { test } from '@playwright/test';
import { createPromotedSpecRuntime } from '../../../../../../../src/automations/runtime/promoted-spec-runtime';

export const PROMOTED_SPEC_STRATEGY = 'pom_runtime';

test('Visualizar la pantalla de seleccion con las dos opciones principales', async ({ page }) => {
  test.setTimeout(Number(process.env.PROMOTED_SPEC_TIMEOUT_MS ?? 90000));
  process.env.APP_SLUG = 'arquitectura-automatizacion';
  process.env.SECTION_SLUG = 'detalle-kiosko';
  process.env.SCENARIO_ID = 'PREVIEW-003';
  process.env.SCENARIO_TITLE = 'Visualizar la pantalla de seleccion con las dos opciones principales';

  const promotedRuntime = createPromotedSpecRuntime(page);

  try {
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    throw new Error('Unresolved promotion requirement: executable step 2 (login) requires a permitted promoted runtime or auth flow implementation, but none was supplied in the available APIs/auth flow context.');
  } finally {
    await promotedRuntime.finishEvidence();
  }
});