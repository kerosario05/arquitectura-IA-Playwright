import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildPlaywrightCommandEnv,
  resolvePlaywrightLaunchContext,
  runNodeCommand,
  type HybridSpecGenerationInput,
} from "./spec-generation-hybrid";
import type { AppProfile } from "./app-profile";

/**
 * P0-2 fix: job d7e817ee-76be-4e3c-b13b-f2c51b74c690 (appSlug=kiosko) still failed at
 * PRE_BUSINESS_INITIAL_READINESS with rawAppBaseUrl=missing even though the project_sql
 * authority (Projects/WebProjectConfiguration.baseUrl) and the fail-closed resolution in
 * case-discovery-workflow.ts (activeConfig.app.baseUrl) were both correct. The real loss
 * boundary was NOT inside resolvePlaywrightLaunchContext/buildPlaywrightCommandEnv/
 * runNodeCommand (all three are proven correct below) -- it was one call site upstream:
 * case-discovery-workflow.ts passed the pre-resolution `options.appProfile` object straight
 * through as `appProfileObject`, and promote-plan.ts's `promoteExecutionPlan` prefers
 * `input.appProfileObject` over `input.fullConfig` when both are present. That stale
 * appProfileObject never carried the SQL-resolved baseUrl, so it silently overrode the
 * correctly-resolved fullConfig.app.baseUrl with `undefined`.
 *
 * These tests are fully hermetic: no browser, no real AI, no QA Lab, no TestRail. The
 * spawn-boundary tests below use the REAL runNodeCommand primitive (execFile, no shell)
 * against a trivial Node probe script instead of the Playwright CLI, so they exercise the
 * actual child_process spawn options.env a real child process receives, not just the
 * in-process object returned by buildPlaywrightCommandEnv.
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

const probeScript = "process.stdout.write('APP_BASE_URL=' + (process.env.APP_BASE_URL ?? '') + ' APP_SLUG=' + (process.env.APP_SLUG ?? ''))";

test("spawn boundary: real child process receives the resolved runtime APP_BASE_URL", async (t) => {
  const originalAppBaseUrl = process.env.APP_BASE_URL;
  t.after(() => {
    if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
    else process.env.APP_BASE_URL = originalAppBaseUrl;
  });

  await t.test("3+4+5. functional-execution env patch reaches spawn options.env and a real child process sees it", async () => {
    delete process.env.APP_BASE_URL;
    const input = buildMinimalInput(
      buildProfile({ baseUrl: "https://172.27.4.50/", appSlug: "kiosko" }),
    );
    const launchContext = resolvePlaywrightLaunchContext(input);
    const envPatch = buildPlaywrightCommandEnv(launchContext);
    assert.ok(envPatch);

    const result = await runNodeCommand(process.execPath, ["-e", probeScript], envPatch);
    assert.equal(result.ok, true);
    assert.equal(result.stdout, "APP_BASE_URL=https://172.27.4.50/ APP_SLUG=kiosko");
  });

  await t.test("6. a stale pre-existing parent process.env.APP_BASE_URL cannot override the newer project-authority value", async () => {
    process.env.APP_BASE_URL = "https://stale-parent-env.example.test/";
    const input = buildMinimalInput(
      buildProfile({ baseUrl: "https://172.27.4.50/", appSlug: "kiosko" }),
    );
    const launchContext = resolvePlaywrightLaunchContext(input);
    const envPatch = buildPlaywrightCommandEnv(launchContext);

    const result = await runNodeCommand(process.execPath, ["-e", probeScript], envPatch);
    assert.equal(result.ok, true);
    assert.equal(result.stdout, "APP_BASE_URL=https://172.27.4.50/ APP_SLUG=kiosko");
  });

  await t.test("7. missing appProfile.baseUrl never fabricates a URL -- child inherits whatever the real parent env had, nothing invented", async () => {
    delete process.env.APP_BASE_URL;
    const input = buildMinimalInput(buildProfile({ baseUrl: undefined }));
    const launchContext = resolvePlaywrightLaunchContext(input);
    const envPatch = buildPlaywrightCommandEnv(launchContext);

    const result = await runNodeCommand(process.execPath, ["-e", probeScript], envPatch);
    assert.equal(result.ok, true);
    assert.equal(result.stdout, "APP_BASE_URL= APP_SLUG=kiosko");
    assert.ok(!result.stdout.includes("172.27.4.50"), "must not fabricate the diagnostic/example URL when appProfile.baseUrl is unresolved");
  });
});

test("first-loss-boundary regression guard: case-discovery-workflow.ts must not bypass the resolved baseUrl", async (t) => {
  await t.test("D. promoteExecutionPlan's appProfileObject is built from the fail-closed activeConfig.app.baseUrl, not the raw pre-resolution options.appProfile", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "..", "discovery", "case-discovery-workflow.ts"),
      "utf-8",
    );
    const staleBypassIndex = source.indexOf("appProfileObject: options.appProfile,");
    const fixedOverrideIndex = source.indexOf("appProfileObject: options.appProfile\n            ? { ...options.appProfile, baseUrl: activeConfig.app.baseUrl }");
    assert.equal(staleBypassIndex, -1, "must not silently pass the pre-resolution appProfile object as appProfileObject (it bypasses fullConfig.app.baseUrl in promote-plan.ts)");
    assert.ok(fixedOverrideIndex >= 0, "appProfileObject must be rebuilt with the fail-closed activeConfig.app.baseUrl before being handed to promoteExecutionPlan");
  });
});

test("child-runtime telemetry: distinguishable from parent-side [promoted-initial-navigation] logging", async (t) => {
  await t.test("E. PromotedSpecRuntime emits phase=runtime and resolvedUrlSource=child_env (parent emits resolvedUrlSource=appProfile.baseUrl)", () => {
    const source = fs.readFileSync(
      path.join(__dirname, "runtime", "promoted-spec-runtime.ts"),
      "utf-8",
    );
    assert.ok(
      source.includes('[promoted-initial-navigation] phase=runtime appSlug='),
      "child runtime telemetry must be tagged phase=runtime"
    );
    assert.ok(
      source.includes('const resolvedUrlSource = appBaseUrl ? "child_env" : "none";'),
      "child runtime telemetry must report resolvedUrlSource=child_env, distinct from the parent's resolvedUrlSource=appProfile.baseUrl"
    );
    assert.ok(
      !source.includes("rawAppBaseUrl=${appBaseUrl ?? "),
      "child runtime telemetry must not print the raw URL value (present/missing only, no secrets)"
    );
  });
});
