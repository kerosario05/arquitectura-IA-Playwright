import { expect, test } from "@playwright/test";
import { buildRequirementAccounting } from "../src/scenarios/scenario-functional-quality";
import type { McpScenario } from "../src/scenarios/scenario-types";

function makeScenario(title: string, steps: string[]): McpScenario {
  return {
    sourceIssueKey: "HU-VIS",
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

function visibilityStatus(hu: string, scenarios: McpScenario[]): string {
  const { requirements } = buildRequirementAccounting(scenarios, [], hu, "HU-VIS");
  const vis = requirements.find((r) => r.category === "visibility");
  expect(vis, "visibility requirement must exist").toBeTruthy();
  return vis!.status;
}

test("typo-near + morphological variant: 'apntalla de inicio' covered by 'pantalla inicial'", () => {
  const hu = "visualizar la apntalla de inicio.";
  const scenarios = [makeScenario("Bienvenida", ['1. Validar que se muestre "pantalla inicial".'])];
  expect(visibilityStatus(hu, scenarios)).toBe("covered");
});

test("exact existing match remains covered", () => {
  const hu = "visualizar la pantalla de inicio.";
  const scenarios = [makeScenario("Inicio", ['1. Validar que se muestre "pantalla de inicio".'])];
  expect(visibilityStatus(hu, scenarios)).toBe("covered");
});

test("single shared generic token is NOT enough: 'pantalla de inicio' vs 'pantalla de error'", () => {
  const hu = "visualizar la pantalla de inicio.";
  const scenarios = [makeScenario("Error", ['1. Validar que se muestre "pantalla de error".'])];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});

test("distinct business terms NOT conflated: 'pantalla de selección' vs 'pantalla de inicio'", () => {
  const hu = "visualizar la pantalla de selección.";
  const scenarios = [makeScenario("Inicio", ['1. Validar que se muestre "pantalla de inicio".'])];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});

test("distinct business terms NOT conflated: 'mensaje de bienvenida' vs 'mensaje de error'", () => {
  const hu = "visualizar el mensaje de bienvenida.";
  const scenarios = [makeScenario("Error", ['1. Validar que se muestre "mensaje de error".'])];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});

test("tokens from different assertions are never mixed → false", () => {
  const hu = "visualizar la apntalla de inicio.";
  const scenarios = [
    makeScenario("Split A", ['1. Validar que se muestre "pantalla".', '2. Validar que se muestre "inicial".']),
  ];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});

test("generic false-positive: 'saldo' vs 'salto' must NOT match", () => {
  const hu = "visualizar el saldo.";
  const scenarios = [makeScenario("Salto", ['1. Validar que se muestre "salto".'])];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});

test("generic false-positive: 'estado' vs 'estufa' must NOT match", () => {
  const hu = "visualizar el estado.";
  const scenarios = [makeScenario("Estufa", ['1. Validar que se muestre "estufa".'])];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});