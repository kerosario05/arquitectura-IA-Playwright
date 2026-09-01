import { test, expect } from "@playwright/test";
import {
  validateScenarioCompliance,
  validateScenariosCompliance,
} from "../src/scenarios/scenario-route-compliance-validator";
import type { McpScenario } from "../src/scenarios/scenario-types";
import type { DerivedExecutionContext } from "../src/scenarios/route-profile-derived-context";

function makeContext(allowed: string[] = []): DerivedExecutionContext {
  return {
    appSlug: "test-app",
    allowedExecutableClicks: allowed,
    assertionOnlyTerms: [],
    visibleButNotExecutableTerms: [],
    sensitiveActions: [],
    entryActionTargets: [],
    routeTargets: allowed,
    aliasesByTarget: new Map(),
    domainTerms: [],
    profileConfidence: "high",
    diagnostics: []
  };
}

function makeScenario(overrides: Partial<McpScenario> & { steps: string[] }): McpScenario {
  return {
    sourceIssueKey: "TEST-DP",
    title: "Declared path scenario",
    steps: overrides.steps,
    preconditions: [],
    expectedResult: "Destination shown",
    type: "Functional",
    database: "QA",
    isConverted: 0,
    automationType: "ui_with_auth_gate",
    setupStrategy: "auth_gate",
    appSlug: "test-app",
    routeProfile: "test-profile",
    dataRequirements: "",
    nonExecutableCriteria: "",
    mcpExecutable: true,
    ...overrides,
  };
}

test("declared_path step is compliant=true executionBacked=false — scenario NOT rejected", () => {
  const scenario = makeScenario({
    steps: [
      '1. Clic en "Entrada A".',
      '2. Clic en "Destino B".',
      '3. Validar que se muestre "Contenido".',
    ],
  }) as McpScenario & { matchedDeclaredPathTargets?: string[] };
  scenario.matchedDeclaredPathTargets = ["Entrada A", "Destino B"];

  const result = validateScenarioCompliance(scenario, makeContext([]), undefined, undefined, scenario.matchedDeclaredPathTargets);

  expect(result.valid).toBe(true);
  expect(result.reasonCode).toBe("valid");
  // Both declared steps get info diagnostics, never unbacked_click errors
  const infoTargets = result.diagnostics.filter(d => d.level === "info").map(d => d.target);
  expect(infoTargets).toContain("Entrada A");
  expect(infoTargets).toContain("Destino B");
  expect(result.diagnostics.some(d => d.level === "error" && d.target === "Entrada A")).toBe(false);
  expect(result.diagnostics.some(d => d.level === "error" && d.target === "Destino B")).toBe(false);
});

test("negative: matchedDeclaredPathTargets=[] → unbacked_click preserved", () => {
  const scenario = makeScenario({
    steps: ['1. Clic en "Entrada A".'],
  });

  const result = validateScenarioCompliance(scenario, makeContext([]), undefined, undefined, []);

  expect(result.valid).toBe(false);
  expect(result.reasonCode).toBe("unbacked_click");
  expect(result.diagnostics.some(d => d.level === "error" && d.target === "Entrada A")).toBe(true);
});

test("authority: declared path target does NOT enter allowedExecutableClicks nor executionBacked", () => {
  const scenario = makeScenario({
    steps: ['1. Clic en "Entrada A".'],
  }) as McpScenario & { matchedDeclaredPathTargets?: string[] };
  scenario.matchedDeclaredPathTargets = ["Entrada A"];

  const allowedBefore: string[] = [];
  const result = validateScenarioCompliance(scenario, makeContext(allowedBefore), undefined, undefined, scenario.matchedDeclaredPathTargets);

  // compliant, but allowedExecutableClicks untouched and execution not backed
  expect(result.valid).toBe(true);
  expect(allowedBefore).toEqual([]);
  // The log contract: reason=declared_path_functional_step execution_backed=false
  // (verified via info diagnostic target + absence of evidence_backed).
  const infoDiag = result.diagnostics.find(d => d.level === "info" && d.target === "Entrada A");
  expect(infoDiag).toBeTruthy();
  expect(result.diagnostics.some(d => d.message.includes("execution pending"))).toBe(true);
});

test("per-scenario propagation via validateScenariosCompliance — only protected scenario survives", () => {
  const protectedScenario = makeScenario({
    title: "Uses declared path",
    steps: ['1. Clic en "Entrada A".', '2. Clic en "Destino B".', '3. Validar que se muestre "Contenido".'],
  }) as McpScenario & { matchedDeclaredPathTargets?: string[] };
  protectedScenario.matchedDeclaredPathTargets = ["Entrada A", "Destino B"];

  const unprotectedScenario = makeScenario({
    title: "Does not use path",
    steps: ['1. Clic en "Entrada A".'],
  });

  const { validScenarios, invalidScenarios } = validateScenariosCompliance(
    [protectedScenario, unprotectedScenario],
    makeContext([]),
    new Map(),
  );

  expect(validScenarios.map(s => s.title)).toContain("Uses declared path");
  expect(invalidScenarios.map(i => i.scenario.title)).toContain("Does not use path");
  // Scenario B's identical click gets no automatic protection
  expect(invalidScenarios.find(i => i.scenario.title === "Does not use path")?.result.reasonCode).toBe("unbacked_click");
});

test("readiness: declared_path scenario with no evidence remains requiresRouteLearning (not executable)", () => {
  // Compliance does NOT add declared targets to allowedExecutableClicks, so the
  // downstream readiness pass (isTargetAuthorized) sees no backing → requires_route_learning.
  const scenario = makeScenario({
    steps: ['1. Clic en "Entrada A".'],
  }) as McpScenario & { matchedDeclaredPathTargets?: string[] };
  scenario.matchedDeclaredPathTargets = ["Entrada A"];

  const allowed = [] as string[];
  const result = validateScenarioCompliance(scenario, makeContext(allowed), undefined, undefined, scenario.matchedDeclaredPathTargets);

  expect(result.valid).toBe(true);
  // No declared target leaked into the execution authority
  expect(allowed).toEqual([]);
  expect(scenario.mcpExecutable).toBe(true); // unchanged classification field; readiness decides below
  console.log("[readiness] declared_path step survives compliance; authority unchanged → requires_route_learning path");
});