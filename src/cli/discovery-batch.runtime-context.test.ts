import assert from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRuntimeContextFromPath, parseBatchArgs, resolveRuntimeEntriesForCase, resolveTestRailSelectionIds } from "./discovery-batch";

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

describe("discovery runtime context CLI", () => {
  test("resolveRuntimeEntriesForCase returns only the entries for the requested caseId", () => {
    const context = {
      "100": [{ key: "auth.username", value: "runtime-user", source: "fixture", sensitive: false }],
      "200": [{ key: "employee.document", value: "DOC-1", source: "fixture", sensitive: true }],
    };
    const for100 = resolveRuntimeEntriesForCase(context, 100)!;
    const for200 = resolveRuntimeEntriesForCase(context, 200)!;
    assert.strictEqual(for100.length, 1);
    assert.strictEqual(for100[0].key, "auth.username");
    assert.strictEqual(for100[0].value, "runtime-user");
    assert.strictEqual(for200.length, 1);
    assert.strictEqual(for200[0].key, "employee.document");
  });

  test("resolveRuntimeEntriesForCase returns undefined without context or entries for the case", () => {
    assert.strictEqual(resolveRuntimeEntriesForCase(undefined, 100), undefined);
    assert.strictEqual(resolveRuntimeEntriesForCase({ "100": [] }, 100), undefined);
    assert.strictEqual(
      resolveRuntimeEntriesForCase({ "100": [{ key: "a", value: "b", source: "fixture", sensitive: false }] }, 999),
      undefined,
    );
  });

  test("loadRuntimeContextFromPath parses the file and tolerates missing env path", async () => {
    const context = { "100": [{ key: "a", value: "b", source: "fixture", sensitive: false }] };
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "rt-ctx-"));
    const file = path.join(dir, "ctx.json");
    await fs.writeFile(file, JSON.stringify(context), "utf-8");
    assert.strictEqual(JSON.stringify(await loadRuntimeContextFromPath(file)), JSON.stringify(context));
    assert.strictEqual(await loadRuntimeContextFromPath(undefined), undefined);
    assert.strictEqual(await loadRuntimeContextFromPath(path.join(dir, "missing.json")), undefined);
  });

  test("explicit TestRail CLI identity overrides config fallback", () => {
    const args = parseBatchArgs([
      "--case-ids", "44757",
      "--testrail-project-id", "30",
      "--testrail-suite-id", "37",
      "--testrail-section-id", "5794",
    ]);
    assert.deepStrictEqual(resolveTestRailSelectionIds(args), { projectId: "30", suiteId: "37", sectionId: "5794" });
  });

  test("without explicit TestRail identity, config fallback remains selected", () => {
    const args = parseBatchArgs(["--case-ids", "44757"]);
    const ids = resolveTestRailSelectionIds(args);
    assert.ok(ids.projectId);
    assert.ok(ids.suiteId);
    assert.ok(ids.sectionId);
  });
});
