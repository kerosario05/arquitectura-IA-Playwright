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

test("title fallback: title + assertion step → covered", () => {
  const hu = "visualizar la apntalla de inicio.";
  const scenarios = [
    makeScenario("Visualizar la pantalla inicial", ['1. Validar que se muestre "logo".']),
  ];
  expect(visibilityStatus(hu, scenarios)).toBe("covered");
});

test("title rejected: negative/error title has no visibility verb → not covered", () => {
  const hu = "visualizar la pantalla de inicio.";
  const scenarios = [
    makeScenario("Error al abrir pantalla de inicio", ['1. Validar que se muestre "mensaje de error".']),
  ];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});

test("title rejected: no assertion step → not covered", () => {
  const hu = "visualizar el panel principal.";
  const scenarios = [
    makeScenario("Visualizar panel principal", ['1. Clic en "X".']),
  ];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});

test("exact assertion match → covered (unchanged)", () => {
  const hu = "visualizar la pantalla de inicio.";
  const scenarios = [
    makeScenario("Inicio", ['1. Validar que se muestre "pantalla de inicio".']),
  ];
  expect(visibilityStatus(hu, scenarios)).toBe("covered");
});

test("token assertion match → covered (unchanged)", () => {
  const hu = "visualizar la apntalla de inicio.";
  const scenarios = [
    makeScenario("Bienvenida", ['1. Validar que se muestre "pantalla inicial".']),
  ];
  expect(visibilityStatus(hu, scenarios)).toBe("covered");
});

test("false positive preserved: single shared token not enough → not covered", () => {
  const hu = "visualizar la pantalla de inicio.";
  const scenarios = [
    makeScenario("Error", ['1. Validar que se muestre "pantalla de error".']),
  ];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});

test("false positive preserved: saldo vs salto → not covered", () => {
  const hu = "visualizar el saldo.";
  const scenarios = [
    makeScenario("Salto", ['1. Validar que se muestre "salto".']),
  ];
  expect(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
