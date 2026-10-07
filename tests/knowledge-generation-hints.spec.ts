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

test("hu_declared pending/trusted=false never enters runtime knowledge", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(TEST_SLUG, TEST_HU, "balance_inquiry");
  const runtimeHints = [...ctx.navigationHints, ...ctx.functionalHints];
  expect(runtimeHints.some((hint) => hint.clickTargets.includes("Consultar saldo") && hint.kind === "hu_declared")).toBe(false);
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

test("hu_declared item is never selected as runtime knowledge regardless of score", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(TEST_SLUG, TEST_HU, "balance_inquiry");
  const runtimeHints = [...ctx.navigationHints, ...ctx.functionalHints];
  expect(runtimeHints.some((hint) => hint.clickTargets.includes("Seccion remota lejana"))).toBe(false);
});

test("runtime knowledge never grants authority to hu_declared items", () => {
  const ctx = buildKnowledgeContextForScenarioGeneration(TEST_SLUG, TEST_HU, "balance_inquiry");
  const runtimeKinds = [...ctx.navigationHints, ...ctx.functionalHints].map((h) => h.kind);
  expect(runtimeKinds.includes("hu_declared")).toBe(false);
});
