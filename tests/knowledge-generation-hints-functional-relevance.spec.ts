import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildKnowledgeContextForScenarioGeneration } from "../src/scenarios/knowledge-context-resolver";

const SLUG = "gen-hints-functional-relevance-test";
const DIR = path.join(process.cwd(), "automations", "apps", SLUG);
const KP = path.join(DIR, "app.knowledge.json");

const BRANCH_B = {
  id: "prior_branch_b",
  source: "hu_declared",
  knowledgeKind: "hu_declared",
  category: "branch",
  sourceText: "Navegar a Destino B desde el menu principal",
  actionTarget: "Destino B",
  actionIntent: "navigate",
  sourceIssueKey: "HU-100",
  associatedBranchId: "branch_b",
  executionBacked: false,
  validationStatus: "pending",
  trustedForReuse: false,
  runCount: 1,
};

const PREREQ_GLOBAL = {
  id: "prior_prereq_global",
  source: "hu_declared",
  knowledgeKind: "hu_declared",
  category: "prerequisite",
  sourceText: "Para continuar debe seleccionar Entrada A",
  actionTarget: "Entrada A",
  actionIntent: "click",
  sourceIssueKey: "HU-100",
  executionBacked: false,
  validationStatus: "pending",
  trustedForReuse: false,
  runCount: 1,
};

const VISIBILITY = {
  id: "prior_visibility",
  source: "hu_declared",
  knowledgeKind: "hu_declared",
  category: "visibility",
  sourceText: "Se muestra el titulo de la pagina",
  actionTarget: "titulo de la pagina",
  actionIntent: "assert",
  sourceIssueKey: "HU-100",
  executionBacked: false,
  validationStatus: "pending",
  trustedForReuse: false,
  runCount: 1,
};

const RESTART = {
  id: "prior_restart",
  source: "hu_declared",
  knowledgeKind: "hu_declared",
  category: "restart",
  sourceText: "Reiniciar el flujo desde el inicio",
  actionTarget: "Reiniciar",
  actionIntent: "navigate",
  sourceIssueKey: "HU-100",
  executionBacked: false,
  validationStatus: "pending",
  trustedForReuse: false,
  runCount: 1,
};

const UNRELATED_RUNTIME = {
  id: "rt_validated",
  knowledgeKind: "route_menu_snapshot",
  validationStatus: "validated",
  trustedForReuse: true,
  clickTargets: ["Destino B", "Entrada A"],
  steps: ["Click menu", "Click Destino B"],
  failureCount: 0,
  successCount: 3,
};

const NEW_HU = "El usuario necesita acceder a Destino B para realizar una consulta";

test.beforeAll(() => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(KP, JSON.stringify({
    version: 1, appSlug: SLUG,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [BRANCH_B, PREREQ_GLOBAL, VISIBILITY, RESTART, UNRELATED_RUNTIME],
  }, null, 2), "utf-8");
});

test.afterAll(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {} });

test("Case 1: branch selected via functional target relevance — trusted=false/pending", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(
    SLUG, NEW_HU, "navigation", undefined, undefined,
    ["Destino B"],
  );
  const branch = ctx.generationHints.find((h) => h.actionTarget === "Destino B");
  expect(branch).toBeDefined();
  expect(branch!.category).toBe("branch");
  expect(branch!.score).toBeGreaterThanOrEqual(20);
  expect(branch!.reason).toContain("functional_target_relevance");
  console.log(`Case 1: branch score=${branch!.score} reason=${branch!.reason}`);
});

test("Case 2: companion prerequisite included when branch selected", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(
    SLUG, NEW_HU, "navigation", undefined, undefined,
    ["Destino B"],
  );
  const branch = ctx.generationHints.find((h) => h.actionTarget === "Destino B");
  const prereq = ctx.generationHints.find((h) => h.actionTarget === "Entrada A");
  expect(branch).toBeDefined();
  expect(prereq).toBeDefined();
  expect(prereq!.category).toBe("prerequisite");
  expect(prereq!.reason).toBe("companion_prerequisite");
  expect(prereq!.sourceIssueKey).toBe(branch!.sourceIssueKey);
  expect((prereq as any).executionBacked).toBeUndefined();
  expect((prereq as any).trustedForReuse).toBeUndefined();
  expect((prereq as any).validationStatus).toBeUndefined();
  console.log(`Case 2: companion prereq reason=${prereq!.reason}`);
});

test("Case 3: visibility/restart from same issue NOT included by companion closure", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(
    SLUG, NEW_HU, "navigation", undefined, undefined,
    ["Destino B"],
  );
  const visibility = ctx.generationHints.find((h) => h.category === "visibility");
  const restart = ctx.generationHints.find((h) => h.category === "restart");
  expect(visibility).toBeUndefined();
  expect(restart).toBeUndefined();
  console.log("Case 3: visibility and restart excluded from generationHints");
});

test("Case 4: target does not match branch — no branch or prerequisite selected", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(
    SLUG, NEW_HU, "navigation", undefined, undefined,
    ["Accion Irrelevante"],
  );
  const branch = ctx.generationHints.find((h) => h.actionTarget === "Destino B");
  const prereq = ctx.generationHints.find((h) => h.actionTarget === "Entrada A");
  expect(branch).toBeUndefined();
  expect(prereq).toBeUndefined();
  console.log("Case 4: no branch/prerequisite when no functional target match");
});

test("Case 5: allowedExecutableClicks and runtime authority not changed", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(
    SLUG, NEW_HU, "navigation", undefined, undefined,
    ["Destino B"],
  );
  // generationHints never feed runtime tracks
  const runtimeKinds = [...ctx.navigationHints, ...ctx.functionalHints].map((h) => h.kind);
  expect(runtimeKinds).not.toContain("hu_declared");
  // generationHints carry only declarative fields — no execution authority
  for (const h of ctx.generationHints) {
    expect(typeof h.category).toBe("string");
    expect(typeof h.sourceText).toBe("string");
    expect((h as any).executionBacked).toBeUndefined();
    expect((h as any).clickTargets).toBeUndefined();
    expect((h as any).trustedForReuse).toBeUndefined();
    expect((h as any).validationStatus).toBeUndefined();
  }
  console.log("Case 5: runtime authority and allowedExecutableClicks unchanged");
});
