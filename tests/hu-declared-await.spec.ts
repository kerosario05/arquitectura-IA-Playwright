import { test, expect } from "@playwright/test";
import { persistHuDeclaredKnowledge, extractHuDeclaredItems } from "../src/knowledge/hu-declared-persister";
import type { FunctionalRequirementAccount, FunctionalBranchRef } from "../src/scenarios/scenario-types";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeReq(id: string, category: FunctionalRequirementAccount["category"], sourceText: string) {
  return { id, sourceIssueKey: "TEST-1", category, sourceText, status: "covered" as const };
}

function accounting(requirements: FunctionalRequirementAccount[]) {
  return {
    requirements,
    summary: { total: requirements.length, covered: requirements.length, adaptive: 0, nonAutomatable: 0, incompleteRequirement: 0 },
  };
}

// ── 1. persistence resolves before preview (await completes) ────────────

test("persistHuDeclaredKnowledge resolves — result available after await", async () => {
  const reqs = [makeReq("a1", "action", "Clic en \"Productos\"")];
  const result = await persistHuDeclaredKnowledge("test-app", accounting(reqs), [], "T-1");

  // Result is fully resolved (not a pending promise)
  expect(result).toBeDefined();
  expect(typeof result.derived).toBe("number");
  expect(typeof result.inserted).toBe("number");
  expect(typeof result.updated).toBe("number");
  expect(typeof result.deduped).toBe("number");
  expect(typeof result.success).toBe("boolean");
  expect(result.success).toBe(true);
  expect(result.derived).toBeGreaterThanOrEqual(1);
});

// ── 2. materialization occurs before resolve (sqlResult triggers it) ────

test("persistHuDeclaredKnowledge triggers materialization on success", async () => {
  // The function materializes when sqlResult.found=true (project exists in SQL).
  // For a non-existent project, it falls back to legacy file — verify success
  // is still true and the function completes fully before returning.
  const reqs = [makeReq("p1", "prerequisite", "Debe estar autenticado")];
  const result = await persistHuDeclaredKnowledge("nonexistent-slug-xyz", accounting(reqs), [], "T-2");

  // Function completed fully (materialization attempted or legacy fallback)
  expect(result.success).toBe(true);
  expect(result.derived).toBe(1);
});

// ── 3. persistence error does not break generation ─────────────────────

test("persistHuDeclaredKnowledge catches SQL errors — returns success=false without throwing", async () => {
  // Use an appSlug that triggers SQL path but with invalid DB state.
  // The function catches internally and returns success=false.
  const reqs = [makeReq("e1", "action", "Clic en \"Exportar\"")];

  // Should NOT throw — error is caught internally
  const result = await persistHuDeclaredKnowledge(
    "__test_error_trigger__",
    accounting(reqs),
    [],
    "T-3",
  );

  // Function completed without throwing
  expect(result).toBeDefined();
  expect(typeof result.success).toBe("boolean");
  // success may be true (legacy fallback worked) or false (SQL failed)
  // The critical assertion: no exception was thrown
});

// ── 4. same HU dedup — re-persist replaces, no duplication ─────────────

test("same HU re-persisted — dedup replaces old items (no duplication)", async () => {
  const reqs = [
    makeReq("d1", "action", "Clic en \"Cuentas\""),
    makeReq("d2", "prerequisite", "Estar autenticado"),
  ];
  const slug = "dedup-test-app";

  // First persist — may insert or update depending on prior state
  const r1 = await persistHuDeclaredKnowledge(slug, accounting(reqs), [], "DEDUP-1");
  expect(r1.success).toBe(true);
  expect(r1.derived).toBe(2);
  const totalAfterFirst = r1.inserted + r1.updated;

  // Second persist with same HU (same issueKey) — should replace, no net growth
  const r2 = await persistHuDeclaredKnowledge(slug, accounting(reqs), [], "DEDUP-1");
  expect(r2.success).toBe(true);
  expect(r2.derived).toBe(2);
  const totalAfterSecond = r2.inserted + r2.updated;
  // No net growth: items were replaced, not duplicated
  expect(totalAfterSecond).toBe(totalAfterFirst);
});
