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

test("pending HU branch does not enter runtime knowledge", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(SLUG, NEW_HU, "navigation");
  const runtimeHints = [...ctx.navigationHints, ...ctx.functionalHints];
  expect(runtimeHints.some((hint) => hint.clickTargets.includes("Destino B") && hint.kind === "hu_declared")).toBe(false);
});

test("pending HU prerequisite does not enter runtime knowledge", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(SLUG, NEW_HU, "navigation");
  const runtimeHints = [...ctx.navigationHints, ...ctx.functionalHints];
  expect(runtimeHints.some((hint) => hint.clickTargets.includes("Entrada A"))).toBe(false);
});

test("pending HU visibility and restart do not enter runtime knowledge", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(SLUG, NEW_HU, "navigation");
  const runtimeHints = [...ctx.navigationHints, ...ctx.functionalHints];
  expect(runtimeHints.some((hint) => hint.clickTargets.includes("titulo de la pagina"))).toBe(false);
  expect(runtimeHints.some((hint) => hint.clickTargets.includes("Reiniciar"))).toBe(false);
});

test("runtime track contains trusted knowledge only, not HU declarations", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(SLUG, NEW_HU, "navigation");
  const runtimeKinds = [...ctx.navigationHints, ...ctx.functionalHints].map((h) => h.kind);
  expect(runtimeKinds).not.toContain("hu_declared");
  expect(ctx.functionalHints.some((hint) => hint.kind === "route_menu_snapshot")).toBe(true);
});
