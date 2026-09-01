import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildMcpScenarioMessages } from "../src/scenarios/mcp-scenario-prompt-builder";
import type { JiraIssueSource } from "../src/scenarios/scenario-types";

const SLUG = "declared-path-prompt-test";
const DIR = path.join(process.cwd(), "automations", "apps", SLUG);
const KP = path.join(DIR, "app.knowledge.json");

function makePath(id: string, issueKey: string, steps: Array<{ order: number; actionTarget: string }>) {
  return {
    id,
    source: "hu_declared",
    knowledgeKind: "hu_declared",
    category: "declared_path",
    sourceIssueKey: issueKey,
    associatedBranchId: "branch-b",
    steps: steps.map((s) => ({
      order: s.order,
      stepKind: s.order === 1 ? "prerequisite" : "branch_action",
      actionTarget: s.actionTarget,
      actionIntent: s.order === 1 ? "click" : "select_option",
    })),
    validationStatus: "pending",
    trustedForReuse: false,
    executionBacked: false,
  };
}

const CURRENT_ISSUE: JiraIssueSource = {
  key: "HU-CURRENT",
  summary: "El usuario debe acceder a Destino B",
  description: "",
  acceptanceCriteria: null,
  labels: [],
  components: [],
  status: "Open",
  issueType: "Story",
};

function writeKnowledge(items: unknown[]) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(KP, JSON.stringify({
    version: 1, appSlug: SLUG,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items,
  }, null, 2), "utf-8");
}

test.afterAll(() => {
  try {
    fs.rmSync(DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

async function buildPrompt(items: unknown[], functionalTargets: string[]) {
  writeKnowledge(items);
  const messages = await buildMcpScenarioMessages(
    [CURRENT_ISSUE],
    SLUG,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, "catalog_listing_flow", undefined, undefined, undefined,
    { mainIntent: "catalog_listing_flow", subIntent: "standard", explicitRoutePath: [] },
    undefined, undefined,
    functionalTargets,
  );
  return messages.find((m) => m.role === "system")?.content ?? "";
}

test("Caso 1: path previo termina en functional target actual → incluido y ordenado", async () => {
  const items = [makePath("p1", "HU-PRIOR", [
    { order: 1, actionTarget: "Entrada A" },
    { order: 2, actionTarget: "Destino B" },
  ])];
  const system = await buildPrompt(items, ["Destino B"]);

  expect(system).toContain("DECLARED ORDERED PATHS");
  expect(system).toContain("NOT RUNTIME VALIDATED");
  const section = system.split("DECLARED ORDERED PATHS")[1] ?? "";
  const idx1 = section.indexOf("1. Entrada A");
  const idx2 = section.indexOf("2. Destino B");
  expect(idx1).toBeGreaterThan(-1);
  expect(idx2).toBeGreaterThan(idx1);
  console.log("Caso 1: path incluido, orden preservado");
});

test("Caso 2: functional target no coincide → path NO incluido", async () => {
  const items = [makePath("p1", "HU-PRIOR", [
    { order: 1, actionTarget: "Entrada A" },
    { order: 2, actionTarget: "Destino B" },
  ])];
  const system = await buildPrompt(items, ["Otro destino"]);

  expect(system).not.toContain("DECLARED ORDERED PATHS");
  expect(system).not.toContain("1. Entrada A");
  console.log("Caso 2: path excluido por target no coincidente");
});

test("Caso 3: declared_path de la propia HU actual → NO incluido (self-knowledge)", async () => {
  const items = [makePath("p-self", "HU-CURRENT", [
    { order: 1, actionTarget: "Entrada A" },
    { order: 2, actionTarget: "Destino B" },
  ])];
  const system = await buildPrompt(items, ["Destino B"]);

  expect(system).not.toContain("DECLARED ORDERED PATHS");
  console.log("Caso 3: self-knowledge excluido");
});

test("Caso 4: dos paths distintos terminan en el mismo target → ninguno, ambiguous", async () => {
  const items = [
    makePath("p1", "HU-1", [
      { order: 1, actionTarget: "Entrada A" },
      { order: 2, actionTarget: "Destino B" },
    ]),
    makePath("p2", "HU-2", [
      { order: 1, actionTarget: "Entrada X" },
      { order: 2, actionTarget: "Destino B" },
    ]),
  ];
  const system = await buildPrompt(items, ["Destino B"]);

  expect(system).not.toContain("DECLARED ORDERED PATHS");
  console.log("Caso 4: ambiguous_declared_path — ninguno seleccionado");
});

test("Caso 5: allowedExecutableClicks y autoridad no cambian", async () => {
  const items = [makePath("p1", "HU-PRIOR", [
    { order: 1, actionTarget: "Entrada A" },
    { order: 2, actionTarget: "Destino B" },
  ])];
  const system = await buildPrompt(items, ["Destino B"]);

  // La sección es explícitamente solo contexto, no autoridad
  expect(system).toContain("does not authorize execution");
  expect(system).not.toContain("allowedExecutableClicks");
  console.log("Caso 5: sin autoridad de ejecución");
});

test("Caso 6: prompt contiene pasos ordenados y marcado NOT RUNTIME VALIDATED", async () => {
  const items = [makePath("p1", "HU-PRIOR", [
    { order: 1, actionTarget: "Entrada A" },
    { order: 2, actionTarget: "Destino B" },
  ])];
  const system = await buildPrompt(items, ["Destino B"]);

  const section = system.split("## DECLARED ORDERED PATHS")[1] ?? "";
  expect(section).toContain("NOT RUNTIME VALIDATED");
  const idx1 = section.indexOf("1. Entrada A");
  const idx2 = section.indexOf("2. Destino B");
  expect(idx1).toBeGreaterThan(-1);
  expect(idx2).toBeGreaterThan(idx1);
  // No metadata: ids/timestamps/hashes ausentes
  expect(section).not.toContain("hd_declared_path");
  expect(section).not.toContain("createdAt");
  console.log("Caso 6: sección compacta, ordenada, NOT RUNTIME VALIDATED");
});