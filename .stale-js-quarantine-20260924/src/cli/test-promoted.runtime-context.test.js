"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const promises_1 = __importDefault(require("node:fs/promises"));
const node_os_1 = __importDefault(require("node:os"));
const node_path_1 = __importDefault(require("node:path"));
const node_test_1 = __importDefault(require("node:test"));
const test_promoted_1 = require("./test-promoted");
const promoted_data_1 = require("../data/promoted-data");
const requiredKeys = [
    "auth.company_identifier",
    "auth.username",
    "auth.password",
];
async function withContext(entries, run) {
    const directory = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "promoted-runtime-context-"));
    const contextPath = node_path_1.default.join(directory, "context.json");
    await promises_1.default.writeFile(contextPath, JSON.stringify({ "44757": entries }), "utf8");
    try {
        await run(contextPath);
    }
    finally {
        await promises_1.default.rm(directory, { recursive: true, force: true });
    }
}
(0, node_test_1.default)("runtime context overrides inherited values without mutating process.env", async () => {
    await withContext(requiredKeys.map((key) => ({ key, value: `fixture-${key}` })), async (contextPath) => {
        const inherited = {
            APP_COMPANY_IDENTIFIER: "inherited-company",
            APP_USERNAME: "inherited-user",
            APP_PASSWORD: "inherited-password",
            DISCOVERY_RUNTIME_CONTEXT: contextPath,
        };
        const result = await (0, test_promoted_1.preparePromotedRuntimeInputs)({
            contextPath,
            caseId: 44757,
            baseEnv: inherited,
            requiredKeys,
        });
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(result.resolvedKeys, requiredKeys);
        strict_1.default.equal(result.env.APP_COMPANY_IDENTIFIER, "fixture-auth.company_identifier");
        strict_1.default.equal(result.env.APP_USERNAME, "fixture-auth.username");
        strict_1.default.equal(result.env.APP_PASSWORD, "fixture-auth.password");
        strict_1.default.equal(result.env.DISCOVERY_RUNTIME_CONTEXT, contextPath);
        strict_1.default.equal(inherited.APP_USERNAME, "inherited-user");
    });
});
(0, node_test_1.default)("explicit runtime inputs take precedence over a case context and inherited environment", async () => {
    await withContext(requiredKeys.map((key) => ({ key, value: `stale-${key}` })), async (contextPath) => {
        const result = await (0, test_promoted_1.preparePromotedRuntimeInputs)({
            contextPath,
            caseId: 44757,
            baseEnv: {
                APP_COMPANY_IDENTIFIER: "configured-company",
                APP_USERNAME: "configured-user",
                APP_PASSWORD: "configured-password",
                PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON: JSON.stringify(Object.fromEntries(requiredKeys.map((key) => [key, `explicit-${key}`]))),
            },
            requiredKeys,
        });
        strict_1.default.equal(result.ok, true);
        strict_1.default.deepEqual(result.resolvedSources, Object.fromEntries(requiredKeys.map((key) => [key, "user_provided_qa_credentials"])));
        strict_1.default.equal(result.env.APP_USERNAME, "explicit-auth.username");
        strict_1.default.equal(result.env.APP_PASSWORD, "explicit-auth.password");
    });
});
(0, node_test_1.default)("missing runtime keys fail closed and do not fall back to inherited env", async () => {
    for (const missingKey of requiredKeys) {
        const entries = requiredKeys
            .filter((key) => key !== missingKey)
            .map((key) => ({ key, value: `fixture-${key}` }));
        await withContext(entries, async (contextPath) => {
            const result = await (0, test_promoted_1.preparePromotedRuntimeInputs)({
                contextPath,
                caseId: 44757,
                baseEnv: {
                    APP_COMPANY_IDENTIFIER: "inherited-company",
                    APP_USERNAME: "inherited-user",
                    APP_PASSWORD: "inherited-password",
                },
                requiredKeys,
            });
            strict_1.default.equal(result.ok, false);
            strict_1.default.equal(result.missingKey, missingKey);
            strict_1.default.deepEqual(result.resolvedKeys, []);
        });
    }
});
(0, node_test_1.default)("empty runtime values are rejected and absent context cannot use inherited values", async () => {
    await withContext(requiredKeys.map((key) => ({ key, value: key.endsWith("password") ? "" : `fixture-${key}` })), async (contextPath) => {
        const result = await (0, test_promoted_1.preparePromotedRuntimeInputs)({
            contextPath,
            caseId: 44757,
            baseEnv: { APP_PASSWORD: "inherited-password" },
            requiredKeys,
        });
        strict_1.default.equal(result.ok, false);
        strict_1.default.equal(result.missingKey, "auth.password");
    });
    const absent = await (0, test_promoted_1.preparePromotedRuntimeInputs)({
        contextPath: undefined,
        caseId: 44757,
        baseEnv: { APP_USERNAME: "inherited-user" },
        requiredKeys,
    });
    strict_1.default.equal(absent.ok, false);
    strict_1.default.equal(absent.missingKey, "auth.company_identifier");
});
(0, node_test_1.default)("required keys are derived from the physical spec's env references", () => {
    const source = [
        "process.env.APP_COMPANY_IDENTIFIER",
        "process.env.APP_USERNAME",
        "process.env.APP_PASSWORD",
    ].join(" ");
    strict_1.default.deepEqual((0, test_promoted_1.resolvePromotedRuntimeInputKeys)(source), requiredKeys);
});
(0, node_test_1.default)("declared functional data keys are admitted to the runtime input gate", () => {
    const source = `const value = requirePromotedData(dataContext, "employee.invalid_document", { fieldName: "field" });`;
    strict_1.default.deepEqual((0, test_promoted_1.resolvePromotedRuntimeInputKeys)(source), ["employee.invalid_document"]);
});
(0, node_test_1.default)("explicit functional runtime input overrides stale context and reaches child data overrides", async () => {
    await withContext([{ key: "employee.invalid_document", value: "stale-value" }], async (contextPath) => {
        const result = await (0, test_promoted_1.preparePromotedRuntimeInputs)({
            contextPath,
            caseId: 44757,
            baseEnv: {
                PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON: JSON.stringify({ "employee.invalid_document": "explicit-value" }),
            },
            requiredKeys: ["employee.invalid_document"],
        });
        strict_1.default.equal(result.ok, true);
        strict_1.default.equal(result.resolvedSources["employee.invalid_document"], "explicit_runtime_input");
        strict_1.default.equal(result.env.PROMOTED_RUNTIME_DATA_OVERRIDES_JSON, undefined);
        const previous = process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
        try {
            process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON = result.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
            const dataContext = (0, promoted_data_1.buildPromotedDataContext)({
                baseDataContext: {
                    entries: [{ key: "employee.invalid_document", value: "stale-base", source: "test_data", sensitive: false }],
                    counts: { total: 1, sensitive: 0, nonSensitive: 1 },
                },
                autoGenerateTestData: false,
            });
            strict_1.default.equal(dataContext.entries.find((entry) => entry.key === "employee.invalid_document")?.value, "explicit-value");
            strict_1.default.equal(dataContext.entries.find((entry) => entry.key === "employee.invalid_document")?.source, "explicit_runtime_input");
        }
        finally {
            if (previous === undefined)
                delete process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
            else
                process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON = previous;
        }
    });
});
(0, node_test_1.default)("runtime-only functional values are masked and omitted from promoted manifests", () => {
    const previous = process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
    try {
        process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON = JSON.stringify({ "employee.invalid_document": "runtime-only-value" });
        const dataContext = (0, promoted_data_1.buildPromotedDataContext)({
            baseDataContext: { entries: [], counts: { total: 0, sensitive: 0, nonSensitive: 0 } },
            autoGenerateTestData: false,
        });
        const manifest = (0, promoted_data_1.buildPromotedDataManifest)({
            steps: [{ index: 1, action: "fill", valueKey: "employee.invalid_document", target: { name: "field" } }],
            requiredData: [{ key: "employee.invalid_document", required: true, sensitive: false }],
        }, dataContext);
        const entry = manifest.entries[0];
        strict_1.default.equal(entry.source, "explicit_runtime_input");
        strict_1.default.equal(entry.value, undefined);
        strict_1.default.notEqual(entry.maskedValue, "runtime-only-value");
    }
    finally {
        if (previous === undefined)
            delete process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON;
        else
            process.env.PROMOTED_RUNTIME_EXPLICIT_INPUTS_JSON = previous;
    }
});
