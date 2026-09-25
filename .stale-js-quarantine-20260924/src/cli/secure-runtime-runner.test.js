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
const secure_runtime_runner_1 = require("./secure-runtime-runner");
(0, node_test_1.default)("builds a Windows npm.cmd invocation with shell enabled and separated args", () => {
    const runnerArgs = (0, secure_runtime_runner_1.parseSecureRuntimeRunnerArgs)([
        "--app", "app-a", "--case-id", "C42", "--section", "section-a", "--force-rediscovery", "--headed",
    ]);
    const env = { DISCOVERY_RUNTIME_CONTEXT: "C:\\Temp\\runtime-context.json" };
    const invocation = (0, secure_runtime_runner_1.buildDiscoveryChildInvocation)(runnerArgs, env, { platform: "win32", cwd: "C:\\workspace" });
    strict_1.default.equal(invocation.command, "npm.cmd");
    strict_1.default.equal(invocation.shell, true);
    strict_1.default.equal(invocation.cwd, "C:\\workspace");
    strict_1.default.equal(invocation.stdio, "inherit");
    strict_1.default.equal(invocation.env.DISCOVERY_RUNTIME_CONTEXT, env.DISCOVERY_RUNTIME_CONTEXT);
    strict_1.default.equal(invocation.args.includes("--overwrite"), true);
    strict_1.default.equal(invocation.args.includes("--headed"), true);
    strict_1.default.equal(invocation.args.some((value) => value === undefined || value === null), false);
    strict_1.default.deepEqual(invocation.args.slice(0, 4), ["run", "discovery:case", "--", "--case-id"]);
});
(0, node_test_1.default)("builds a non-Windows npm invocation without shell", () => {
    const runnerArgs = (0, secure_runtime_runner_1.parseSecureRuntimeRunnerArgs)(["--app", "app-b", "--case-id", "9", "--headless"]);
    const invocation = (0, secure_runtime_runner_1.buildDiscoveryChildInvocation)(runnerArgs, { DISCOVERY_RUNTIME_CONTEXT: "/tmp/context.json" }, { platform: "linux" });
    strict_1.default.equal(invocation.command, "npm");
    strict_1.default.equal(invocation.shell, false);
    strict_1.default.equal(invocation.args.includes("--headed"), false);
});
(0, node_test_1.default)("secure runner builds case-scoped runtimeEntriesByCase with canonical auth keys", () => {
    const result = (0, secure_runtime_runner_1.buildRuntimeEntriesByCase)(123, {
        companyIdentifier: "qa-company",
        username: "qa-user",
        password: "qa-password",
    });
    strict_1.default.deepEqual(result["123"]?.map((entry) => ({
        key: entry.key,
        source: entry.source,
        sensitive: entry.sensitive,
        generated: entry.generated,
        verified: entry.verified,
    })), [
        { key: "auth.company_identifier", source: "manual_runtime", sensitive: true, generated: false, verified: true },
        { key: "auth.username", source: "manual_runtime", sensitive: true, generated: false, verified: true },
        { key: "auth.password", source: "manual_runtime", sensitive: true, generated: false, verified: true },
    ]);
});
(0, node_test_1.default)("secure runner prompts through injected input, forwards context reference, and cleans up", async () => {
    const tempRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "secure-runner-test-"));
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.map(String).join(" "));
    let observedContextPath = "";
    let observedArgs = [];
    try {
        const exitCode = await (0, secure_runtime_runner_1.runSecureRuntimeDiscovery)((0, secure_runtime_runner_1.parseSecureRuntimeRunnerArgs)([
            "--app", "generic-app",
            "--case-id", "C123",
            "--section", "generic-section",
            "--force-rediscovery",
        ]), {
            resolveRuntimeEntries: async () => ({
                entries: (0, secure_runtime_runner_1.buildRuntimeEntriesByCase)(123, { companyIdentifier: "qa-company", username: "qa-user", password: "qa-password" })["123"] ?? [],
                requirements: [], automaticallyResolved: 3, userRuntimeRequired: [], datasetRequired: [], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [],
            }),
            tempRoot,
            jobId: "runner-test",
            prompt: async (question, options) => options?.secret ? "qa-password" : question.startsWith("RNC") ? "qa-company" : "qa-user",
            spawnChild: async (invocation) => {
                observedArgs = invocation.args;
                observedContextPath = String(invocation.env.DISCOVERY_RUNTIME_CONTEXT);
                const context = JSON.parse(await promises_1.default.readFile(observedContextPath, "utf8"));
                strict_1.default.deepEqual(context["123"]?.map((entry) => ({ key: entry.key, source: entry.source })), [
                    { key: "auth.company_identifier", source: "user_provided_qa_credentials" },
                    { key: "auth.username", source: "user_provided_qa_credentials" },
                    { key: "auth.password", source: "user_provided_qa_credentials" },
                ]);
                strict_1.default.ok(!invocation.args.join(" ").includes("qa-password"));
                return { exitCode: 0, signal: null };
            },
        });
        strict_1.default.equal(exitCode.exitCode, 0);
        strict_1.default.equal(observedArgs.includes("--overwrite"), true);
        strict_1.default.equal(observedArgs.includes("--auto-promote"), true);
        await strict_1.default.rejects(promises_1.default.access(observedContextPath));
        strict_1.default.equal((await promises_1.default.readdir(tempRoot)).length, 0);
        strict_1.default.equal(logs.some((line) => line.includes("qa-password")), false);
        strict_1.default.equal(logs.some((line) => line.includes("auth.password resolved=true source=user_provided_qa_credentials sensitive=true")), true);
    }
    finally {
        console.log = originalLog;
        await promises_1.default.rm(tempRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("child non-zero exit is propagated and spawn failure still cleans the context", async () => {
    const tempRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "secure-runner-failure-test-"));
    const commonArgs = (0, secure_runtime_runner_1.parseSecureRuntimeRunnerArgs)(["--app", "app-a", "--case-id", "7"]);
    try {
        const failed = await (0, secure_runtime_runner_1.runSecureRuntimeDiscovery)(commonArgs, {
            resolveRuntimeEntries: async () => ({
                entries: (0, secure_runtime_runner_1.buildRuntimeEntriesByCase)(7, { companyIdentifier: "company", username: "user", password: "pw" })["7"] ?? [],
                requirements: [], automaticallyResolved: 3, userRuntimeRequired: [], datasetRequired: [], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [],
            }),
            tempRoot,
            jobId: "child-failed",
            prompt: async (question, options) => options?.secret ? "pw" : question.startsWith("RNC") ? "company" : "user",
            spawnChild: async () => ({ exitCode: 17, signal: null }),
        });
        strict_1.default.equal(failed.exitCode, 17);
        strict_1.default.equal((await promises_1.default.readdir(tempRoot)).length, 0);
        const signalled = await (0, secure_runtime_runner_1.runSecureRuntimeDiscovery)(commonArgs, {
            resolveRuntimeEntries: async () => ({
                entries: (0, secure_runtime_runner_1.buildRuntimeEntriesByCase)(7, { companyIdentifier: "company", username: "user", password: "pw" })["7"] ?? [],
                requirements: [], automaticallyResolved: 3, userRuntimeRequired: [], datasetRequired: [], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [],
            }),
            tempRoot,
            jobId: "child-signalled",
            prompt: async (question, options) => options?.secret ? "pw" : question.startsWith("RNC") ? "company" : "user",
            spawnChild: async () => ({ exitCode: 1, signal: "SIGTERM" }),
        });
        strict_1.default.equal(signalled.signal, "SIGTERM");
        strict_1.default.equal((await promises_1.default.readdir(tempRoot)).length, 0);
        const spawnFailed = await strict_1.default.rejects((0, secure_runtime_runner_1.runSecureRuntimeDiscovery)(commonArgs, {
            resolveRuntimeEntries: async () => ({
                entries: (0, secure_runtime_runner_1.buildRuntimeEntriesByCase)(7, { companyIdentifier: "company", username: "user", password: "pw" })["7"] ?? [],
                requirements: [], automaticallyResolved: 3, userRuntimeRequired: [], datasetRequired: [], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [],
            }),
            tempRoot,
            jobId: "spawn-failed",
            prompt: async (question, options) => options?.secret ? "pw" : question.startsWith("RNC") ? "company" : "user",
            spawnChild: async () => { throw new Error("spawn EINVAL"); },
        }));
        strict_1.default.equal(spawnFailed, undefined);
        strict_1.default.equal((await promises_1.default.readdir(tempRoot)).length, 0);
    }
    finally {
        await promises_1.default.rm(tempRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("runtime runner forwards an arbitrary contract without auth-specific cardinality", async () => {
    const tempRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "secure-runner-contract-test-"));
    const entries = [
        { key: "account.lookup", value: "known", source: "qa_dataset", sensitive: false, generated: false, verified: true },
        { key: "account.position", value: "Analyst", source: "auto_generated", sensitive: false, generated: true, verified: false },
        { key: "account.expected_name", value: "Known", source: "explicit_runtime_input", sensitive: false, generated: false, verified: true, valueRole: "expected_oracle", dependsOn: ["account.lookup"] },
        { key: "auth.user", value: "user", source: "explicit_runtime_input", sensitive: true, generated: false, verified: true },
        { key: "opaque.value", value: "value", source: "project_config", sensitive: false, generated: false, verified: true },
    ];
    try {
        let observed;
        await (0, secure_runtime_runner_1.runSecureRuntimeDiscovery)((0, secure_runtime_runner_1.parseSecureRuntimeRunnerArgs)(["--app", "generic-app", "--case-id", "77"]), {
            tempRoot,
            jobId: "arbitrary-contract",
            resolveRuntimeEntries: async () => ({ entries, requirements: entries, automaticallyResolved: 5, userRuntimeRequired: [], datasetRequired: ["account.lookup"], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [] }),
            spawnChild: async (invocation) => {
                const contextPath = invocation.env.DISCOVERY_RUNTIME_CONTEXT;
                observed = JSON.parse(await promises_1.default.readFile(contextPath, "utf8"));
                return { exitCode: 0, signal: null };
            },
        });
        strict_1.default.deepEqual(observed["77"].map((entry) => entry.key), entries.map((entry) => entry.key));
        strict_1.default.equal(observed["77"].find((entry) => entry.key === "account.position").generated, true);
        strict_1.default.deepEqual(observed["77"].find((entry) => entry.key === "account.expected_name").dependsOn, ["account.lookup"]);
    }
    finally {
        await promises_1.default.rm(tempRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("dataset-required classification is derived from canonical lookup structure, not a field name", () => {
    const requirements = [
        { key: "record_1.lookup_value", required: true, controlType: "text", sensitive: false, fieldCapability: { kind: "text" } },
        { key: "record_1.note", required: true, controlType: "text", sensitive: false, fieldCapability: { kind: "text" } },
    ];
    const rawCase = {
        id: 77101,
        title: "Generic entity lookup",
        custom_steps_separated: [
            { content: "En la primera fila, ingresar el valor [record_1.lookup_value] en el campo \"Lookup\"." },
            { content: "Esperar que el sistema complete automáticamente el valor [record_1.lookup_value]." },
        ],
    };
    const result = (0, secure_runtime_runner_1.deriveRuntimeRequirementMetadata)(requirements, rawCase);
    strict_1.default.equal(result.find((entry) => entry.key === "record_1.lookup_value")?.valuePolicy, "dataset_required");
    strict_1.default.notEqual(result.find((entry) => entry.key === "record_1.note")?.valuePolicy, "dataset_required");
});
(0, node_test_1.default)("missing exact oracle remains a validation blocker without blocking child execution", async () => {
    const tempRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "secure-runner-oracle-pending-test-"));
    let childStarted = false;
    try {
        const result = await (0, secure_runtime_runner_1.runSecureRuntimeDiscovery)((0, secure_runtime_runner_1.parseSecureRuntimeRunnerArgs)(["--app", "generic-app", "--case-id", "88"]), {
            tempRoot,
            jobId: "oracle-pending",
            resolveRuntimeEntries: async () => ({
                entries: [{ key: "entity_1.lookup", value: "known", source: "qa_dataset", sensitive: false, generated: false, verified: true }],
                requirements: [{
                        key: "entity_1.expected_name",
                        required: true,
                        valueRole: "expected_oracle",
                        valuePolicy: "scenario_controlled",
                        fieldCapability: { kind: "text" },
                    }],
                automaticallyResolved: 0,
                userRuntimeRequired: [],
                datasetRequired: [],
                oracleRuntimeDerived: [],
                oracleAuthorityMissing: ["entity_1.expected_name"],
                unresolved: ["entity_1.expected_name"],
                executionBlockingKeys: [],
                executionReadiness: true,
                validationReadiness: false,
            }),
            spawnChild: async () => {
                childStarted = true;
                return { exitCode: 0, signal: null };
            },
        });
        strict_1.default.equal(result.exitCode, 0);
        strict_1.default.equal(childStarted, true);
    }
    finally {
        await promises_1.default.rm(tempRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("unresolved action input blocks execution readiness", async () => {
    const tempRoot = await promises_1.default.mkdtemp(node_path_1.default.join(node_os_1.default.tmpdir(), "secure-runner-action-block-test-"));
    try {
        await strict_1.default.rejects((0, secure_runtime_runner_1.runSecureRuntimeDiscovery)((0, secure_runtime_runner_1.parseSecureRuntimeRunnerArgs)(["--app", "generic-app", "--case-id", "89"]), {
            tempRoot,
            jobId: "action-block",
            resolveRuntimeEntries: async () => ({
                entries: [],
                requirements: [{
                        key: "entity_1.position",
                        required: true,
                        valueRole: "runtime_input",
                        valuePolicy: "scenario_controlled",
                        inputRole: "scenario",
                        fieldCapability: { kind: "text" },
                    }],
                automaticallyResolved: 0,
                userRuntimeRequired: ["entity_1.position"],
                datasetRequired: [],
                oracleRuntimeDerived: [],
                oracleAuthorityMissing: [],
                unresolved: ["entity_1.position"],
                executionBlockingKeys: ["entity_1.position"],
                executionReadiness: false,
                validationReadiness: true,
            }),
            spawnChild: async () => { throw new Error("child must not start"); },
        }));
    }
    finally {
        await promises_1.default.rm(tempRoot, { recursive: true, force: true });
    }
});
(0, node_test_1.default)("secure runner accepts project-scoped selection without embedding values", () => {
    const args = (0, secure_runtime_runner_1.parseSecureRuntimeRunnerArgs)([
        "--app", "app-a",
        "--case-id", "42",
        "--testrail-project-id", "7",
        "--testrail-suite-id", "8",
        "--testrail-section-id", "9",
        "--headless",
    ]);
    strict_1.default.deepEqual(args, {
        appSlug: "app-a",
        caseId: 42,
        testRailProjectId: "7",
        testRailSuiteId: "8",
        testRailSectionId: "9",
        headed: false,
        forceRediscovery: false,
        autoPromote: true,
    });
});
