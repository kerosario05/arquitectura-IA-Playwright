import assert from "node:assert";
import fs from "node:fs";
import {
  buildDiscoveryBatchArgs,
  buildDiscoveryChildEnv,
  buildRuntimeContextPath,
  deleteRuntimeContextIfExists,
  normalizeRuntimeEntry,
  writeRuntimeContextIfPresent,
} from "./discovery-batch-runner";

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

describe("discovery runtime context transport (runner)", () => {
  test("writeRuntimeContextIfPresent persists caseId -> entries and returns the path", () => {
    const jobId = "rt-runner-1";
    const params = {
      caseIds: [100, 200],
      runtimeEntriesByCase: {
        "100": [{ key: "auth.username", value: "runtime-user", source: "fixture", sensitive: false }],
        "200": [{ key: "employee.document", value: "DOC-1", source: "fixture", sensitive: true }],
      },
    } as any;
    const target = writeRuntimeContextIfPresent(jobId, params);
    assert.ok(target);
    const parsed = JSON.parse(fs.readFileSync(target!, "utf-8"));
    assert.strictEqual(parsed["100"][0].key, "auth.username");
    assert.strictEqual(parsed["100"][0].value, "runtime-user");
    assert.strictEqual(parsed["200"][0].value, "DOC-1");
  });

  test("normalizes UI manual runtime entries by semantic key, never by value", () => {
    assert.strictEqual(
      normalizeRuntimeEntry({ key: "auth.username", value: "runtime-user", source: "manual_runtime" as any, sensitive: true }).source,
      "user_provided_qa_credentials",
    );
    assert.strictEqual(
      normalizeRuntimeEntry({ key: "employee.document", value: "DOC-1", source: "manual_runtime" as any, sensitive: true }).source,
      "explicit_runtime_input",
    );
    assert.strictEqual(
      normalizeRuntimeEntry({ key: "employee.document", value: "DOC-1", source: "fixture", sensitive: true }).source,
      "fixture",
    );
  });

  test("writeRuntimeContextIfPresent returns undefined without runtimeEntriesByCase", () => {
    const target = writeRuntimeContextIfPresent("rt-runner-2", { caseIds: [100] } as any);
    assert.strictEqual(target, undefined);
  });

  test("deleteRuntimeContextIfExists removes the file and is idempotent on ENOENT", async () => {
    const jobId = "rt-runner-3";
    writeRuntimeContextIfPresent(jobId, {
      caseIds: [100],
      runtimeEntriesByCase: { "100": [{ key: "a", value: "b", source: "fixture", sensitive: false }] },
    } as any);
    const target = buildRuntimeContextPath(jobId);
    assert.ok(fs.existsSync(target));
    await deleteRuntimeContextIfExists(jobId);
    assert.ok(!fs.existsSync(target));
    await deleteRuntimeContextIfExists(jobId);
  });

  test("buildDiscoveryChildEnv only adds DISCOVERY_RUNTIME_CONTEXT when a path is present", () => {
    const base = { APP_SLUG: "app-a" } as NodeJS.ProcessEnv;
    assert.strictEqual(buildDiscoveryChildEnv(base, "/tmp/ctx.json").DISCOVERY_RUNTIME_CONTEXT, "/tmp/ctx.json");
    assert.strictEqual(buildDiscoveryChildEnv(base, undefined).DISCOVERY_RUNTIME_CONTEXT, undefined);
  });

  test("discovery args never include runtime values", () => {
    const args = buildDiscoveryBatchArgs({ caseIds: [100], appSlug: "app-a" }, [100]);
    assert.ok(!args.some((a) => a.includes("runtime-user") || a.includes("DOC-1")));
  });

  test("discovery args carry explicit TestRail launch identity", () => {
    const args = buildDiscoveryBatchArgs({
      caseIds: [44757],
      appSlug: "app-a",
      testRailProjectId: 30,
      testRailSuiteId: 37,
      testRailSectionId: 5794,
    } as any, [44757]);
    assert.deepStrictEqual(args.slice(-6), [
      "--testrail-project-id", "30",
      "--testrail-suite-id", "37",
      "--testrail-section-id", "5794",
    ]);
  });
});
