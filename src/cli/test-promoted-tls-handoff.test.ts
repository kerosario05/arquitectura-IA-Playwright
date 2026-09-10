import test from "node:test";
import assert from "node:assert/strict";
import { buildPromotedExecutionEnvWithConfig } from "./test-promoted";
import { resolvePromotedIgnoreHTTPSErrors } from "../../playwright.config";

const baseConfig = {
  appProfile: { appSlug: "generic-app", source: "default", createdAt: "", updatedAt: "" },
  baseUrl: "https://example.test",
  loginMode: "no_login",
  testData: {},
  testDataAliases: {},
  testDataRefs: {},
  missingInputBehavior: "fail",
  updatedAt: "",
};

test("projects explicit project TLS true and false without changing base URL", () => {
  for (const value of [true, false]) {
    const env = buildPromotedExecutionEnvWithConfig(
      { APP_BASE_URL: "https://legacy.test", APP_IGNORE_HTTPS_ERRORS: "true" },
      "generic-app",
      { ...baseConfig, ignoreHTTPSErrors: value },
    );
    assert.equal(env.APP_BASE_URL, "https://example.test");
    assert.equal(env.APP_IGNORE_HTTPS_ERRORS, String(value));
    assert.equal(resolvePromotedIgnoreHTTPSErrors(env.APP_IGNORE_HTTPS_ERRORS), value);
  }
});

test("project TLS absence removes stale handoff and preserves default behavior", () => {
  const env = buildPromotedExecutionEnvWithConfig(
    { APP_BASE_URL: "https://legacy.test", APP_IGNORE_HTTPS_ERRORS: "true" },
    "generic-app",
    baseConfig,
  );
  assert.equal(env.APP_IGNORE_HTTPS_ERRORS, undefined);
  assert.equal(resolvePromotedIgnoreHTTPSErrors(env.APP_IGNORE_HTTPS_ERRORS), undefined);
});

test("strict Playwright TLS parsing preserves false and absence", () => {
  assert.equal(resolvePromotedIgnoreHTTPSErrors("true"), true);
  assert.equal(resolvePromotedIgnoreHTTPSErrors("false"), false);
  assert.equal(resolvePromotedIgnoreHTTPSErrors(undefined), undefined);
  assert.equal(resolvePromotedIgnoreHTTPSErrors("1"), undefined);
  assert.equal(resolvePromotedIgnoreHTTPSErrors("yes"), undefined);
});
