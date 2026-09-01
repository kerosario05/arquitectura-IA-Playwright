import { test, expect } from "@playwright/test";
import * as fs from "node:fs";
import * as path from "node:path";
import { buildKnowledgeContextForScenarioGeneration } from "../src/scenarios/knowledge-context-resolver";

const TEST_SLUG = "knowledge-gen-hints-test";
const KNOWLEDGE_DIR = path.join(process.cwd(), "automations", "apps", TEST_SLUG);
const KNOWLEDGE_PATH = path.join(KNOWLEDGE_DIR, "app.knowledge.json");

// Generic fixtures — not tied to any real app, HU key, product or business.
const HU_DECLARED_PREREQ = {
  id: "hd_prerequisite_1",
  source: "hu_declared",
  knowledgeKind: "hu_declared",
  category: "prerequisite",
  sourceText: "Para continuar debe seleccionar el boton Consultar saldo",
  sourceIssueKey: "GEN-1",
  associatedBranchId: "b1",
  expectedBehavior: "Avanzar requiere Consultar saldo",
  actionTarget: "Consultar saldo",
  actionIntent: "select",
  executionBacked: false,
  validationStatus: "pending",
  trustedForReuse: false,
  runCount: 1,
};

const HU_DECLARED_LOW_SCORE = {
  id: "hd_branch_2",
  source: "hu_declared",
  knowledgeKind: "hu_declared",
  category: "branch",
  sourceText: "El usuario accede a una seccion remota del area corporativa",
  sourceIssueKey: "GEN-2",
  expectedBehavior: "Acceder a una seccion remota",
  actionTarget: "Seccion remota lejana",
  actionIntent: "navigate",
  executionBacked: false,
  validationStatus: "pending",
  trustedForReuse: false,
  runCount: 1,
};

const VALIDATED_RUNTIME = {
  id: "scenario_validated_1",
  knowledgeKind: "scenario_validated",
  validationStatus: "validated",
  trustedForReuse: true,
  scenarioTitle: "Flujo base validado",
  steps: ["Consultar saldo de la cuenta", "Verificar saldo visible"],
  clickTargets: ["Consultar saldo", "Ingresar"],
  failureCount: 0,
  successCount: 2,
};

const TEST_HU =
  "El usuario necesita consultar el saldo de su cuenta corriente. Para continuar debe seleccionar el boton Consultar saldo.";

test.beforeAll(() => {
  fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });
  fs.writeFileSync(
    KNOWLEDGE_PATH,
    JSON.stringify(
      {
        version: 1,
        appSlug: TEST_SLUG,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: [HU_DECLARED_PREREQ, HU_DECLARED_LOW_SCORE, VALIDATED_RUNTIME],
      },
      null,
      2,
    ),
    "utf-8",
  );
});

test.afterAll(() => {
  try {
    fs.rmSync(KNOWLEDGE_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

test("hu_declared pending/trusted=false with sufficient score enters generationHints", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(TEST_SLUG, TEST_HU, "balance_inquiry");

  const hints = ctx.generationHints;
  const prereq = hints.find((h) => h.actionTarget === "Consultar saldo");
  expect(prereq).toBeDefined();
  expect(prereq!.category).toBe("prerequisite");
  expect(prereq!.actionIntent).toBe("select");
  expect(prereq!.sourceText).toContain("Consultar saldo");
  expect(prereq!.score).toBeGreaterThanOrEqual(20);
});

test("same hu_declared item does NOT enter runtime authority", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(TEST_SLUG, TEST_HU, "balance_inquiry");

  const runtimeKinds = [...ctx.navigationHints, ...ctx.functionalHints].map((h) => h.kind);
  expect(runtimeKinds.includes("hu_declared")).toBe(false);
  // The only runtime hint comes from the validated item — none from hu_declared.
  expect(ctx.navigationHints.length).toBe(0);
  expect(ctx.functionalHints.length).toBe(1);
  expect(ctx.functionalHints[0].kind).toBe("scenario_validated");
});

test("validated/runtime item keeps existing behavior", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(TEST_SLUG, TEST_HU, "balance_inquiry");

  expect(ctx.available).toBe(true);
  expect(ctx.functionalHints.length).toBeGreaterThan(0);
  const validated = ctx.functionalHints.find((h) => h.kind === "scenario_validated");
  expect(validated).toBeDefined();
  expect(validated!.clickTargets).toContain("Consultar saldo");
});

test("hu_declared item with low score is not selected", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(TEST_SLUG, TEST_HU, "balance_inquiry");

  expect(ctx.generationHints.some((h) => h.actionTarget === "Seccion remota lejana")).toBe(false);
});

test("generationHints never feed allowedExecutableClicks/runtime track", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(TEST_SLUG, TEST_HU, "balance_inquiry");

  // generationHints carry ONLY declarative fields — never execution authority.
  for (const h of ctx.generationHints) {
    expect(h.category.length).toBeGreaterThan(0);
    expect(typeof h.sourceText).toBe("string");
    expect(typeof h.score).toBe("number");
    expect((h as any).executionBacked).toBeUndefined();
    expect((h as any).trustedForReuse).toBeUndefined();
    expect((h as any).validationStatus).toBeUndefined();
    expect((h as any).clickTargets).toBeUndefined();
  }
  // hu_declared kind never appears in the runtime hint tracks that drive
  // allowedExecutableClicks / executable clicks.
  const runtimeKinds = [...ctx.navigationHints, ...ctx.functionalHints].map((h) => h.kind);
  expect(runtimeKinds.includes("hu_declared")).toBe(false);
});