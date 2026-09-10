import assert from "node:assert/strict";
import test from "node:test";
import { classifyScenarioAutomatability } from "./scenario-automatability-classifier";
import type { McpScenario } from "./scenario-types";

function scenario(overrides: Partial<McpScenario> = {}): McpScenario {
  return {
    sourceIssueKey: "synthetic-case",
    title: "Validar cédula con formato erróneo al agregar empleado manualmente",
    steps: [
      'Hacer clic en la opción "Gestión de nómina".',
      'Hacer clic en la opción "Crear Manualmente".',
      'Validar que se muestre una validación asociada al documento inválido.',
    ],
    preconditions: [],
    expectedResult: "La validación se muestra en la interfaz.",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "synthetic-app",
    routeProfile: "",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    ...overrides,
  };
}

test("business use of manual language remains UI-automatable", () => {
  const result = classifyScenarioAutomatability(scenario());
  assert.equal(result.isAutomatable, true);
  assert.equal(result.reasonCode, "automatable_ui");
});

test("explicit manual-only authority still blocks automation", () => {
  const result = classifyScenarioAutomatability(scenario({
    title: "Validación de documento",
    steps: ["Ejecutar el caso manual-only."],
    manualOnly: true,
  }));
  assert.equal(result.isAutomatable, false);
  assert.equal(result.classification, "non_automatable_manual");
  assert.equal(result.reasonCode, "manual_only_metadata");
});

test("manual validation intent remains supported as an explicit free-text rule", () => {
  const result = classifyScenarioAutomatability(scenario({
    title: "Validación manual",
    steps: ["Validar manualmente la pantalla visible."],
  }));
  assert.equal(result.isAutomatable, false);
  assert.equal(result.reasonCode, "manual_rule_match");
});
