import { test, expect } from "@playwright/test";
import { extractHuDeclaredItems } from "../src/knowledge/hu-declared-persister";
import type {
  FunctionalRequirementAccount,
  FunctionalBranchRef,
} from "../src/scenarios/scenario-types";

function makeReq(
  id: string,
  category: FunctionalRequirementAccount["category"],
  sourceText: string,
  opts: Partial<FunctionalRequirementAccount> = {},
): FunctionalRequirementAccount {
  return {
    id,
    sourceIssueKey: "HU-1",
    category,
    sourceText,
    status: "covered",
    ...opts,
  };
}

function makeBranch(
  branchId: string,
  sourceLabel: string,
): FunctionalBranchRef {
  return {
    branchId,
    sourceLabel,
    actionIntent: "select_option",
    accessIntent: "unknown",
    evidenceSource: "user_story",
  };
}

function accounting(requirements: FunctionalRequirementAccount[]) {
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

test("Caso 1: prerequisite global + branch → declared_path ordenado", () => {
  const reqs = [
    makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
    makeReq("br-1", "branch", "Seleccionar Destino B"),
  ];
  const branches = [makeBranch("branch-b", "Destino B")];

  const items = extractHuDeclaredItems(accounting(reqs), branches, "HU-1");
  const path = items.find((i) => i.category === "declared_path");

  expect(path).toBeDefined();
  expect((path as any).steps).toHaveLength(2);
  expect((path as any).steps[0]).toMatchObject({
    order: 1,
    stepKind: "prerequisite",
    actionTarget: "Entrada A",
  });
  expect((path as any).steps[1]).toMatchObject({
    order: 2,
    stepKind: "branch_action",
    actionTarget: "Destino B",
  });
  expect(path!.associatedBranchId).toBe("branch-b");
  console.log("Caso 1: declared_path steps=[Entrada A, Destino B]");
});

test("Caso 2: prerequisite global + dos branches → dos paths", () => {
  const reqs = [
    makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
  ];
  const branches = [
    makeBranch("branch-b", "Destino B"),
    makeBranch("branch-c", "Destino C"),
  ];

  const items = extractHuDeclaredItems(accounting(reqs), branches, "HU-1");
  const paths = items.filter((i) => i.category === "declared_path");

  expect(paths).toHaveLength(2);
  const pathB = paths.find((p) => p.associatedBranchId === "branch-b");
  const pathC = paths.find((p) => p.associatedBranchId === "branch-c");
  expect((pathB as any).steps[1].actionTarget).toBe("Destino B");
  expect((pathC as any).steps[1].actionTarget).toBe("Destino C");
  expect((pathB as any).steps[0].actionTarget).toBe("Entrada A");
  console.log("Caso 2: paths Entrada A→Destino B y Entrada A→Destino C");
});

test("Caso 3: prerequisite asociado solo a branch B → solo path B", () => {
  const reqs = [
    makeReq("pr-b", "prerequisite", 'Para continuar debe seleccionar "Entrada B"', {
      associatedBranchId: "branch-b",
    }),
  ];
  const branches = [
    makeBranch("branch-b", "Destino B"),
    makeBranch("branch-c", "Destino C"),
  ];

  const items = extractHuDeclaredItems(accounting(reqs), branches, "HU-1");
  const paths = items.filter((i) => i.category === "declared_path");

  expect(paths).toHaveLength(1);
  expect(paths[0].associatedBranchId).toBe("branch-b");
  expect((paths[0] as any).steps[0].actionTarget).toBe("Entrada B");
  console.log("Caso 3: path solo para branch-b");
});

test("Caso 4: dos prerequisites sin orden → NO declared_path (ambiguo)", () => {
  const reqs = [
    makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
    makeReq("pr-2", "prerequisite", 'Para continuar debe seleccionar "Entrada B"'),
  ];
  const branches = [makeBranch("branch-b", "Destino B")];

  const items = extractHuDeclaredItems(accounting(reqs), branches, "HU-1");
  const paths = items.filter((i) => i.category === "declared_path");

  expect(paths).toHaveLength(0);
  console.log("Caso 4: no declared_path — reason=ambiguous_prerequisite_order");
});

test("Caso 5: regenerar misma HU → mismo id, sin duplicados", () => {
  const reqs = [
    makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
  ];
  const branches = [makeBranch("branch-b", "Destino B")];

  const items1 = extractHuDeclaredItems(accounting(reqs), branches, "HU-1");
  const items2 = extractHuDeclaredItems(accounting(reqs), branches, "HU-1");

  const pathIds1 = items1.filter((i) => i.category === "declared_path").map((i) => i.id);
  const pathIds2 = items2.filter((i) => i.category === "declared_path").map((i) => i.id);
  expect(pathIds1).toEqual(pathIds2);
  expect(pathIds1).toHaveLength(1);
  console.log("Caso 5: declared_path id determinista — sin duplicados");
});

test("Caso 6: authority — pending/trusted=false/executionBacked=false", () => {
  const reqs = [
    makeReq("pr-1", "prerequisite", 'Para continuar debe seleccionar "Entrada A"'),
  ];
  const branches = [makeBranch("branch-b", "Destino B")];

  const items = extractHuDeclaredItems(accounting(reqs), branches, "HU-1");
  const path = items.find((i) => i.category === "declared_path");

  expect(path!.validationStatus).toBe("pending");
  expect(path!.trustedForReuse).toBe(false);
  expect((path as any).executionBacked).toBe(false);
  expect(path!.source).toBe("hu_declared");
  expect((path as any).clickTargets).toBeUndefined();
  console.log("Caso 6: declared_path declarativo — sin autoridad");
});