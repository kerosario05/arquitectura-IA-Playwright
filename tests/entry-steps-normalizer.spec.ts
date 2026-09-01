import { test, expect } from "@playwright/test";
import { insertEntrySteps, isEntryStepInsertionAuthorized, applyCanonicalRoutePrefix } from "../src/scenarios/scenario-preview.service";
import type { McpScenario } from "../src/scenarios/scenario-types";

function makeScenario(steps: string[]): McpScenario {
  return {
    sourceIssueKey: "AA-123",
    title: "Test scenario",
    steps,
    preconditions: [],
    expectedResult: "Test result",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "kiosko",
    routeProfile: "informacion_productos",
    dataRequirements: "cliente_fixture",
    nonExecutableCriteria: "",
    mcpExecutable: true,
  };
}

const entryBranch = {
  branchId: "branch-a",
  sourceLabel: "A",
  actionIntent: "select_option" as const,
  expectedDestination: "B",
  accessIntent: "public" as const,
  evidenceSource: "user_story" as const,
  prerequisiteRequirementIds: ["prerequisite:1"],
};

test("entry authority: assertion-only scenario rejects routeProfile entry", () => {
  const scenario = makeScenario(['1. Validar que se muestre "X".']);
  expect(isEntryStepInsertionAuthorized(scenario, [entryBranch])).toBe(false);
});

test("entry authority: snapshot/inferred entry does not authorize without refs", () => {
  const scenario = makeScenario(['1. Validar que se muestre "X".']);
  expect(isEntryStepInsertionAuthorized(scenario, [])).toBe(false);
});

test("entry authority: canonical prerequisite action authorizes trusted implementation", () => {
  const scenario = makeScenario(['1. Validar que se muestre "X".']);
  scenario.stepRequirementRefs = [{ stepIndex: 0, requirementId: "prerequisite:1", facet: "action" }];
  expect(isEntryStepInsertionAuthorized(scenario, [entryBranch])).toBe(true);
});

test("entry canonicalization preserves assertions-before-existing-action order", () => {
  const result = applyCanonicalRoutePrefix(
    ['1. Validar que se muestre "X".', '2. Clic en "A".'],
    [],
    [{ action: "click", target: "A", when: "before_first_functional_step" }],
  );
  expect(result.steps).toEqual(['1. Validar que se muestre "X".', '2. Clic en "A".']);
  expect(result.changed).toBe(false);
});

// ── Entry step insertion ──────────────────────────────────────────

test("insertEntrySteps: prepends all entry steps when none present", () => {
  const scenario = makeScenario([
    '1. Clic en "Información de productos".',
    '2. Validar que se muestre "Tarjetas de crédito".',
  ]);

  const result = insertEntrySteps(scenario, ["Iniciar", "Información de productos"]);

  expect(result.steps[0]).toBe('1. Clic en "Iniciar".');
  expect(result.steps[1]).toBe('2. Clic en "Información de productos".');
  expect(result.steps[2]).toBe('3. Validar que se muestre "Tarjetas de crédito".');
  expect(result.steps).toHaveLength(3);
});

test("insertEntrySteps: does not duplicate when entry steps already present", () => {
  const scenario = makeScenario([
    '1. Clic en "Iniciar".',
    '2. Clic en "Información de productos".',
    '3. Validar que se muestre "Tarjetas de crédito".',
  ]);

  const result = insertEntrySteps(scenario, ["Iniciar", "Información de productos"]);

  expect(result.steps).toEqual(scenario.steps);
  expect(result.steps).toHaveLength(3);
});

test("insertEntrySteps: inserts only missing prefix when scenario starts at step 2", () => {
  const scenario = makeScenario([
    '1. Clic en "Información de productos".',
    '2. Validar que se muestre "Tarjetas de crédito".',
  ]);

  const result = insertEntrySteps(scenario, ["Iniciar", "Información de productos"]);

  expect(result.steps[0]).toBe('1. Clic en "Iniciar".');
  expect(result.steps[1]).toBe('2. Clic en "Información de productos".');
  expect(result.steps[2]).toBe('3. Validar que se muestre "Tarjetas de crédito".');
  expect(result.steps).toHaveLength(3);
});

test("insertEntrySteps: handles three entry steps", () => {
  const scenario = makeScenario([
    '1. Validar que se muestre "Tarjetas de crédito".',
  ]);

  const result = insertEntrySteps(scenario, ["Iniciar", "Transacciones y servicios", "Tarjetas de crédito"]);

  expect(result.steps[0]).toBe('1. Clic en "Iniciar".');
  expect(result.steps[1]).toBe('2. Clic en "Transacciones y servicios".');
  expect(result.steps[2]).toBe('3. Clic en "Tarjetas de crédito".');
  expect(result.steps[3]).toBe('4. Validar que se muestre "Tarjetas de crédito".');
  expect(result.steps).toHaveLength(4);
});

test("insertEntrySteps: returns same scenario when no entry steps", () => {
  const scenario = makeScenario([
    '1. Clic en "Información de productos".',
  ]);

  const result = insertEntrySteps(scenario, []);

  expect(result).toBe(scenario);
});

test("insertEntrySteps: returns same scenario when no scenario steps", () => {
  const scenario = makeScenario([]);

  const result = insertEntrySteps(scenario, ["Iniciar"]);

  expect(result).toBe(scenario);
});

test("insertEntrySteps: renumbers steps correctly after insertion", () => {
  const scenario = makeScenario([
    '1. Clic en "Información de productos".',
    '2. Validar que se muestre "Tarjetas de crédito".',
    '3. Clic en "Volver".',
  ]);

  const result = insertEntrySteps(scenario, ["Iniciar", "Información de productos"]);

  expect(result.steps[0]).toBe('1. Clic en "Iniciar".');
  expect(result.steps[1]).toBe('2. Clic en "Información de productos".');
  expect(result.steps[2]).toBe('3. Validar que se muestre "Tarjetas de crédito".');
  expect(result.steps[3]).toBe('4. Clic en "Volver".');
  expect(result.steps).toHaveLength(4);
});

// ── Scenario appSlug normalization ────────────────────────────────

test("scenarios use targetAppSlug=kiosko for Detalle_KIOSKO", () => {
  // This is verified by the integration flow:
  // resolveAppForPreview({ testrailSectionName: "Detalle_KIOSKO" }) → kiosko
  // Then normalizeScenariosToTargetApp forces appSlug=kiosko
  const { resolveAppForPreview } = require("../src/automations/app-auto-resolver");
  const result = resolveAppForPreview({
    testrailSectionName: "Detalle_KIOSKO",
    requestAppSlug: "arquitectura-automatizacion",
  });
  expect(result.appSlug).toBe("kiosko");
  expect(result.appName).toBe("KIOSKO");
  expect(result.source).toBe("testrail_section");
  expect(result.confidence).toBe("high");
});
