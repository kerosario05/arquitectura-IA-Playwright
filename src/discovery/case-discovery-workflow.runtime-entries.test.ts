import assert from "node:assert";
import { toScenarioDataOverrides } from "./case-discovery-workflow";
import { formatDataKeyForLog, resolveDataKey } from "../data/data-key-resolver";
import { resolveAuthInputs } from "./auth-input-resolver";

function test(label: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS  ${label}`);
  } catch (err) {
    console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  }
}

function describe(_name: string, fn: () => void): void {
  console.log(`\n${_name}`);
  fn();
}

describe("toScenarioDataOverrides", () => {
  test("converts runtime entries into a lookup map preserving namespaced keys", () => {
    const overrides = toScenarioDataOverrides([
      { key: "auth.username", value: "runtime-user", source: "fixture", sensitive: false },
    ]);
    assert.strictEqual(overrides["auth.username"], "runtime-user");
  });

  test("runtime entries win over testData and env through resolveDataKey", () => {
    const overrides = toScenarioDataOverrides([
      { key: "auth.username", value: "runtime-user", source: "fixture", sensitive: false },
    ]);
    const resolution = resolveDataKey("auth.username", {
      testData: { "auth.username": "testdata-user" },
      env: { APP_AUTH_USERNAME: "env-user" },
      missingInputBehavior: "fail",
      overrides,
    });
    assert.strictEqual(resolution.status, "resolved");
    assert.strictEqual(resolution.value, "runtime-user");
    assert.strictEqual(resolution.source, "dataOverrides");
  });

  test("runtime entry provenance survives data resolution", () => {
    const resolution = resolveDataKey("employee.invalid_document", {
      testData: { "employee.invalid_document": "stale" },
      overrides: { "employee.invalid_document": "override" },
      runtimeEntries: [{ key: "employee.invalid_document", value: "runtime", source: "explicit_runtime_input" }],
    });
    assert.strictEqual(resolution.value, "runtime");
    assert.strictEqual(resolution.source, "explicit_runtime_input");
  });

  test("document runtime values remain masked with explicit provenance", () => {
    const value = "runtime-document-value";
    const resolution = resolveDataKey("employee.invalid_document", {
      runtimeEntries: [{ key: "employee.invalid_document", value, source: "explicit_runtime_input" }],
    });
    assert.equal(resolution.masked, true);
    assert.equal(formatDataKeyForLog(resolution).includes(value), false);
  });

  test("auth runtime values remain masked with explicit provenance", () => {
    for (const key of ["auth.company_identifier", "auth.username"]) {
      const value = `runtime-${key}`;
      const resolution = resolveDataKey(key, {
        runtimeEntries: [{ key, value, source: "user_provided_qa_credentials" }],
      });
      assert.equal(resolution.masked, true);
      assert.equal(formatDataKeyForLog(resolution).includes(value), false);
    }
  });

  test("empty runtime entries keep behavior identical", () => {
    const overrides = toScenarioDataOverrides(undefined);
    assert.deepStrictEqual(overrides, {});
  });

  test("sensitive runtime values never appear in resolver logs", () => {
    const overrides = toScenarioDataOverrides([
      { key: "customerId", value: "runtime-sensitive-value", source: "manual_runtime", sensitive: true },
    ]);
    const resolution = resolveDataKey("customerId", { overrides });
    assert.strictEqual(formatDataKeyForLog(resolution).includes("runtime-sensitive-value"), false);
  });
});

describe("runtime auth input precedence", () => {
  test("explicit case runtime keys win over stale test data and environment by declared key", () => {
    const resolution = resolveAuthInputs({
      env: {
        APP_TEST_DATA_JSON: {
          clients: {
            defaultClient: {
              identificationNumber: "stale-test-data",
              username: "stale-test-user",
              password: "stale-test-password",
            },
          },
        },
        Identity_Provider: "stale-environment-id",
        APP_USERNAME: "stale-environment-user",
        APP_PASSWORD: "stale-environment-password",
      },
      missingInputBehavior: "fail",
      runtimeEntries: [
        { key: "auth.company_identifier", value: "runtime-rnc", source: "user_provided_qa_credentials" },
        { key: "auth.username", value: "runtime-user", source: "user_provided_qa_credentials" },
        { key: "auth.password", value: "runtime-password", source: "user_provided_qa_credentials" },
      ],
    });

    assert.equal(resolution.data.identificationNumber, "runtime-rnc");
    assert.equal(resolution.data.username, "runtime-user");
    assert.equal(resolution.data.password, "runtime-password");
    assert.equal(resolution.sources.identificationNumber, "user_provided_qa_credentials");
    assert.equal(resolution.sources.username, "user_provided_qa_credentials");
    assert.equal(resolution.sources.password, "user_provided_qa_credentials");
  });
});
