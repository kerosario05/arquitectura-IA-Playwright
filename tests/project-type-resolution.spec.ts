import test from "node:test";
import assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

// Helper: write a temporary knowledge file to trigger the file-based fallback
function writeTempKnowledge(slug: string, items: unknown[]): string {
  const dir = path.join(process.cwd(), "automations", "apps", slug);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, "app.knowledge.json");
  fs.writeFileSync(filePath, JSON.stringify({ items }), "utf-8");
  return filePath;
}

function removeTempKnowledge(slug: string): void {
  const dir = path.join(process.cwd(), "automations", "apps", slug);
  const filePath = path.join(dir, "app.knowledge.json");
  try { fs.unlinkSync(filePath); } catch { /* ignore */ }
  try { fs.rmdirSync(dir); } catch { /* ignore */ }
}

async function loadKnowledge(slug: string) {
  const mod = await import("../src/knowledge/route-profile-deriver");
  return mod.loadRouteKnowledge(slug);
}

// TEST 1: Web project without routeProfile in knowledge → projectType stays from SQL
// When SQL is unavailable and no file exists, fallback returns 0 (unknown), NOT mobile
test("TEST 1 — web project without routeProfile: projectType=unknown fallback, not mobile", async () => {
  const slug = `test-web-noroute-${Date.now()}`;
  const result = await loadKnowledge(slug);
  assert.strictEqual(result.projectType, 0,
    "fallback without SQL or file must return projectType=0 (unknown), not mobile (2)");
  assert.deepStrictEqual(result.items, [],
    "no knowledge items when no SQL config and no file");
});

// TEST 2: Mobile project type preserved from SQL
// When SQL returns projectType=2, the value flows through correctly
// Without SQL, fallback returns 0 (unknown), NOT 2 (mobile)
test("TEST 2 — mobile project: fallback does NOT default to mobile (2)", async () => {
  const slug = `test-mobile-${Date.now()}`;
  const result = await loadKnowledge(slug);
  assert.notStrictEqual(result.projectType, 2,
    "fallback without SQL must NOT return mobile (2) by default");
});

// TEST 3: Existing project without resolvable type → projectType=unknown (0)
test("TEST 3 — unresolvable type: projectType=unknown (0), never mobile", async () => {
  const slug = `test-unknown-${Date.now()}`;
  const result = await loadKnowledge(slug);
  assert.strictEqual(result.projectType, 0,
    "unresolvable type must be 0 (unknown), NOT 2 (mobile)");
});

// TEST 4: Absence of routeProfile does not change projectType
// projectType and routeProfile are independent dimensions
test("TEST 4 — routeProfile independence: projectType unchanged by routeProfile absence", async () => {
  const slug = `test-independence-${Date.now()}`;
  const filePath = writeTempKnowledge(slug, [
    { knowledgeKind: "functional_requirement", screenKey: "home" },
  ]);
  try {
    const result = await loadKnowledge(slug);
    assert.strictEqual(result.projectType, 0,
      "file-based fallback returns unknown (0), not mobile");
    assert.strictEqual(result.items.length, 1,
      "knowledge items loaded from file");
    assert.notStrictEqual(result.projectType, 2,
      "projectType must NOT become mobile just because routeProfile is absent");
  } finally {
    removeTempKnowledge(slug);
  }
});
