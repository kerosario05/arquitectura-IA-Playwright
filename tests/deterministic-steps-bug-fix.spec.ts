import { test, expect } from "@playwright/test";
import { ensureStepStrings, formatExecutableStep, normalizeScenarioSteps } from "../src/scenarios/step-formatter";
import { buildDerivedExecutionContext } from "../src/scenarios/route-profile-derived-context";
import { validateScenarioCompliance } from "../src/scenarios/scenario-route-compliance-validator";
import type {
  McpRouteProfile,
  McpScenario,
  ScenarioRouteResolution,
} from "../src/scenarios/scenario-types";

test.describe("Deterministic Steps Format Bug Fix", () => {
  test("converts object steps to string steps", () => {
    const objectSteps = [
      { action: "click", target: "Iniciar", description: 'Clic en "Iniciar".' },
      { action: "click", target: "Productos", description: 'Clic en "Productos".' },
      { action: "assert", target: "Lista", description: 'Validar que se muestre "Lista".' },
    ];

    const stringSteps = ensureStepStrings(objectSteps);

    expect(stringSteps).toHaveLength(3);
    expect(stringSteps[0]).toBe('1. Clic en "Iniciar".');
    expect(stringSteps[1]).toBe('2. Clic en "Productos".');
    expect(stringSteps[2]).toBe('3. Validar que se muestre "Lista".');
  });

  test("formatExecutableStep handles different action types", () => {
    expect(formatExecutableStep({ action: "click", target: "Button" }, 1)).toBe(
      '1. Clic en "Button".'
    );

    expect(formatExecutableStep({ action: "assert_visible", target: "Text" }, 2)).toBe(
      '2. Validar que se muestre "Text".'
    );

    expect(
      formatExecutableStep({ action: "assert_button_visible", target: "Submit" }, 3)
    ).toBe('3. Validar que el botón "Submit" esté visible.');

    expect(formatExecutableStep({ action: "select_ordinal", target: "producto" }, 4)).toBe(
      "4. Seleccionar el primer producto visible del listado."
    );
  });

  test("formatExecutableStep preserves string steps with correct numbering", () => {
    const step = '5. Clic en "Target".';
    const formatted = formatExecutableStep(step, 1);

    expect(formatted).toBe('1. Clic en "Target".');
  });

  test("normalizeScenarioSteps handles mixed formats", () => {
    const scenario = {
      sourceIssueKey: "TEST-1",
      title: "Test",
      steps: [
        '1. Clic en "A".',
        { action: "click", target: "B", description: 'Clic en "B".' },
        '3. Validar que se muestre "C".',
      ],
    };

    const normalized = normalizeScenarioSteps(scenario);

    expect(normalized.steps).toHaveLength(3);
    expect(normalized.steps[0]).toBe('1. Clic en "A".');
    expect(normalized.steps[1]).toBe('2. Clic en "B".');
    expect(normalized.steps[2]).toBe('3. Validar que se muestre "C".');
  });

  test("does not throw step.match is not a function error", () => {
    const scenario = {
      sourceIssueKey: "TEST-1",
      title: "Test",
      steps: [
        { action: "click", target: "Iniciar", description: 'Clic en "Iniciar".' },
        { action: "assert", target: "Result", description: 'Validar que se muestre "Result".' },
      ],
    };

    // This should not throw
    const normalized = normalizeScenarioSteps(scenario);

    expect(normalized.steps).toHaveLength(2);
    expect(typeof normalized.steps[0]).toBe("string");
    expect(typeof normalized.steps[1]).toBe("string");
  });
});

test.describe("AllowedExecutableClicks Classification Fix", () => {
  test("visibleControl without explicit backing NOT in allowedExecutableClicks", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Beneficios", "Requisitos", "Productos"], // Not backed
      representativeFixture: {},
      notes: [],
    };

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      new Map(),
      []
    );

    // Entry should be allowed
    expect(derivedContext.allowedExecutableClicks).toContain("Iniciar");

    // Visible controls without backing should NOT be in allowedExecutableClicks
    expect(derivedContext.allowedExecutableClicks).not.toContain("Beneficios");
    expect(derivedContext.allowedExecutableClicks).not.toContain("Requisitos");
    expect(derivedContext.allowedExecutableClicks).not.toContain("Productos");

    // They should be in visibleButNotExecutableTerms
    expect(derivedContext.visibleButNotExecutableTerms).toContain("Beneficios");
    expect(derivedContext.visibleButNotExecutableTerms).toContain("Requisitos");
    expect(derivedContext.visibleButNotExecutableTerms).toContain("Productos");
  });

  test("content term in visibleControls rejected as click", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Beneficios", "Información de productos"],
      representativeFixture: {},
      notes: [],
    };

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      new Map(),
      []
    );

    const scenario: McpScenario = {
      sourceIssueKey: "TEST-1",
      title: "Test",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Beneficios".', // Should be rejected
      ],
      preconditions: [],
      expectedResult: "Test",
      type: "Functional",
      database: "",
      isConverted: 1,
      automationType: "ui",
      setupStrategy: "default",
      appSlug: "test-app",
      routeProfile: "test-profile",
      dataRequirements: "",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const result = validateScenarioCompliance(scenario, derivedContext);

    expect(result.valid).toBe(false);
    expect(result.reasonCode).toBe("content_term_used_as_click");
  });

  test("content term as validation is allowed", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Beneficios"],
      representativeFixture: {},
      notes: [],
    };

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      new Map(),
      []
    );

    const scenario: McpScenario = {
      sourceIssueKey: "TEST-1",
      title: "Test",
      steps: [
        '1. Clic en "Iniciar".',
        '2. Validar que se muestre "Beneficios".', // Should be allowed
      ],
      preconditions: [],
      expectedResult: "Test",
      type: "Functional",
      database: "",
      isConverted: 1,
      automationType: "ui",
      setupStrategy: "default",
      appSlug: "test-app",
      routeProfile: "test-profile",
      dataRequirements: "",
      nonExecutableCriteria: "",
      mcpExecutable: true,
    };

    const result = validateScenarioCompliance(scenario, derivedContext);

    expect(result.valid).toBe(true);
    expect(result.reasonCode).toBe("valid");
  });

  test("targetPath steps ARE in allowedExecutableClicks", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Cuentas de Efectivo"],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Cuentas de Efectivo": {
          target: "Cuentas de Efectivo",
          requiredIntermediates: ["Información de productos", "Cuentas"],
          confidence: "high",
          source: "manual",
        },
      },
    };

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      new Map(),
      []
    );

    // Target and intermediates should be in allowedExecutableClicks
    expect(derivedContext.allowedExecutableClicks).toContain("Información de productos");
    expect(derivedContext.allowedExecutableClicks).toContain("Cuentas");
    expect(derivedContext.allowedExecutableClicks).toContain("Cuentas de Efectivo");

    // Check sources
    expect(derivedContext.clickSources?.get("Información de productos")).toBe("targetPath");
    expect(derivedContext.clickSources?.get("Cuentas")).toBe("targetPath");
    expect(derivedContext.clickSources?.get("Cuentas de Efectivo")).toBe("targetPath");
  });

  test("intermediate steps ARE in allowedExecutableClicks", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {
        productos: ["Información de productos", "Tarjetas", "Tarjetas de crédito"],
      },
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
    };

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      new Map(),
      []
    );

    // All intermediates should be in allowedExecutableClicks
    expect(derivedContext.allowedExecutableClicks).toContain("Información de productos");
    expect(derivedContext.allowedExecutableClicks).toContain("Tarjetas");
    expect(derivedContext.allowedExecutableClicks).toContain("Tarjetas de crédito");

    // Check sources
    expect(derivedContext.clickSources?.get("Información de productos")).toBe(
      "intermediate"
    );
    expect(derivedContext.clickSources?.get("Tarjetas")).toBe("intermediate");
    expect(derivedContext.clickSources?.get("Tarjetas de crédito")).toBe("intermediate");
  });

  test("executableRouteSteps ARE in allowedExecutableClicks", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
    };

    const routeResolution: ScenarioRouteResolution = {
      scenarioMode: "detail_navigation",
      routeConfidence: "high",
      executableRouteSteps: [
        '1. Clic en "Iniciar".',
        '2. Clic en "Productos".',
        '3. Clic en "Ver detalles".',
      ],
      diagnostics: [],
      canGenerate: true,
    };

    const derivedContext = buildDerivedExecutionContext(
      "test-app",
      routeProfile,
      new Map([["TEST-1", routeResolution]]),
      []
    );

    // Targets from executableRouteSteps should be in allowedExecutableClicks
    expect(derivedContext.allowedExecutableClicks).toContain("Productos");
    expect(derivedContext.allowedExecutableClicks).toContain("Ver detalles");

    // Check sources
    expect(derivedContext.clickSources?.get("Productos")).toBe("executableRouteStep");
    expect(derivedContext.clickSources?.get("Ver detalles")).toBe("executableRouteStep");
  });

  test("multiproject solution without hardcoded targets", () => {
    // Test with two different apps
    const profileA: McpRouteProfile = {
      name: "retail-profile",
      entry: [{ businessLabel: "home", visibleLabel: "Start" }],
      aliases: {},
      intermediates: { nav: ["Products", "Categories"] },
      domainTerms: {},
      visibleControls: ["Featured", "Deals"], // Not backed
      representativeFixture: {},
      notes: [],
    };

    const profileB: McpRouteProfile = {
      name: "banking-profile",
      entry: [{ businessLabel: "inicio", visibleLabel: "Comenzar" }],
      aliases: {},
      intermediates: { nav: ["Servicios", "Cuentas"] },
      domainTerms: {},
      visibleControls: ["Beneficios", "Tasas"], // Not backed
      representativeFixture: {},
      notes: [],
    };

    const contextA = buildDerivedExecutionContext("retail-app", profileA, new Map(), []);
    const contextB = buildDerivedExecutionContext("banking-app", profileB, new Map(), []);

    // App A: intermediates are allowed, visibleControls are not
    expect(contextA.allowedExecutableClicks).toContain("Products");
    expect(contextA.allowedExecutableClicks).toContain("Categories");
    expect(contextA.allowedExecutableClicks).not.toContain("Featured");
    expect(contextA.allowedExecutableClicks).not.toContain("Deals");

    // App B: intermediates are allowed, visibleControls are not
    expect(contextB.allowedExecutableClicks).toContain("Servicios");
    expect(contextB.allowedExecutableClicks).toContain("Cuentas");
    expect(contextB.allowedExecutableClicks).not.toContain("Beneficios");
    expect(contextB.allowedExecutableClicks).not.toContain("Tasas");

    // Isolation: App A terms not in App B
    expect(contextB.allowedExecutableClicks).not.toContain("Products");
    expect(contextB.allowedExecutableClicks).not.toContain("Featured");
  });
});
