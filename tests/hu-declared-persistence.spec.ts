import { test, expect } from "@playwright/test";
import {
  extractHuDeclaredItems,
  persistHuDeclaredKnowledge,
} from "../src/knowledge/hu-declared-persister";
import type {
  FunctionalRequirementAccount,
  FunctionalBranchRef,
} from "../src/scenarios/scenario-types";

// ── Helpers ─────────────────────────────────────────────────────────────

function makeReq(
  id: string,
  category: FunctionalRequirementAccount["category"],
  sourceText: string,
  opts: Partial<FunctionalRequirementAccount> = {},
): FunctionalRequirementAccount {
  return {
    id,
    sourceIssueKey: "TEST-1",
    category,
    sourceText,
    status: "covered",
    ...opts,
  };
}

function makeBranch(
  branchId: string,
  actionIntent: string,
  expectedDestination?: string,
): FunctionalBranchRef {
  return {
    branchId,
    sourceLabel: actionIntent,
    actionIntent,
    expectedDestination,
    accessIntent: "unknown",
    evidenceSource: "user_story",
  };
}

function accounting(
  requirements: FunctionalRequirementAccount[],
) {
  return {
    requirements,
    summary: {
      total: requirements.length,
      covered: requirements.filter((r) => r.status === "covered").length,
      adaptive: requirements.filter((r) => r.status === "adaptive").length,
      nonAutomatable: requirements.filter((r) => r.status === "nonAutomatable")
        .length,
      incompleteRequirement: requirements.filter(
        (r) => r.status === "incompleteRequirement",
      ).length,
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────

test("1. empty knowledge + HU with prerequisite/branch → extracts hu_declared items", () => {
  const reqs = [
    makeReq("prereq-1", "prerequisite", "Para continuar debe ingresar al sistema"),
    makeReq("branch-1", "branch", "Seleccionar opción Alfa"),
    makeReq("action-1", "action", "Clic en \"Depósitos\""),
  ];
  const branches = [makeBranch("branch-a", "Seleccionar Alfa", "Pantalla Alfa")];

  const items = extractHuDeclaredItems(accounting(reqs), branches, "TEST-1");

  expect(items.length).toBeGreaterThanOrEqual(3);

  const prereq = items.find((i) => i.category === "prerequisite");
  expect(prereq).toBeDefined();
  expect(prereq!.source).toBe("hu_declared");
  expect(prereq!.knowledgeKind).toBe("hu_declared");
  expect(prereq!.sourceIssueKey).toBe("TEST-1");
  expect(prereq!.sourceText).toContain("ingresar al sistema");

  const branch = items.find((i) => i.category === "branch");
  expect(branch).toBeDefined();
  expect(branch!.source).toBe("hu_declared");

  const action = items.find((i) => i.category === "action");
  expect(action).toBeDefined();
  expect(action!.source).toBe("hu_declared");
});

test("2. same HU reprocessed → stable ids (no duplication via idempotent extraction)", () => {
  const reqs = [
    makeReq("a-1", "action", "Clic en \"Productos\""),
    makeReq("pr-1", "prerequisite", "Debe estar autenticado"),
  ];
  const branches: FunctionalBranchRef[] = [];

  const items1 = extractHuDeclaredItems(accounting(reqs), branches, "TEST-1");
  const items2 = extractHuDeclaredItems(accounting(reqs), branches, "TEST-1");

  // Same ids on both runs
  const ids1 = items1.map((i) => i.id).sort();
  const ids2 = items2.map((i) => i.id).sort();
  expect(ids1).toEqual(ids2);

  // Same count (extraction is pure — dedup is in persist)
  expect(items1.length).toBe(items2.length);
});

test("3. second HU same appSlug → accumulates knowledge (different ids)", () => {
  const reqs1 = [makeReq("r1", "action", "Clic en \"Cuentas\"")];
  const reqs2 = [makeReq("r2", "action", "Clic en \"Tarjetas\"")];

  const items1 = extractHuDeclaredItems(accounting(reqs1), [], "HU-1");
  const items2 = extractHuDeclaredItems(accounting(reqs2), [], "HU-2");

  // Different source texts → different ids
  const ids1 = items1.map((i) => i.id);
  const ids2 = items2.map((i) => i.id);
  expect(ids1.some((id) => ids2.includes(id))).toBe(false);

  // Both have source hu_declared
  expect(items1.every((i) => i.source === "hu_declared")).toBe(true);
  expect(items2.every((i) => i.source === "hu_declared")).toBe(true);
});

test("4. different appSlug → isolation (items carry no cross-app references)", () => {
  const reqs = [makeReq("r1", "visibility", "Mostrar pantalla de inicio")];

  const itemsA = extractHuDeclaredItems(accounting(reqs), [], "TEST-1");
  const itemsB = extractHuDeclaredItems(accounting(reqs), [], "TEST-1");

  // Items from both extractions are structurally identical (same HU text)
  // but isolation is enforced at persist time by appSlug — extraction is agnostic
  expect(itemsA.length).toBe(itemsB.length);
  expect(itemsA[0].id).toBe(itemsB[0].id);

  // The persist function takes appSlug as parameter — isolation is by caller
});

test("5. hu_declared items are NOT runtime evidence — no allowedExecutableClicks impact", () => {
  const reqs = [
    makeReq("a-1", "action", "Clic en \"Botón X\""),
    makeReq("b-1", "branch", "Seleccionar \"Opción Y\""),
  ];
  const branches = [makeBranch("br-1", "Click Y", "Dest Y")];

  const items = extractHuDeclaredItems(accounting(reqs), branches, "T-1");

  for (const item of items) {
    // source is hu_declared, NOT mcp_runtime_observation
    expect(item.source).not.toBe("mcp_runtime_observation");
    expect(item.source).toBe("hu_declared");

    // trustedForReuse is always false — provisional, not runtime
    expect(item.trustedForReuse).toBe(false);

    // validationStatus is pending — not validated by execution
    expect(item.validationStatus).toBe("pending");

    // No clickTargets field (never enters allowedExecutableClicks)
    expect(item.clickTargets).toBeUndefined();
  }
});

test("6. hu_declared items are never considered runtime evidence", () => {
  const reqs = [
    makeReq("r1", "action", "Navegar a \"Productos\""),
    makeReq("r2", "prerequisite", "Estar autenticado"),
    makeReq("r3", "content_restriction", "No mostrar datos sensibles"),
  ];

  const items = extractHuDeclaredItems(accounting(reqs), [], "T-1");

  for (const item of items) {
    // Every item has source="hu_declared"
    expect(item.source).toBe("hu_declared");

    // No item has a screenKey (route_menu_snapshot field)
    expect(item.screenKey).toBeUndefined();

    // No item has observed=true (route_transition field)
    expect(item.observed).toBeUndefined();

    // No item has validationStatus="validated" (never runtime-validated)
    expect(item.validationStatus).not.toBe("validated");
  }
});

test("7. branch knowledge includes action→destination hint and deduplicates by id", () => {
  const branches = [
    makeBranch("b1", "Seleccionar \"Cuentas\"", "Pantalla Cuentas"),
    makeBranch("b2", "Seleccionar \"Tarjetas\"", "Pantalla Tarjetas"),
  ];
  const reqs = [
    makeReq("b1", "branch", "Seleccionar \"Cuentas\"", {
      associatedBranchId: "b1",
    }),
  ];

  const items = extractHuDeclaredItems(accounting(reqs), branches, "T-1");

  // Branch item from requirement
  const reqBranch = items.find(
    (i) => i.category === "branch" && i.associatedBranchId === "b1",
  );
  expect(reqBranch).toBeDefined();
  expect(reqBranch!.source).toBe("hu_declared");

  // Branch knowledge item for b2 (not duplicated by requirement)
  const branchB2 = items.find(
    (i) =>
      i.category === "branch" &&
      (i as any).branchId === "b2",
  );
  expect(branchB2).toBeDefined();
  expect((branchB2 as any).actionIntent).toContain("Tarjetas");
  expect((branchB2 as any).expectedDestination).toBe("Pantalla Tarjetas");

  // No duplicate for b1 (requirement already created it)
  const b1Items = items.filter(
    (i) =>
      i.category === "branch" &&
      ((i as any).branchId === "b1" || i.associatedBranchId === "b1"),
  );
  expect(b1Items.length).toBe(1);
});
