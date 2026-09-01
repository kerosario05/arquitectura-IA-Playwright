import { test, expect } from "@playwright/test";
import {
  normalizeInventedOrdinalSelection,
  applyFunctionalScenarioQuality,
  buildRequirementAccounting,
} from "../src/scenarios/scenario-functional-quality";
import type { McpScenario } from "../src/scenarios/scenario-types";

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

test("invented ordinal removed, functional noun preserved", () => {
  const hu = "Seleccionar un préstamo del listado.";
  const step = "Seleccionar el primer préstamo visible del listado";
  const result = normalizeInventedOrdinalSelection(step, hu);
  expect(result).toBe("Seleccionar un préstamo visible del listado");
});

test("ordinal declared by HU is preserved", () => {
  const hu = "Seleccionar la primera opción del listado.";
  const step = "Seleccionar la primera opción del listado";
  const result = normalizeInventedOrdinalSelection(step, hu);
  expect(result).toBe(step);
});

test("invented ordinal with feminine noun normalized", () => {
  const hu = "Seleccionar una cuenta.";
  const step = "Seleccionar la primera cuenta";
  const result = normalizeInventedOrdinalSelection(step, hu);
  expect(result).toBe("Seleccionar una cuenta");
});

test("non-ordinal concrete selection unchanged", () => {
  const hu = "Seleccionar producto.";
  const step = "Seleccionar producto";
  expect(normalizeInventedOrdinalSelection(step, hu)).toBe(step);
});

test("quality pass normalizes steps in scenarios; accounting stays adaptive without authority", () => {
  const hu = "Seleccionar un préstamo del listado.";
  const scenario = makeScenario("Selecciona préstamo", ["Seleccionar el primer préstamo visible del listado."]);

  const quality = applyFunctionalScenarioQuality([scenario], [], hu);
  const out = quality.scenarios[0];
  expect(out.steps).toContain("Seleccionar un préstamo visible del listado.");

  // Accounting: dynamic selection stays adaptive / requires_runtime_materialization
  const accounting = buildRequirementAccounting(out.steps ? [out] : [], [], hu, "HU-TEST");
  const dynamic = accounting.requirements.find((r) => r.category === "action");
  expect(dynamic).toBeDefined();
  expect(dynamic!.status).toBe("adaptive");
  expect(dynamic!.reasonCode).toBe("requires_runtime_materialization");
  expect(accounting.functionalCoverage.missing).not.toContain(dynamic!.id);
  // No authority introduced: accounting never touches allowedExecutableClicks
  expect(accounting.summary.adaptive).toBeGreaterThanOrEqual(1);
  expect(out.mcpExecutable).toBe(true); // execution backing decided elsewhere
});