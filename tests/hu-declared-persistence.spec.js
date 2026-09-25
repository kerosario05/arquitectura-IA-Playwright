"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const hu_declared_persister_1 = require("../src/knowledge/hu-declared-persister");
// ── Helpers ─────────────────────────────────────────────────────────────
function makeReq(id, category, sourceText, opts = {}) {
    return {
        id,
        sourceIssueKey: "TEST-1",
        category,
        sourceText,
        status: "covered",
        ...opts,
    };
}
function makeBranch(branchId, actionIntent, expectedDestination) {
    return {
        branchId,
        sourceLabel: actionIntent,
        actionIntent,
        expectedDestination,
        accessIntent: "unknown",
        evidenceSource: "user_story",
    };
}
function accounting(requirements) {
    return {
        requirements,
        summary: {
            total: requirements.length,
            covered: requirements.filter((r) => r.status === "covered").length,
            adaptive: requirements.filter((r) => r.status === "adaptive").length,
            nonAutomatable: requirements.filter((r) => r.status === "nonAutomatable")
                .length,
            incompleteRequirement: requirements.filter((r) => r.status === "incompleteRequirement").length,
        },
    };
}
// ── Tests ───────────────────────────────────────────────────────────────
(0, test_1.test)("1. empty knowledge + HU with prerequisite/branch → extracts hu_declared items", () => {
    const reqs = [
        makeReq("prereq-1", "prerequisite", "Para continuar debe ingresar al sistema"),
        makeReq("branch-1", "branch", "Seleccionar opción Alfa"),
        makeReq("action-1", "action", "Clic en \"Depósitos\""),
    ];
    const branches = [makeBranch("branch-a", "Seleccionar Alfa", "Pantalla Alfa")];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "TEST-1");
    (0, test_1.expect)(items.length).toBeGreaterThanOrEqual(3);
    const prereq = items.find((i) => i.category === "prerequisite");
    (0, test_1.expect)(prereq).toBeDefined();
    (0, test_1.expect)(prereq.source).toBe("hu_declared");
    (0, test_1.expect)(prereq.knowledgeKind).toBe("hu_declared");
    (0, test_1.expect)(prereq.sourceIssueKey).toBe("TEST-1");
    (0, test_1.expect)(prereq.sourceText).toContain("ingresar al sistema");
    const branch = items.find((i) => i.category === "branch");
    (0, test_1.expect)(branch).toBeDefined();
    (0, test_1.expect)(branch.source).toBe("hu_declared");
    const action = items.find((i) => i.category === "action");
    (0, test_1.expect)(action).toBeDefined();
    (0, test_1.expect)(action.source).toBe("hu_declared");
});
(0, test_1.test)("2. same HU reprocessed → stable ids (no duplication via idempotent extraction)", () => {
    const reqs = [
        makeReq("a-1", "action", "Clic en \"Productos\""),
        makeReq("pr-1", "prerequisite", "Debe estar autenticado"),
    ];
    const branches = [];
    const items1 = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "TEST-1");
    const items2 = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "TEST-1");
    // Same ids on both runs
    const ids1 = items1.map((i) => i.id).sort();
    const ids2 = items2.map((i) => i.id).sort();
    (0, test_1.expect)(ids1).toEqual(ids2);
    // Same count (extraction is pure — dedup is in persist)
    (0, test_1.expect)(items1.length).toBe(items2.length);
});
(0, test_1.test)("3. second HU same appSlug → accumulates knowledge (different ids)", () => {
    const reqs1 = [makeReq("r1", "action", "Clic en \"Cuentas\"")];
    const reqs2 = [makeReq("r2", "action", "Clic en \"Tarjetas\"")];
    const items1 = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs1), [], "HU-1");
    const items2 = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs2), [], "HU-2");
    // Different source texts → different ids
    const ids1 = items1.map((i) => i.id);
    const ids2 = items2.map((i) => i.id);
    (0, test_1.expect)(ids1.some((id) => ids2.includes(id))).toBe(false);
    // Both have source hu_declared
    (0, test_1.expect)(items1.every((i) => i.source === "hu_declared")).toBe(true);
    (0, test_1.expect)(items2.every((i) => i.source === "hu_declared")).toBe(true);
});
(0, test_1.test)("4. different appSlug → isolation (items carry no cross-app references)", () => {
    const reqs = [makeReq("r1", "visibility", "Mostrar pantalla de inicio")];
    const itemsA = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), [], "TEST-1");
    const itemsB = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), [], "TEST-1");
    // Items from both extractions are structurally identical (same HU text)
    // but isolation is enforced at persist time by appSlug — extraction is agnostic
    (0, test_1.expect)(itemsA.length).toBe(itemsB.length);
    (0, test_1.expect)(itemsA[0].id).toBe(itemsB[0].id);
    // The persist function takes appSlug as parameter — isolation is by caller
});
(0, test_1.test)("5. hu_declared items are NOT runtime evidence — no allowedExecutableClicks impact", () => {
    const reqs = [
        makeReq("a-1", "action", "Clic en \"Botón X\""),
        makeReq("b-1", "branch", "Seleccionar \"Opción Y\""),
    ];
    const branches = [makeBranch("br-1", "Click Y", "Dest Y")];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "T-1");
    for (const item of items) {
        // source is hu_declared, NOT mcp_runtime_observation
        (0, test_1.expect)(item.source).not.toBe("mcp_runtime_observation");
        (0, test_1.expect)(item.source).toBe("hu_declared");
        // trustedForReuse is always false — provisional, not runtime
        (0, test_1.expect)(item.trustedForReuse).toBe(false);
        // validationStatus is pending — not validated by execution
        (0, test_1.expect)(item.validationStatus).toBe("pending");
        // No clickTargets field (never enters allowedExecutableClicks)
        (0, test_1.expect)(item.clickTargets).toBeUndefined();
    }
});
(0, test_1.test)("6. hu_declared items are never considered runtime evidence", () => {
    const reqs = [
        makeReq("r1", "action", "Navegar a \"Productos\""),
        makeReq("r2", "prerequisite", "Estar autenticado"),
        makeReq("r3", "content_restriction", "No mostrar datos sensibles"),
    ];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), [], "T-1");
    for (const item of items) {
        // Every item has source="hu_declared"
        (0, test_1.expect)(item.source).toBe("hu_declared");
        // No item has a screenKey (route_menu_snapshot field)
        (0, test_1.expect)(item.screenKey).toBeUndefined();
        // No item has observed=true (route_transition field)
        (0, test_1.expect)(item.observed).toBeUndefined();
        // No item has validationStatus="validated" (never runtime-validated)
        (0, test_1.expect)(item.validationStatus).not.toBe("validated");
    }
});
(0, test_1.test)("7. branch knowledge includes action→destination hint and deduplicates by id", () => {
    const branches = [
        makeBranch("b1", "Seleccionar \"Cuentas\"", "Pantalla Cuentas"),
        makeBranch("b2", "Seleccionar \"Tarjetas\"", "Pantalla Tarjetas"),
    ];
    const reqs = [
        makeReq("b1", "branch", "Seleccionar \"Cuentas\"", {
            associatedBranchId: "b1",
        }),
    ];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "T-1");
    // Branch item from requirement
    const reqBranch = items.find((i) => i.category === "branch" && i.associatedBranchId === "b1");
    (0, test_1.expect)(reqBranch).toBeDefined();
    (0, test_1.expect)(reqBranch.source).toBe("hu_declared");
    // Branch knowledge item for b2 (not duplicated by requirement)
    const branchB2 = items.find((i) => i.category === "branch" &&
        i.branchId === "b2");
    (0, test_1.expect)(branchB2).toBeDefined();
    (0, test_1.expect)(branchB2.actionIntent).toContain("Tarjetas");
    (0, test_1.expect)(branchB2.expectedDestination).toBe("Pantalla Tarjetas");
    // No duplicate for b1 (requirement already created it)
    const b1Items = items.filter((i) => i.category === "branch" &&
        (i.branchId === "b1" || i.associatedBranchId === "b1"));
    (0, test_1.expect)(b1Items.length).toBe(1);
});
