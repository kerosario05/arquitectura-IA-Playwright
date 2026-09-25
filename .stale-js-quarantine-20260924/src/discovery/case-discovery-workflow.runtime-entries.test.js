"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_assert_1 = __importDefault(require("node:assert"));
const case_discovery_workflow_1 = require("./case-discovery-workflow");
const data_key_resolver_1 = require("../data/data-key-resolver");
const auth_input_resolver_1 = require("./auth-input-resolver");
function test(label, fn) {
    try {
        fn();
        console.log(`  PASS  ${label}`);
    }
    catch (err) {
        console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
    }
}
function describe(_name, fn) {
    console.log(`\n${_name}`);
    fn();
}
describe("toScenarioDataOverrides", () => {
    test("converts runtime entries into a lookup map preserving namespaced keys", () => {
        const overrides = (0, case_discovery_workflow_1.toScenarioDataOverrides)([
            { key: "auth.username", value: "runtime-user", source: "fixture", sensitive: false },
        ]);
        node_assert_1.default.strictEqual(overrides["auth.username"], "runtime-user");
    });
    test("runtime entries win over testData and env through resolveDataKey", () => {
        const overrides = (0, case_discovery_workflow_1.toScenarioDataOverrides)([
            { key: "auth.username", value: "runtime-user", source: "fixture", sensitive: false },
        ]);
        const resolution = (0, data_key_resolver_1.resolveDataKey)("auth.username", {
            testData: { "auth.username": "testdata-user" },
            env: { APP_AUTH_USERNAME: "env-user" },
            missingInputBehavior: "fail",
            overrides,
        });
        node_assert_1.default.strictEqual(resolution.status, "resolved");
        node_assert_1.default.strictEqual(resolution.value, "runtime-user");
        node_assert_1.default.strictEqual(resolution.source, "dataOverrides");
    });
    test("runtime entry provenance survives data resolution", () => {
        const resolution = (0, data_key_resolver_1.resolveDataKey)("employee.invalid_document", {
            testData: { "employee.invalid_document": "stale" },
            overrides: { "employee.invalid_document": "override" },
            runtimeEntries: [{ key: "employee.invalid_document", value: "runtime", source: "explicit_runtime_input" }],
        });
        node_assert_1.default.strictEqual(resolution.value, "runtime");
        node_assert_1.default.strictEqual(resolution.source, "explicit_runtime_input");
    });
    test("document runtime values remain masked with explicit provenance", () => {
        const value = "runtime-document-value";
        const resolution = (0, data_key_resolver_1.resolveDataKey)("employee.invalid_document", {
            runtimeEntries: [{ key: "employee.invalid_document", value, source: "explicit_runtime_input" }],
        });
        node_assert_1.default.equal(resolution.masked, true);
        node_assert_1.default.equal((0, data_key_resolver_1.formatDataKeyForLog)(resolution).includes(value), false);
    });
    test("auth runtime values remain masked with explicit provenance", () => {
        for (const key of ["auth.company_identifier", "auth.username"]) {
            const value = `runtime-${key}`;
            const resolution = (0, data_key_resolver_1.resolveDataKey)(key, {
                runtimeEntries: [{ key, value, source: "user_provided_qa_credentials" }],
            });
            node_assert_1.default.equal(resolution.masked, true);
            node_assert_1.default.equal((0, data_key_resolver_1.formatDataKeyForLog)(resolution).includes(value), false);
        }
    });
    test("empty runtime entries keep behavior identical", () => {
        const overrides = (0, case_discovery_workflow_1.toScenarioDataOverrides)(undefined);
        node_assert_1.default.deepStrictEqual(overrides, {});
    });
    test("sensitive runtime values never appear in resolver logs", () => {
        const overrides = (0, case_discovery_workflow_1.toScenarioDataOverrides)([
            { key: "customerId", value: "runtime-sensitive-value", source: "manual_runtime", sensitive: true },
        ]);
        const resolution = (0, data_key_resolver_1.resolveDataKey)("customerId", { overrides });
        node_assert_1.default.strictEqual((0, data_key_resolver_1.formatDataKeyForLog)(resolution).includes("runtime-sensitive-value"), false);
    });
});
describe("runtime auth input precedence", () => {
    test("explicit case runtime keys win over stale test data and environment by declared key", () => {
        const resolution = (0, auth_input_resolver_1.resolveAuthInputs)({
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
        node_assert_1.default.equal(resolution.data.identificationNumber, "runtime-rnc");
        node_assert_1.default.equal(resolution.data.username, "runtime-user");
        node_assert_1.default.equal(resolution.data.password, "runtime-password");
        node_assert_1.default.equal(resolution.sources.identificationNumber, "user_provided_qa_credentials");
        node_assert_1.default.equal(resolution.sources.username, "user_provided_qa_credentials");
        node_assert_1.default.equal(resolution.sources.password, "user_provided_qa_credentials");
    });
});
