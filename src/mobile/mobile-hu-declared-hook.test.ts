import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

function test(label: string, fn: () => void | Promise<void>): void {
  Promise.resolve()
    .then(fn)
    .then(() => console.log(`  PASS  ${label}`))
    .catch((err) => {
      console.error(`  FAIL  ${label}: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    });
}

function describe(name: string, fn: () => void): void {
  console.log(`\n${name}`);
  fn();
}

// ── Setup temp project directory ──────────────────────────────────────────
const tmpRoot = path.join(os.tmpdir(), `mobile-hu-declared-test-${Date.now()}`);
const testAppSlug = "test-mobile";
const testAppDir = path.join(tmpRoot, "automations", "apps", testAppSlug);

function setupProject() {
  fs.mkdirSync(testAppDir, { recursive: true });
  fs.writeFileSync(
    path.join(testAppDir, "app.knowledge.json"),
    JSON.stringify({ version: 1, appSlug: testAppSlug, items: [] }),
    "utf-8",
  );
}

const originalCwd = process.cwd;

describe("Mobile hu_declared persistence via shared persister", () => {
  setupProject();
  process.cwd = () => tmpRoot;

  test("TEST 1 — first run creates hu_declared items in app.knowledge.json", async () => {
    const { buildRequirementAccounting } = await import("../../src/scenarios/scenario-functional-quality");
    const { persistHuDeclaredKnowledge } = await import("../../src/knowledge/hu-declared-persister");

    const huText = "El usuario debe poder iniciar sesion con credenciales validas";
    const requirementAccounting = buildRequirementAccounting([], [], huText, "MOB-TEST");

    const result = await persistHuDeclaredKnowledge(testAppSlug, requirementAccounting, [], "MOB-TEST");

    assert.ok(result.derived > 0, "must derive at least 1 item");
    assert.ok(result.inserted > 0, "must insert at least 1 item");
    assert.strictEqual(result.success, true, "must succeed");

    // Verify items in app.knowledge.json
    const raw = JSON.parse(fs.readFileSync(path.join(testAppDir, "app.knowledge.json"), "utf-8"));
    const items = raw.items ?? [];
    const huItems = items.filter((i: any) => i.source === "hu_declared" && i.sourceIssueKey === "MOB-TEST");
    assert.ok(huItems.length > 0, "must have hu_declared items for MOB-TEST");

    const firstItem = huItems[0];
    assert.strictEqual(firstItem.source, "hu_declared", "source must be hu_declared");
    assert.strictEqual(firstItem.validationStatus, "pending", "validationStatus must be pending");
    assert.strictEqual(firstItem.trustedForReuse, false, "trustedForReuse must be false");
    assert.strictEqual(firstItem.executionBacked, false, "executionBacked must be false");
  });

  test("TEST 2 — second run same HU does not duplicate items", async () => {
    const { buildRequirementAccounting } = await import("../../src/scenarios/scenario-functional-quality");
    const { persistHuDeclaredKnowledge } = await import("../../src/knowledge/hu-declared-persister");

    const huText = "El usuario debe poder iniciar sesion con credenciales validas";
    const requirementAccounting = buildRequirementAccounting([], [], huText, "MOB-TEST");

    const beforeRaw = JSON.parse(fs.readFileSync(path.join(testAppDir, "app.knowledge.json"), "utf-8"));
    const beforeCount = beforeRaw.items.length;

    const result = await persistHuDeclaredKnowledge(testAppSlug, requirementAccounting, [], "MOB-TEST");

    const afterRaw = JSON.parse(fs.readFileSync(path.join(testAppDir, "app.knowledge.json"), "utf-8"));
    const afterCount = afterRaw.items.length;

    assert.strictEqual(afterCount, beforeCount, "item count must not increase on duplicate run");
    assert.ok(result.deduped > 0 || result.updated > 0, "must dedup or update existing items");
  });

  test("TEST 3 — items are readable by loadMobileKnowledge (app.knowledge.json)", async () => {
    const { loadMobileKnowledge } = await import("../../src/mobile/mobile-knowledge-resolver");

    const knowledge = loadMobileKnowledge(testAppSlug);
    const huItems = knowledge.items.filter((i: any) => i.source === "hu_declared");
    assert.ok(huItems.length > 0, "loadMobileKnowledge must see hu_declared items from app.knowledge.json");
  });
});

// Cleanup
try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
process.cwd = originalCwd;

console.log("\nAll tests completed.");
