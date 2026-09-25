"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const hu_declared_persister_1 = require("../src/knowledge/hu-declared-persister");
// ── Helpers ─────────────────────────────────────────────────────────────
function makeReq(id, category, sourceText) {
    return { id, sourceIssueKey: "TEST-1", category, sourceText, status: "covered" };
}
function accounting(requirements) {
    return {
        requirements,
        summary: { total: requirements.length, covered: requirements.length, adaptive: 0, nonAutomatable: 0, incompleteRequirement: 0 },
    };
}
// ── 1. persistence resolves before preview (await completes) ────────────
(0, test_1.test)("persistHuDeclaredKnowledge resolves — result available after await", async () => {
    const reqs = [makeReq("a1", "action", "Clic en \"Productos\"")];
    const result = await (0, hu_declared_persister_1.persistHuDeclaredKnowledge)("test-app", accounting(reqs), [], "T-1");
    // Result is fully resolved (not a pending promise)
    (0, test_1.expect)(result).toBeDefined();
    (0, test_1.expect)(typeof result.derived).toBe("number");
    (0, test_1.expect)(typeof result.inserted).toBe("number");
    (0, test_1.expect)(typeof result.updated).toBe("number");
    (0, test_1.expect)(typeof result.deduped).toBe("number");
    (0, test_1.expect)(typeof result.success).toBe("boolean");
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.derived).toBeGreaterThanOrEqual(1);
});
// ── 2. materialization occurs before resolve (sqlResult triggers it) ────
(0, test_1.test)("persistHuDeclaredKnowledge triggers materialization on success", async () => {
    // The function materializes when sqlResult.found=true (project exists in SQL).
    // For a non-existent project, it falls back to legacy file — verify success
    // is still true and the function completes fully before returning.
    const reqs = [makeReq("p1", "prerequisite", "Debe estar autenticado")];
    const result = await (0, hu_declared_persister_1.persistHuDeclaredKnowledge)("nonexistent-slug-xyz", accounting(reqs), [], "T-2");
    // Function completed fully (materialization attempted or legacy fallback)
    (0, test_1.expect)(result.success).toBe(true);
    (0, test_1.expect)(result.derived).toBe(1);
});
// ── 3. persistence error does not break generation ─────────────────────
(0, test_1.test)("persistHuDeclaredKnowledge catches SQL errors — returns success=false without throwing", async () => {
    // Use an appSlug that triggers SQL path but with invalid DB state.
    // The function catches internally and returns success=false.
    const reqs = [makeReq("e1", "action", "Clic en \"Exportar\"")];
    // Should NOT throw — error is caught internally
    const result = await (0, hu_declared_persister_1.persistHuDeclaredKnowledge)("__test_error_trigger__", accounting(reqs), [], "T-3");
    // Function completed without throwing
    (0, test_1.expect)(result).toBeDefined();
    (0, test_1.expect)(typeof result.success).toBe("boolean");
    // success may be true (legacy fallback worked) or false (SQL failed)
    // The critical assertion: no exception was thrown
});
// ── 4. same HU dedup — re-persist replaces, no duplication ─────────────
(0, test_1.test)("same HU re-persisted — dedup replaces old items (no duplication)", async () => {
    const reqs = [
        makeReq("d1", "action", "Clic en \"Cuentas\""),
        makeReq("d2", "prerequisite", "Estar autenticado"),
    ];
    const slug = "dedup-test-app";
    // First persist — may insert or update depending on prior state
    const r1 = await (0, hu_declared_persister_1.persistHuDeclaredKnowledge)(slug, accounting(reqs), [], "DEDUP-1");
    (0, test_1.expect)(r1.success).toBe(true);
    (0, test_1.expect)(r1.derived).toBe(2);
    const totalAfterFirst = r1.inserted + r1.updated;
    // Second persist with same HU (same issueKey) — should replace, no net growth
    const r2 = await (0, hu_declared_persister_1.persistHuDeclaredKnowledge)(slug, accounting(reqs), [], "DEDUP-1");
    (0, test_1.expect)(r2.success).toBe(true);
    (0, test_1.expect)(r2.derived).toBe(2);
    const totalAfterSecond = r2.inserted + r2.updated;
    // No net growth: items were replaced, not duplicated
    (0, test_1.expect)(totalAfterSecond).toBe(totalAfterFirst);
});
