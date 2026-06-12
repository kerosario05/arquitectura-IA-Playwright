import { test, expect } from "@playwright/test";
import { buildDerivedExecutionContext } from "../src/scenarios/route-profile-derived-context";
import { validateScenarioCompliance } from "../src/scenarios/scenario-route-compliance-validator";
import type { McpRouteProfile, ScenarioRouteResolution, McpScenario } from "../src/scenarios/scenario-types";

test.describe("Enforcement: Content Clicks Prevention", () => {
  test("visibleControl without backing is NOT in allowedExecutableClicks", () => {
    const routeProfile: McpRouteProfile = {
      name: "test",
      entry: [{ visibleLabel: "Iniciar", businessLabel: "Inicio" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Beneficios", "Requisitos", "Información de productos"],
      representativeFixture: {},
      notes: []
    };

    const routeResolutions = new Map<string, ScenarioRouteResolution>();

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      routeResolutions,
      []
    );

    // Iniciar is in entry, so it should be allowed
    expect(derivedContext.allowedExecutableClicks).toContain("Iniciar");
    expect(derivedContext.allowedExecutableClicks).toContain("Inicio");

    // visibleControls should NOT be in allowedExecutableClicks by default
    expect(derivedContext.allowedExecutableClicks).not.toContain("Beneficios");
    expect(derivedContext.allowedExecutableClicks).not.toContain("Requisitos");
    expect(derivedContext.allowedExecutableClicks).not.toContain("Información de productos");

    // visibleControls should be in visibleButNotExecutableTerms
    expect(derivedContext.visibleButNotExecutableTerms).toContain("Beneficios");
    expect(derivedContext.visibleButNotExecutableTerms).toContain("Requisitos");
    expect(derivedContext.visibleButNotExecutableTerms).toContain("Información de productos");
  });

  test("visibleControl backed by executableRouteSteps IS in allowedExecutableClicks", () => {
    const routeProfile: McpRouteProfile = {
      name: "test",
      entry: [{ visibleLabel: "Iniciar", businessLabel: "Inicio" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Beneficios", "Información de productos"],
      representativeFixture: {},
      notes: []
    };

    const routeResolutions = new Map<string, ScenarioRouteResolution>();
    routeResolutions.set("TEST-1", {
      scenarioMode: "listing_validation",
      routeConfidence: "high",
      executableRouteSteps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Información de productos".'
      ],
      diagnostics: [],
      canGenerate: true
    });

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      routeResolutions,
      []
    );

    // Información de productos is backed by executableRouteSteps, so it should be allowed
    expect(derivedContext.allowedExecutableClicks).toContain("Información de productos");

    // Beneficios is NOT backed, so it should NOT be allowed
    expect(derivedContext.allowedExecutableClicks).not.toContain("Beneficios");

    // Beneficios should be in visibleButNotExecutableTerms
    expect(derivedContext.visibleButNotExecutableTerms).toContain("Beneficios");

    // Información de productos should NOT be in visibleButNotExecutableTerms (it's executable)
    expect(derivedContext.visibleButNotExecutableTerms).not.toContain("Información de productos");
  });

  test("content term click is rejected with content_term_used_as_click", () => {
    const mockScenario: McpScenario = {
      sourceIssueKey: "TEST-1",
      title: "Test scenario",
      steps: [
        "1. Clic en \"Iniciar\".",
        "2. Clic en \"Información de productos\".",
        "3. Clic en \"Beneficios\"."
      ],
      preconditions: [],
      expectedResult: "Test",
      type: "Functional",
      database: "",
      isConverted: 1,
      automationType: "ui",
      setupStrategy: "default",
      appSlug: "test-app",
      routeProfile: "test",
      dataRequirements: "",
      nonExecutableCriteria: "",
      mcpExecutable: true
    };

    const derivedContext = {
      appSlug: "test-app",
      allowedExecutableClicks: ["Iniciar", "Información de productos"],
      assertionOnlyTerms: [],
      visibleButNotExecutableTerms: ["Beneficios", "Requisitos"],
      sensitiveActions: [],
      entryActionTargets: ["Iniciar"],
      routeTargets: ["Iniciar", "Información de productos"],
      aliasesByTarget: new Map(),
      domainTerms: [],
      profileConfidence: "high" as const,
      diagnostics: []
    };

    const result = validateScenarioCompliance(mockScenario, derivedContext);

    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("content_term_used_as_click");
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].target).toBe("Beneficios");
    expect(result.diagnostics[0].message).toContain("visible content term but not executable");
  });

  test("content term validation is allowed", () => {
    const mockScenario: McpScenario = {
      sourceIssueKey: "TEST-1",
      title: "Test scenario",
      steps: [
        "1. Clic en \"Iniciar\".",
        "2. Clic en \"Información de productos\".",
        "3. Validar que se muestre \"Beneficios\"."
      ],
      preconditions: [],
      expectedResult: "Test",
      type: "Functional",
      database: "",
      isConverted: 1,
      automationType: "ui",
      setupStrategy: "default",
      appSlug: "test-app",
      routeProfile: "test",
      dataRequirements: "",
      nonExecutableCriteria: "",
      mcpExecutable: true
    };

    const derivedContext = {
      appSlug: "test-app",
      allowedExecutableClicks: ["Iniciar", "Información de productos"],
      assertionOnlyTerms: [],
      visibleButNotExecutableTerms: ["Beneficios", "Requisitos"],
      sensitiveActions: [],
      entryActionTargets: ["Iniciar"],
      routeTargets: ["Iniciar", "Información de productos"],
      aliasesByTarget: new Map(),
      domainTerms: [],
      profileConfidence: "high" as const,
      diagnostics: []
    };

    const result = validateScenarioCompliance(mockScenario, derivedContext);

    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBe("valid");
  });

  test("domainTerms without backing are NOT in allowedExecutableClicks", () => {
    const routeProfile: McpRouteProfile = {
      name: "test",
      entry: [{ visibleLabel: "Iniciar", businessLabel: "Inicio" }],
      aliases: {},
      intermediates: {},
      domainTerms: { "producto": "producto bancario", "tarjeta": "tarjeta de crédito" },
      visibleControls: [],
      representativeFixture: {},
      notes: []
    };

    const routeResolutions = new Map<string, ScenarioRouteResolution>();

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      routeResolutions,
      []
    );

    // domainTerms should NOT be in allowedExecutableClicks by default
    expect(derivedContext.allowedExecutableClicks).not.toContain("producto bancario");
    expect(derivedContext.allowedExecutableClicks).not.toContain("tarjeta de crédito");

    // domainTerms should be in visibleButNotExecutableTerms
    expect(derivedContext.visibleButNotExecutableTerms).toContain("producto bancario");
    expect(derivedContext.visibleButNotExecutableTerms).toContain("tarjeta de crédito");
  });

  test("intermediate targets ARE in allowedExecutableClicks", () => {
    const routeProfile: McpRouteProfile = {
      name: "test",
      entry: [{ visibleLabel: "Iniciar", businessLabel: "Inicio" }],
      aliases: {},
      intermediates: {
        "main_navigation": ["Productos", "Servicios", "Ayuda"]
      },
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: []
    };

    const routeResolutions = new Map<string, ScenarioRouteResolution>();

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      routeResolutions,
      []
    );

    // intermediates should be in allowedExecutableClicks (they are explicitly navigation)
    expect(derivedContext.allowedExecutableClicks).toContain("Productos");
    expect(derivedContext.allowedExecutableClicks).toContain("Servicios");
    expect(derivedContext.allowedExecutableClicks).toContain("Ayuda");
  });

  test("assertion-only terms identified by pattern", () => {
    const routeProfile: McpRouteProfile = {
      name: "test",
      entry: [{ visibleLabel: "Iniciar", businessLabel: "Inicio" }],
      aliases: {},
      intermediates: {},
      domainTerms: {
        "balance": "saldo disponible",
        "rate": "tasa de interés",
        "field": "campo de entrada"
      },
      visibleControls: [],
      representativeFixture: {},
      notes: []
    };

    const routeResolutions = new Map<string, ScenarioRouteResolution>();

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      routeResolutions,
      []
    );

    // Terms matching ASSERTION_ONLY_INDICATORS should be in assertionOnlyTerms
    expect(derivedContext.assertionOnlyTerms).toContain("saldo disponible");
    expect(derivedContext.assertionOnlyTerms).toContain("tasa de interés");
    expect(derivedContext.assertionOnlyTerms).toContain("campo de entrada");
  });
});
