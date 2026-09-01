import { test, expect } from "@playwright/test";
import { buildRequirementAccounting } from "../src/scenarios/scenario-functional-quality";
import type { FunctionalBranchRef, McpScenario } from "../src/scenarios/scenario-types";

function makeScenario(title: string, steps: string[]): McpScenario {
  return {
    sourceIssueKey: "HU-TEST",
    title,
    steps,
    preconditions: [],
    expectedResult: "OK",
    type: "functional",
    database: "",
    isConverted: 0,
    automationType: "ui_discovery",
    setupStrategy: "no_login",
    appSlug: "test-app",
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
}

test("dynamic selection, sensitive action, and visibility classification (no routeProfile/runtime)", () => {
  const hu = [
    "Seleccionar un elemento del listado dinámico.",
    "Presionar Acción sensible.",
    "Mostrar mensaje de error.",
  ].join(" ");

  const { requirements, summary, functionalCoverage } = buildRequirementAccounting([], [], hu, "HU-TEST");

  const dynamic = requirements.find((r) => r.category === "action" && r.sourceText.includes("elemento"));
  const sensitive = requirements.find((r) => r.category === "action" && r.sourceText.includes("Acción sensible"));
  const visibility = requirements.find((r) => r.category === "visibility");

  // A) dynamic collection selection → adaptive, requires_runtime_materialization
  expect(dynamic).toBeDefined();
  expect(dynamic!.status).toBe("adaptive");
  expect(dynamic!.reasonCode).toBe("requires_runtime_materialization");

  // B) sensitive action without runtime evidence → adaptive, not executable
  expect(sensitive).toBeDefined();
  expect(sensitive!.status).toBe("adaptive");
  expect(sensitive!.reasonCode).toBe("sensitive_action_requires_runtime_evidence");

  // C) visibility uncovered and functionally generable → stays missing
  expect(visibility).toBeDefined();
  expect(visibility!.status).toBe("incompleteRequirement");
  expect(visibility!.reasonCode).toBe("no_covering_scenario");

  expect(summary.adaptive).toBe(2);
  expect(functionalCoverage.missing).toContain(visibility!.id);
  expect(functionalCoverage.missing).not.toContain(dynamic!.id);
  expect(functionalCoverage.missing).not.toContain(sensitive!.id);
  expect(functionalCoverage.valid).toBe(false);
});

test("D) same visibility requirement becomes covered when an equivalent assertion exists", () => {
  const hu = [
    "Seleccionar un elemento del listado dinámico.",
    "Presionar Acción sensible.",
    "Mostrar mensaje de error.",
  ].join(" ");

  const uncovered = buildRequirementAccounting([], [], hu, "HU-TEST");
  const visUncovered = uncovered.requirements.find((r) => r.category === "visibility");
  expect(visUncovered!.status).toBe("incompleteRequirement");
  expect(uncovered.functionalCoverage.missing).toContain(visUncovered!.id);

  const coveringScenario = makeScenario("Muestra error", ['1. Validar que se muestre "mensaje de error".']);
  const covered = buildRequirementAccounting([coveringScenario], [], hu, "HU-TEST");
  const visCovered = covered.requirements.find((r) => r.category === "visibility");

  expect(visCovered!.status).toBe("covered");
  expect(covered.functionalCoverage.missing).not.toContain(visCovered!.id);
  expect(covered.functionalCoverage.valid).toBe(true);
});

test("VALIDAR ACCOUNTING FINAL — after covering the missing visibility: missing=0 valid=true, adaptive unchanged", () => {
  const hu = [
    "Seleccionar un elemento del listado dinámico.",
    "Presionar Acción sensible.",
    "Mostrar mensaje de error.",
    "Mostrar el resumen.",
  ].join(" ");

  const scenarioResumen = makeScenario("Resumen", ['1. Validar que se muestre "resumen".']);

  // Before: resumen covered, mensaje de error missing
  const before = buildRequirementAccounting([scenarioResumen], [], hu, "HU-TEST");
  expect(before.functionalCoverage.required).toBe(4);
  expect(before.functionalCoverage.covered).toBe(1);
  expect(before.summary.adaptive).toBe(2);
  expect(before.functionalCoverage.missing.length).toBe(1);
  expect(before.functionalCoverage.valid).toBe(false);

  // After: add scenario asserting "mensaje de error" → missing=0, valid=true,
  // WITHOUT converting any adaptive into covered.
  const scenarioError = makeScenario("Muestra error", ['1. Validar que se muestre "mensaje de error".']);
  const after = buildRequirementAccounting([scenarioResumen, scenarioError], [], hu, "HU-TEST");

  expect(after.functionalCoverage.required).toBe(4);
  expect(after.functionalCoverage.covered).toBe(2);
  expect(after.functionalCoverage.missing).toEqual([]);
  expect(after.functionalCoverage.valid).toBe(true);
  expect(after.summary.adaptive).toBe(2); // unchanged
  expect(after.requirements.filter((r) => r.status === "adaptive")).toHaveLength(2);
});

test("E) dynamic selection scenario 'el primer elemento visible' — no authority, adaptive", () => {
  const hu = "Seleccionar el primer elemento visible del listado.";
  const scenario = makeScenario("Primer elemento", ['1. Clic en "Primer elemento visible".']);

  const { requirements, functionalCoverage } = buildRequirementAccounting([scenario], [], hu, "HU-TEST");

  const dynamic = requirements.find((r) => r.category === "action");
  expect(dynamic).toBeDefined();
  // Dynamic selection is never a concrete execution-backed target: adaptive.
  expect(dynamic!.status).toBe("adaptive");
  expect(dynamic!.reasonCode).toBe("requires_runtime_materialization");
  // Not counted as missing (pending runtime materialization).
  expect(functionalCoverage.missing).not.toContain(dynamic!.id);
  // buildRequirementAccounting never touches allowedExecutableClicks / authority.
  expect(scenario.mcpExecutable).toBe(true); // authority decided elsewhere
});

test("ordinary uncovered concrete action stays missing (no blanket adaptive)", () => {
  const hu = "Seleccionar Alfa.";
  const { requirements, functionalCoverage } = buildRequirementAccounting([], [], hu, "HU-TEST");

  const action = requirements.find((r) => r.category === "action");
  expect(action).toBeDefined();
  expect(action!.status).toBe("incompleteRequirement");
  expect(action!.reasonCode).toBe("no_covering_scenario");
  expect(functionalCoverage.missing).toContain(action!.id);
  expect(functionalCoverage.valid).toBe(false);
});