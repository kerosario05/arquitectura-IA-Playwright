"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const hu_declared_persister_1 = require("../src/knowledge/hu-declared-persister");
function makeReq(id, category, sourceText, opts = {}) {
    return {
        id,
        sourceIssueKey: "HU-1",
        category,
        sourceText,
        status: "covered",
        ...opts,
    };
}
function makeBranch(branchId, sourceLabel) {
    return {
        branchId,
        sourceLabel,
        actionIntent: "select_option",
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
            adaptive: 0,
            nonAutomatable: 0,
            incompleteRequirement: 0,
        },
    };
}
(0, test_1.test)("Caso 1: prerequisite global + branch → declared_path ordenado", () => {
    const reqs = [
        makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
        makeReq("br-1", "branch", "Seleccionar Destino B"),
    ];
    const branches = [makeBranch("branch-b", "Destino B")];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "HU-1");
    const path = items.find((i) => i.category === "declared_path");
    (0, test_1.expect)(path).toBeDefined();
    (0, test_1.expect)(path.steps).toHaveLength(2);
    (0, test_1.expect)(path.steps[0]).toMatchObject({
        order: 1,
        stepKind: "prerequisite",
        actionTarget: "Entrada A",
    });
    (0, test_1.expect)(path.steps[1]).toMatchObject({
        order: 2,
        stepKind: "branch_action",
        actionTarget: "Destino B",
    });
    (0, test_1.expect)(path.associatedBranchId).toBe("branch-b");
    console.log("Caso 1: declared_path steps=[Entrada A, Destino B]");
});
(0, test_1.test)("Caso 2: prerequisite global + dos branches → dos paths", () => {
    const reqs = [
        makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
    ];
    const branches = [
        makeBranch("branch-b", "Destino B"),
        makeBranch("branch-c", "Destino C"),
    ];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "HU-1");
    const paths = items.filter((i) => i.category === "declared_path");
    (0, test_1.expect)(paths).toHaveLength(2);
    const pathB = paths.find((p) => p.associatedBranchId === "branch-b");
    const pathC = paths.find((p) => p.associatedBranchId === "branch-c");
    (0, test_1.expect)(pathB.steps[1].actionTarget).toBe("Destino B");
    (0, test_1.expect)(pathC.steps[1].actionTarget).toBe("Destino C");
    (0, test_1.expect)(pathB.steps[0].actionTarget).toBe("Entrada A");
    console.log("Caso 2: paths Entrada A→Destino B y Entrada A→Destino C");
});
(0, test_1.test)("Caso 3: prerequisite asociado solo a branch B → solo path B", () => {
    const reqs = [
        makeReq("pr-b", "prerequisite", 'Para continuar debe seleccionar "Entrada B"', {
            associatedBranchId: "branch-b",
        }),
    ];
    const branches = [
        makeBranch("branch-b", "Destino B"),
        makeBranch("branch-c", "Destino C"),
    ];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "HU-1");
    const paths = items.filter((i) => i.category === "declared_path");
    (0, test_1.expect)(paths).toHaveLength(1);
    (0, test_1.expect)(paths[0].associatedBranchId).toBe("branch-b");
    (0, test_1.expect)(paths[0].steps[0].actionTarget).toBe("Entrada B");
    console.log("Caso 3: path solo para branch-b");
});
(0, test_1.test)("Caso 4: dos prerequisites sin orden → NO declared_path (ambiguo)", () => {
    const reqs = [
        makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
        makeReq("pr-2", "prerequisite", 'Para continuar debe seleccionar "Entrada B"'),
    ];
    const branches = [makeBranch("branch-b", "Destino B")];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "HU-1");
    const paths = items.filter((i) => i.category === "declared_path");
    (0, test_1.expect)(paths).toHaveLength(0);
    console.log("Caso 4: no declared_path — reason=ambiguous_prerequisite_order");
});
(0, test_1.test)("Caso 5: regenerar misma HU → mismo id, sin duplicados", () => {
    const reqs = [
        makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
    ];
    const branches = [makeBranch("branch-b", "Destino B")];
    const items1 = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "HU-1");
    const items2 = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "HU-1");
    const pathIds1 = items1.filter((i) => i.category === "declared_path").map((i) => i.id);
    const pathIds2 = items2.filter((i) => i.category === "declared_path").map((i) => i.id);
    (0, test_1.expect)(pathIds1).toEqual(pathIds2);
    (0, test_1.expect)(pathIds1).toHaveLength(1);
    console.log("Caso 5: declared_path id determinista — sin duplicados");
});
(0, test_1.test)("Caso 6: authority — pending/trusted=false/executionBacked=false", () => {
    const reqs = [
        makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
    ];
    const branches = [makeBranch("branch-b", "Destino B")];
    const items = (0, hu_declared_persister_1.extractHuDeclaredItems)(accounting(reqs), branches, "HU-1");
    const path = items.find((i) => i.category === "declared_path");
    (0, test_1.expect)(path.validationStatus).toBe("pending");
    (0, test_1.expect)(path.trustedForReuse).toBe(false);
    (0, test_1.expect)(path.executionBacked).toBe(false);
    (0, test_1.expect)(path.source).toBe("hu_declared");
    (0, test_1.expect)(path.clickTargets).toBeUndefined();
    console.log("Caso 6: declared_path declarativo — sin autoridad");
});
