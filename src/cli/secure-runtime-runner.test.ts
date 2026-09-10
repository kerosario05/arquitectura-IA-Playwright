import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildDiscoveryChildInvocation,
  buildRuntimeEntriesByCase,
  deriveRuntimeRequirementMetadata,
  parseSecureRuntimeRunnerArgs,
  runSecureRuntimeDiscovery,
} from "./secure-runtime-runner";

test("builds a Windows npm.cmd invocation with shell enabled and separated args", () => {
  const runnerArgs = parseSecureRuntimeRunnerArgs([
    "--app", "app-a", "--case-id", "C42", "--section", "section-a", "--force-rediscovery", "--headed",
  ]);
  const env = { DISCOVERY_RUNTIME_CONTEXT: "C:\\Temp\\runtime-context.json" };
  const invocation = buildDiscoveryChildInvocation(runnerArgs, env, { platform: "win32", cwd: "C:\\workspace" });
  assert.equal(invocation.command, "npm.cmd");
  assert.equal(invocation.shell, true);
  assert.equal(invocation.cwd, "C:\\workspace");
  assert.equal(invocation.stdio, "inherit");
  assert.equal(invocation.env.DISCOVERY_RUNTIME_CONTEXT, env.DISCOVERY_RUNTIME_CONTEXT);
  assert.equal(invocation.args.includes("--overwrite"), true);
  assert.equal(invocation.args.includes("--headed"), true);
  assert.equal(invocation.args.some((value) => value === undefined || value === null), false);
  assert.deepEqual(invocation.args.slice(0, 4), ["run", "discovery:case", "--", "--case-id"]);
});

test("builds a non-Windows npm invocation without shell", () => {
  const runnerArgs = parseSecureRuntimeRunnerArgs(["--app", "app-b", "--case-id", "9", "--headless"]);
  const invocation = buildDiscoveryChildInvocation(runnerArgs, { DISCOVERY_RUNTIME_CONTEXT: "/tmp/context.json" }, { platform: "linux" });
  assert.equal(invocation.command, "npm");
  assert.equal(invocation.shell, false);
  assert.equal(invocation.args.includes("--headed"), false);
});

test("secure runner builds case-scoped runtimeEntriesByCase with canonical auth keys", () => {
  const result = buildRuntimeEntriesByCase(123, {
    companyIdentifier: "qa-company",
    username: "qa-user",
    password: "qa-password",
  });

  assert.deepEqual(result["123"]?.map((entry) => ({
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

test("secure runner prompts through injected input, forwards context reference, and cleans up", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "secure-runner-test-"));
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  let observedContextPath = "";
  let observedArgs: string[] = [];

  try {
    const exitCode = await runSecureRuntimeDiscovery(
      parseSecureRuntimeRunnerArgs([
        "--app", "generic-app",
        "--case-id", "C123",
        "--section", "generic-section",
        "--force-rediscovery",
      ]),
      {
        resolveRuntimeEntries: async () => ({
          entries: buildRuntimeEntriesByCase(123, { companyIdentifier: "qa-company", username: "qa-user", password: "qa-password" })["123"] ?? [],
          requirements: [], automaticallyResolved: 3, userRuntimeRequired: [], datasetRequired: [], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [],
        }),
        tempRoot,
        jobId: "runner-test",
        prompt: async (question, options) => options?.secret ? "qa-password" : question.startsWith("RNC") ? "qa-company" : "qa-user",
        spawnChild: async (invocation) => {
          observedArgs = invocation.args;
          observedContextPath = String(invocation.env.DISCOVERY_RUNTIME_CONTEXT);
          const context = JSON.parse(await fs.readFile(observedContextPath, "utf8")) as Record<string, Array<{ key: string; source: string; value: string }> >;
          assert.deepEqual(context["123"]?.map((entry) => ({ key: entry.key, source: entry.source })), [
            { key: "auth.company_identifier", source: "user_provided_qa_credentials" },
            { key: "auth.username", source: "user_provided_qa_credentials" },
            { key: "auth.password", source: "user_provided_qa_credentials" },
          ]);
          assert.ok(!invocation.args.join(" ").includes("qa-password"));
          return { exitCode: 0, signal: null };
        },
      },
    );

    assert.equal(exitCode.exitCode, 0);
    assert.equal(observedArgs.includes("--overwrite"), true);
    assert.equal(observedArgs.includes("--auto-promote"), true);
    await assert.rejects(fs.access(observedContextPath));
    assert.equal((await fs.readdir(tempRoot)).length, 0);
    assert.equal(logs.some((line) => line.includes("qa-password")), false);
    assert.equal(logs.some((line) => line.includes("auth.password resolved=true source=user_provided_qa_credentials sensitive=true")), true);
  } finally {
    console.log = originalLog;
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("child non-zero exit is propagated and spawn failure still cleans the context", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "secure-runner-failure-test-"));
  const commonArgs = parseSecureRuntimeRunnerArgs(["--app", "app-a", "--case-id", "7"]);
  try {
    const failed = await runSecureRuntimeDiscovery(commonArgs, {
      resolveRuntimeEntries: async () => ({
        entries: buildRuntimeEntriesByCase(7, { companyIdentifier: "company", username: "user", password: "pw" })["7"] ?? [],
        requirements: [], automaticallyResolved: 3, userRuntimeRequired: [], datasetRequired: [], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [],
      }),
      tempRoot,
      jobId: "child-failed",
      prompt: async (question, options) => options?.secret ? "pw" : question.startsWith("RNC") ? "company" : "user",
      spawnChild: async () => ({ exitCode: 17, signal: null }),
    });
    assert.equal(failed.exitCode, 17);
    assert.equal((await fs.readdir(tempRoot)).length, 0);

    const signalled = await runSecureRuntimeDiscovery(commonArgs, {
      resolveRuntimeEntries: async () => ({
        entries: buildRuntimeEntriesByCase(7, { companyIdentifier: "company", username: "user", password: "pw" })["7"] ?? [],
        requirements: [], automaticallyResolved: 3, userRuntimeRequired: [], datasetRequired: [], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [],
      }),
      tempRoot,
      jobId: "child-signalled",
      prompt: async (question, options) => options?.secret ? "pw" : question.startsWith("RNC") ? "company" : "user",
      spawnChild: async () => ({ exitCode: 1, signal: "SIGTERM" }),
    });
    assert.equal(signalled.signal, "SIGTERM");
    assert.equal((await fs.readdir(tempRoot)).length, 0);

    const spawnFailed = await assert.rejects(runSecureRuntimeDiscovery(commonArgs, {
      resolveRuntimeEntries: async () => ({
        entries: buildRuntimeEntriesByCase(7, { companyIdentifier: "company", username: "user", password: "pw" })["7"] ?? [],
        requirements: [], automaticallyResolved: 3, userRuntimeRequired: [], datasetRequired: [], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [],
      }),
      tempRoot,
      jobId: "spawn-failed",
      prompt: async (question, options) => options?.secret ? "pw" : question.startsWith("RNC") ? "company" : "user",
      spawnChild: async () => { throw new Error("spawn EINVAL"); },
    }));
    assert.equal(spawnFailed, undefined);
    assert.equal((await fs.readdir(tempRoot)).length, 0);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("runtime runner forwards an arbitrary contract without auth-specific cardinality", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "secure-runner-contract-test-"));
  const entries = [
    { key: "account.lookup", value: "known", source: "qa_dataset", sensitive: false, generated: false, verified: true },
    { key: "account.position", value: "Analyst", source: "auto_generated", sensitive: false, generated: true, verified: false },
    { key: "account.expected_name", value: "Known", source: "explicit_runtime_input", sensitive: false, generated: false, verified: true, valueRole: "expected_oracle", dependsOn: ["account.lookup"] },
    { key: "auth.user", value: "user", source: "explicit_runtime_input", sensitive: true, generated: false, verified: true },
    { key: "opaque.value", value: "value", source: "project_config", sensitive: false, generated: false, verified: true },
  ] as any;
  try {
    let observed: any;
    await runSecureRuntimeDiscovery(parseSecureRuntimeRunnerArgs(["--app", "generic-app", "--case-id", "77"]), {
      tempRoot,
      jobId: "arbitrary-contract",
      resolveRuntimeEntries: async () => ({ entries, requirements: entries, automaticallyResolved: 5, userRuntimeRequired: [], datasetRequired: ["account.lookup"], oracleRuntimeDerived: [], oracleAuthorityMissing: [], unresolved: [] }),
      spawnChild: async (invocation) => {
        const contextPath = invocation.env.DISCOVERY_RUNTIME_CONTEXT!;
        observed = JSON.parse(await fs.readFile(contextPath, "utf8"));
        return { exitCode: 0, signal: null };
      },
    });
    assert.deepEqual(observed["77"].map((entry: any) => entry.key), entries.map((entry: any) => entry.key));
    assert.equal(observed["77"].find((entry: any) => entry.key === "account.position").generated, true);
    assert.deepEqual(observed["77"].find((entry: any) => entry.key === "account.expected_name").dependsOn, ["account.lookup"]);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("dataset-required classification is derived from canonical lookup structure, not a field name", () => {
  const requirements = [
    { key: "record_1.lookup_value", required: true, controlType: "text", sensitive: false, fieldCapability: { kind: "text" } },
    { key: "record_1.note", required: true, controlType: "text", sensitive: false, fieldCapability: { kind: "text" } },
  ] as any;
  const rawCase = {
    id: 77101,
    title: "Generic entity lookup",
    custom_steps_separated: [
      { content: "En la primera fila, ingresar el valor [record_1.lookup_value] en el campo \"Lookup\"." },
      { content: "Esperar que el sistema complete automáticamente el valor [record_1.lookup_value]." },
    ],
  } as any;
  const result = deriveRuntimeRequirementMetadata(requirements, rawCase);
  assert.equal(result.find((entry) => entry.key === "record_1.lookup_value")?.valuePolicy, "dataset_required");
  assert.notEqual(result.find((entry) => entry.key === "record_1.note")?.valuePolicy, "dataset_required");
});

test("missing exact oracle remains a validation blocker without blocking child execution", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "secure-runner-oracle-pending-test-"));
  let childStarted = false;
  try {
    const result = await runSecureRuntimeDiscovery(parseSecureRuntimeRunnerArgs(["--app", "generic-app", "--case-id", "88"]), {
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
        }] as any,
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
    assert.equal(result.exitCode, 0);
    assert.equal(childStarted, true);
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("unresolved action input blocks execution readiness", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "secure-runner-action-block-test-"));
  try {
    await assert.rejects(runSecureRuntimeDiscovery(parseSecureRuntimeRunnerArgs(["--app", "generic-app", "--case-id", "89"]), {
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
        }] as any,
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
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("secure runner accepts project-scoped selection without embedding values", () => {
  const args = parseSecureRuntimeRunnerArgs([
    "--app", "app-a",
    "--case-id", "42",
    "--testrail-project-id", "7",
    "--testrail-suite-id", "8",
    "--testrail-section-id", "9",
    "--headless",
  ]);
  assert.deepEqual(args, {
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
