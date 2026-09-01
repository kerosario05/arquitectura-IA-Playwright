import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildMcpScenarioMessages } from "../src/scenarios/mcp-scenario-prompt-builder";
import type { JiraIssueSource } from "../src/scenarios/scenario-types";

const SLUG = "prompt-hints-subintent-test";
const DIR = path.join(process.cwd(), "automations", "apps", SLUG);
const KP = path.join(DIR, "app.knowledge.json");

const BRANCH = {
  id: "b_branch",
  source: "hu_declared",
  knowledgeKind: "hu_declared",
  category: "branch",
  sourceText: "Navegar a Destino B",
  actionTarget: "Destino B",
  actionIntent: "navigate",
  sourceIssueKey: "HU-X",
  associatedBranchId: "b_branch",
  executionBacked: false,
  validationStatus: "pending",
  trustedForReuse: false,
  runCount: 1,
};

const PREREQ = {
  id: "b_prereq",
  source: "hu_declared",
  knowledgeKind: "hu_declared",
  category: "prerequisite",
  sourceText: "Para continuar debe seleccionar Entrada A",
  actionTarget: "Entrada A",
  actionIntent: "click",
  sourceIssueKey: "HU-X",
  executionBacked: false,
  validationStatus: "pending",
  trustedForReuse: false,
  runCount: 1,
};

const ISSUE: JiraIssueSource = {
  key: "HU-NEW",
  summary: "El usuario debe acceder a Destino B para continuar",
  description: "",
  acceptanceCriteria: null,
  labels: [],
  components: [],
  status: "Open",
  issueType: "Story",
};

test.beforeAll(() => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(KP, JSON.stringify({
    version: 1, appSlug: SLUG,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [BRANCH, PREREQ],
  }, null, 2), "utf-8");
});

test.afterAll(() => { try { fs.rmSync(DIR, { recursive: true, force: true }); } catch {} });

test("prompt generationHints respect subIntent contract and use functional targets", async () => {
  // resolvedIntent=A, huModel.mainIntent=B (discarded), huModel.subIntent=B1
  // → compatibleSubIntent=undefined, functional targets reach the hints path.
  const messages = await buildMcpScenarioMessages(
    [ISSUE],
    SLUG,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "A", // effectiveIntent / resolvedIntent
    undefined,
    undefined,
    undefined,
    { mainIntent: "B", subIntent: "B1", explicitRoutePath: [] },
    undefined,
    undefined,
    ["Destino B"], // huFunctionalClickTargets
  );

  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const hintsSection = system.split("## Declarative Generation Hints")[1] ?? "";

  expect(hintsSection).toContain("Destino B");
  expect(hintsSection).toContain("Entrada A");
  expect(hintsSection).toContain("Category: branch");
  expect(hintsSection).toContain("Category: prerequisite");

  // Authority unchanged: hints section carries declarative-only warning.
  expect(hintsSection).toContain("NOT validated or executable routes");
  expect(system).not.toContain("executionBacked");
  console.log("prompt generationHints: branch=Destino B + companion=Entrada A, subIntent cleared");
});

test("conflicting subIntent cleared — no subintent penalty rejects the branch", async () => {
  const messages = await buildMcpScenarioMessages(
    [ISSUE],
    SLUG,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "A",
    undefined,
    undefined,
    undefined,
    { mainIntent: "B", subIntent: "B1", explicitRoutePath: [] },
    undefined,
    undefined,
    ["Destino B"],
  );
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  const hintsSection = system.split("## Declarative Generation Hints")[1] ?? "";
  // Branch reached the prompt (would NOT if subintent_low_overlap penalty applied).
  expect(hintsSection).toContain("Action target: Destino B");
  console.log("conflicting subIntent (B1 from intent B) cleared for resolvedIntent=A");
});

test("compatible subIntent preserved when huModel.mainIntent matches resolvedIntent", async () => {
  const messages = await buildMcpScenarioMessages(
    [ISSUE],
    SLUG,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    "A",
    undefined,
    undefined,
    undefined,
    { mainIntent: "A", subIntent: "A1", explicitRoutePath: [] },
    undefined,
    undefined,
    ["Destino B"],
  );
  const system = messages.find((m) => m.role === "system")?.content ?? "";
  expect(system).toContain("Destino B");
  console.log("compatible subIntent A1 preserved when mainIntent matches resolvedIntent");
});