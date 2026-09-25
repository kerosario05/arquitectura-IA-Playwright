import assert from "node:assert";
import test from "node:test";
import type { AppProfile } from "./app-profile";
import {
  buildPlaywrightCommandEnv,
  resolvePlaywrightLaunchContext,
  type HybridSpecGenerationInput,
} from "./spec-generation-hybrid";

/**
 * P0 fix: the functional-execution Playwright child must receive the same effective
 * runtime start URL authority that Discovery already resolved (project_sql / project
 * runtime configuration -> appProfile.baseUrl), instead of relying on a stale/absent
 * process.env.APP_BASE_URL. These tests cover the propagation boundary only, hermetically
 * (no browser, no Codex, no QA Lab, no TestRail).
 */

function buildProfile(overrides: Partial<AppProfile> = {}): AppProfile {
  const now = new Date().toISOString();
  return {
    appSlug: "kiosko",
    source: "default",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function buildMinimalInput(appProfile: AppProfile): HybridSpecGenerationInput {
  return { appProfile } as unknown as HybridSpecGenerationInput;
}

test("URL propagation: functional runner receives resolved runtime APP_BASE_URL", async (t) => {
  const originalAutomationHeadless = process.env.AUTOMATION_HEADLESS;
  const originalHeadless = process.env.HEADLESS;
  delete process.env.AUTOMATION_HEADLESS;
  delete process.env.HEADLESS;

  t.after(() => {
    if (originalAutomationHeadless === undefined) delete process.env.AUTOMATION_HEADLESS;
    else process.env.AUTOMATION_HEADLESS = originalAutomationHeadless;
    if (originalHeadless === undefined) delete process.env.HEADLESS;
    else process.env.HEADLESS = originalHeadless;
  });

  await t.test("1. functional runner env patch carries the project-authority APP_BASE_URL, not a literal or stale process env", () => {
    const input = buildMinimalInput(
      buildProfile({ baseUrl: "https://kiosko.example.test/inicio", appSlug: "kiosko" }),
    );
    const launchContext = resolvePlaywrightLaunchContext(input);
    assert.strictEqual(launchContext.appBaseUrl, "https://kiosko.example.test/inicio");
    assert.strictEqual(launchContext.appSlug, "kiosko");

    const envPatch = buildPlaywrightCommandEnv(launchContext);
    assert.ok(envPatch, "env patch must be produced when an appBaseUrl is resolved");
    assert.strictEqual(envPatch!.APP_BASE_URL, "https://kiosko.example.test/inicio");
    assert.strictEqual(envPatch!.APP_SLUG, "kiosko");
  });

  await t.test("2. start URL source is the project/runtime authority (appProfile.baseUrl), never a candidate literal", () => {
    const input = buildMinimalInput(
      buildProfile({ baseUrl: "https://another-app.example.test/home", appSlug: "another-app" }),
    );
    const launchContext = resolvePlaywrightLaunchContext(input);
    assert.strictEqual(launchContext.appBaseUrl, "https://another-app.example.test/home");
    assert.notStrictEqual(launchContext.appBaseUrl, "kiosko");
  });

  await t.test("3. env patch omits APP_BASE_URL when appProfile has no resolved baseUrl (fails closed, no hardcoded fallback)", () => {
    const input = buildMinimalInput(buildProfile({ baseUrl: undefined }));
    const launchContext = resolvePlaywrightLaunchContext(input);
    assert.strictEqual(launchContext.appBaseUrl, undefined);

    const envPatch = buildPlaywrightCommandEnv(launchContext);
    assert.ok(!envPatch || envPatch.APP_BASE_URL === undefined, "must not fabricate an APP_BASE_URL when none was resolved");
  });

  await t.test("4. env patch propagation is independent of headless resolution (previously skipped when headless was null)", () => {
    const input = buildMinimalInput(buildProfile({ baseUrl: "https://kiosko.example.test/inicio" }));
    const launchContext = resolvePlaywrightLaunchContext(input);
    assert.strictEqual(launchContext.headless, null, "headless is expected to be unresolved in this scenario");

    const envPatch = buildPlaywrightCommandEnv(launchContext);
    assert.ok(envPatch, "APP_BASE_URL propagation must not be gated behind headless resolution");
    assert.strictEqual(envPatch!.APP_BASE_URL, "https://kiosko.example.test/inicio");
    assert.strictEqual(envPatch!.HEADLESS, undefined, "HEADLESS must remain unset when headless resolution is null");
  });
});
