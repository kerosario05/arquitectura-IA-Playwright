import { test, expect } from "@playwright/test";
import { generateDeterministicSeeds } from "../src/scenarios/scenario-deterministic-seeds";
import type { McpRouteProfile, McpScenario, JiraIssueSource } from "../src/scenarios/scenario-types";

test.describe("Deterministic Seed Generation", () => {
  // Mock issue context for tests
  const mockIssue: JiraIssueSource = {
    key: "TEST-1",
    summary: "Test products",
    description: "Test description with products",
    acceptanceCriteria: null,
    labels: [],
    components: [],
    status: "In Progress",
    issueType: "Story",
  };

  test("representative mode generates seeds for uncovered categories", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      targetPaths: {
        "Producto A": {
          target: "Producto A",
          requiredIntermediates: ["Inicio", "Productos"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría A",
            productLabel: "Producto A",
            normalizedLabel: "producto_a",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            detailSections: ["Detalles", "Requisitos"],
            actionButtons: ["Solicitar", "Volver"],
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(routeProfile, [], mockIssue, "test-app", "representative", { automationType: "ui_discovery", setupStrategy: "no_login" });

    // Representative mode now generates 1 seed per uncovered category
    expect(seeds.length).toBe(1);
  });

  test("exhaustive mode with no products returns no seeds", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
    };

    const seeds = generateDeterministicSeeds(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    expect(seeds.length).toBe(0);
  });

  test("exhaustive mode with null routeProfile returns no seeds", () => {
    const seeds = generateDeterministicSeeds(null, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    expect(seeds.length).toBe(0);
  });

  test("generates seed for uncovered detail_page product", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      intermediates: {},
      targetPaths: {
        "Producto A": {
          target: "Producto A",
          requiredIntermediates: ["Inicio", "Productos"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría A",
            productLabel: "Producto A",
            normalizedLabel: "producto_a",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
            detailSections: ["Detalles", "Requisitos"],
            actionButtons: ["Solicitar", "Volver"],
          },
        },
      },
    };

    const existingScenarios: McpScenario[] = [];

    const seeds = generateDeterministicSeeds(routeProfile, existingScenarios, mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    expect(seeds.length).toBe(1);
    expect(seeds[0].title).toContain("Producto A");
    expect(seeds[0].steps).toContain('1. Clic en "Inicio".');
    expect(seeds[0].steps).toContain('2. Clic en "Productos".');
    expect(seeds[0].steps).toContain('3. Clic en "Producto A".');
    expect(seeds[0].steps.some((s) => s.includes("Detalles"))).toBe(true);
    expect(seeds[0].steps.some((s) => s.includes("Requisitos"))).toBe(true);
    expect(seeds[0].steps.some((s) => s.includes("Solicitar"))).toBe(true);
    expect(seeds[0].steps.some((s) => s.includes("Volver"))).toBe(true);
  });

  test("generates seed for uncovered product_card (clickable)", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      intermediates: {},
      targetPaths: {
        "Tarjeta Gold": {
          target: "Tarjeta Gold",
          requiredIntermediates: ["Inicio", "Tarjetas"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Tarjetas",
            productLabel: "Tarjeta Gold",
            normalizedLabel: "tarjeta_gold",
            presentationType: "product_card",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: true,
            detailSections: ["Beneficios", "Condiciones"],
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    expect(seeds.length).toBe(1);
    expect(seeds[0].title).toContain("Tarjeta Gold");
    expect(seeds[0].steps).toContain('1. Clic en "Inicio".');
    expect(seeds[0].steps).toContain('2. Clic en "Tarjetas".');
    expect(seeds[0].steps.some((s) => s.includes('Validar que se muestre "Tarjeta Gold"'))).toBe(true);
    expect(seeds[0].steps.some((s) => s.includes('Clic en "Tarjeta Gold"'))).toBe(true);
    expect(seeds[0].steps.some((s) => s.includes("Beneficios"))).toBe(true);
  });

  test("generates seed for uncovered product_card (not clickable)", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      intermediates: {},
      targetPaths: {
        "Tarjeta Básica": {
          target: "Tarjeta Básica",
          requiredIntermediates: ["Inicio", "Tarjetas"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Tarjetas",
            productLabel: "Tarjeta Básica",
            normalizedLabel: "tarjeta_basica",
            presentationType: "product_card",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: false,
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    expect(seeds.length).toBe(1);
    expect(seeds[0].title).toContain("Tarjeta Básica");
    expect(seeds[0].steps).toContain('1. Clic en "Inicio".');
    expect(seeds[0].steps).toContain('2. Clic en "Tarjetas".');
    expect(seeds[0].steps.some((s) => s.includes('Validar que se muestre "Tarjeta Básica"'))).toBe(true);
    // Should NOT have click step for non-clickable card
    expect(seeds[0].steps.some((s) => s.includes('Clic en "Tarjeta Básica"'))).toBe(false);
  });

  test("skips products already covered by AI scenarios", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      intermediates: {},
      targetPaths: {
        "Producto A": {
          target: "Producto A",
          requiredIntermediates: ["Inicio"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría A",
            productLabel: "Producto A",
            normalizedLabel: "producto_a",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
          },
        },
        "Producto B": {
          target: "Producto B",
          requiredIntermediates: ["Inicio"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría B",
            productLabel: "Producto B",
            normalizedLabel: "producto_b",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
          },
        },
      },
    };

    const existingScenarios: McpScenario[] = [
      {
        title: "Visualizar Producto A",
        steps: ['1. Clic en "Inicio".', '2. Clic en "Producto A".'],
        expectedResult: "Se muestra el producto A",
        preconditions: [],
        appSlug: "test-app",
        routeProfile: "test-profile",
        dataRequirements: "",
        mcpExecutable: true,
        type: "functional",
        automationType: "automated",
        setupStrategy: "reuse_session",
        sourceIssueKey: "TEST-1",
        database: "",
        isConverted: 0,
        nonExecutableCriteria: "",
      },
    ];

    const seeds = generateDeterministicSeeds(routeProfile, existingScenarios, mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    // Should only generate seed for Producto B (Producto A is covered)
    expect(seeds.length).toBe(1);
    expect(seeds[0].title).toContain("Producto B");
  });

  test("skips products covered by validation steps in AI scenarios", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      intermediates: {},
      targetPaths: {
        "Producto A": {
          target: "Producto A",
          requiredIntermediates: ["Inicio"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría A",
            productLabel: "Producto A",
            normalizedLabel: "producto_a",
            presentationType: "product_card",
            discoveredAt: new Date().toISOString(),
            clickableToDetail: false,
          },
        },
      },
    };

    const existingScenarios: McpScenario[] = [
      {
        title: "Visualizar listado de productos",
        steps: ['1. Clic en "Inicio".', '2. Validar que se muestre "Producto A".'],
        expectedResult: "Se muestra el listado",
        preconditions: [],
        appSlug: "test-app",
        routeProfile: "test-profile",
        dataRequirements: "",
        mcpExecutable: true,
        type: "functional",
        automationType: "automated",
        setupStrategy: "reuse_session",
        sourceIssueKey: "TEST-1",
        database: "",
        isConverted: 0,
        nonExecutableCriteria: "",
      },
    ];

    const seeds = generateDeterministicSeeds(routeProfile, existingScenarios, mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    // Should not generate seed because Producto A is already validated
    expect(seeds.length).toBe(0);
  });

  test("generates multiple seeds for multiple uncovered products", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      intermediates: {},
      targetPaths: {
        "Producto A": {
          target: "Producto A",
          requiredIntermediates: ["Inicio"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría A",
            productLabel: "Producto A",
            normalizedLabel: "producto_a",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
          },
        },
        "Producto B": {
          target: "Producto B",
          requiredIntermediates: ["Inicio"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría B",
            productLabel: "Producto B",
            normalizedLabel: "producto_b",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
          },
        },
        "Producto C": {
          target: "Producto C",
          requiredIntermediates: ["Inicio"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría C",
            productLabel: "Producto C",
            normalizedLabel: "producto_c",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    expect(seeds.length).toBe(3);
    expect(seeds.map((s) => s.title)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Producto A"),
        expect.stringContaining("Producto B"),
        expect.stringContaining("Producto C"),
      ])
    );
  });

  test("seed scenarios have required fields for validation", () => {
    const routeProfile: McpRouteProfile = {
      name: "test-profile",
      entry: [],
      aliases: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
      intermediates: {},
      targetPaths: {
        "Producto A": {
          target: "Producto A",
          requiredIntermediates: ["Inicio"],
          confidence: "high",
          source: "runtime_discovery",
          productMetadata: {
            category: "Categoría A",
            productLabel: "Producto A",
            normalizedLabel: "producto_a",
            presentationType: "detail_page",
            discoveredAt: new Date().toISOString(),
          },
        },
      },
    };

    const seeds = generateDeterministicSeeds(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });

    expect(seeds.length).toBe(1);
    const seed = seeds[0];

    // Verify all required fields for validation
    expect(seed.title).toBeTruthy();
    expect(seed.steps).toBeTruthy();
    expect(seed.steps.length).toBeGreaterThan(0);
    expect(seed.expectedResult).toBeTruthy();
    expect(seed.preconditions).toBeTruthy();
    expect(seed.appSlug).toBe("test-app");
    expect(seed.routeProfile).toBe("test-profile");
    expect(seed.mcpExecutable).toBe(true);
    expect(seed.type).toBe("functional");
    expect(seed.automationType).toBe("ui_discovery"); // From appConfig
    expect(seed.setupStrategy).toBe("no_login"); // From appConfig
    expect(seed.sourceIssueKey).toBe("TEST-1"); // From HU (mockIssue.key), not "SEED"
    expect(seed.generationSource).toBe("deterministic_seed"); // Traceability
  });
});
