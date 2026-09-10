import test from "node:test";
import assert from "node:assert/strict";
import { buildMergedConfig, serializeRuntimeConfigForPromotion } from "./app-profile";
import { buildDiscoveryBrowserContextOptions } from "../discovery/case-discovery-workflow";

function config(ignoreHTTPSErrors?: boolean): any {
  return {
    app: {
      appProfile: "generic-app",
      name: "Generic",
      baseUrl: "https://example.test",
      loginMode: "no_login",
      testData: { marker: "kept" },
      testDataAliases: {},
      missingInputBehavior: "fail",
      ...(ignoreHTTPSErrors === undefined ? {} : { ignoreHTTPSErrors }),
    },
  };
}

test("preserves true, false, and absence through promotion and merge", () => {
  for (const value of [true, false, undefined]) {
    const serialized = serializeRuntimeConfigForPromotion(config(value));
    assert.equal(serialized.ignoreHTTPSErrors, value);
    assert.equal(serialized.appProfile.ignoreHTTPSErrors, value);

    const merged = buildMergedConfig(serialized, config(value));
    assert.equal(merged.app.ignoreHTTPSErrors, value);
    assert.equal(merged.app.baseUrl, "https://example.test");
  }
});

test("project-scoped boolean wins over legacy truthiness", () => {
  const legacy = config(true);
  assert.equal(buildMergedConfig({ ...serializeRuntimeConfigForPromotion(config(false)), ignoreHTTPSErrors: false }, legacy).app.ignoreHTTPSErrors, false);
  assert.equal(buildMergedConfig({ ...serializeRuntimeConfigForPromotion(config(true)), ignoreHTTPSErrors: true }, config(false)).app.ignoreHTTPSErrors, true);
});

test("discovery context projection keeps the existing strict boolean semantics", () => {
  assert.equal(buildDiscoveryBrowserContextOptions({ app: { ignoreHTTPSErrors: true } }).ignoreHTTPSErrors, true);
  assert.equal(buildDiscoveryBrowserContextOptions({ app: { ignoreHTTPSErrors: false } }).ignoreHTTPSErrors, false);
});
