"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_deterministic_seeds_1 = require("../src/scenarios/scenario-deterministic-seeds");
test_1.test.describe("Deterministic Seed Generation", () => {
    // Mock issue context for tests
    const mockIssue = {
        key: "TEST-1",
        summary: "Test products",
        description: "Test description with products",
        acceptanceCriteria: null,
        labels: [],
        components: [],
        status: "In Progress",
        issueType: "Story",
    };
    (0, test_1.test)("representative mode generates seeds for uncovered categories", () => {
        const routeProfile = {
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
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, [], mockIssue, "test-app", "representative", { automationType: "ui_discovery", setupStrategy: "no_login" });
        // Representative mode now generates 1 seed per uncovered category
        (0, test_1.expect)(seeds.length).toBe(1);
    });
    (0, test_1.test)("exhaustive mode with no products returns no seeds", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: [],
        };
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        (0, test_1.expect)(seeds.length).toBe(0);
    });
    (0, test_1.test)("exhaustive mode with null routeProfile returns no seeds", () => {
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(null, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        (0, test_1.expect)(seeds.length).toBe(0);
    });
    (0, test_1.test)("generates seed for uncovered detail_page product", () => {
        const routeProfile = {
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
        const existingScenarios = [];
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, existingScenarios, mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        (0, test_1.expect)(seeds.length).toBe(1);
        (0, test_1.expect)(seeds[0].title).toContain("Producto A");
        (0, test_1.expect)(seeds[0].steps).toContain('1. Clic en "Inicio".');
        (0, test_1.expect)(seeds[0].steps).toContain('2. Clic en "Productos".');
        (0, test_1.expect)(seeds[0].steps).toContain('3. Clic en "Producto A".');
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes("Detalles"))).toBe(true);
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes("Requisitos"))).toBe(true);
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes("Solicitar"))).toBe(true);
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes("Volver"))).toBe(true);
    });
    (0, test_1.test)("generates seed for uncovered product_card (clickable)", () => {
        const routeProfile = {
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
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        (0, test_1.expect)(seeds.length).toBe(1);
        (0, test_1.expect)(seeds[0].title).toContain("Tarjeta Gold");
        (0, test_1.expect)(seeds[0].steps).toContain('1. Clic en "Inicio".');
        (0, test_1.expect)(seeds[0].steps).toContain('2. Clic en "Tarjetas".');
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes('Validar que se muestre "Tarjeta Gold"'))).toBe(true);
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes('Clic en "Tarjeta Gold"'))).toBe(true);
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes("Beneficios"))).toBe(true);
    });
    (0, test_1.test)("generates seed for uncovered product_card (not clickable)", () => {
        const routeProfile = {
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
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        (0, test_1.expect)(seeds.length).toBe(1);
        (0, test_1.expect)(seeds[0].title).toContain("Tarjeta Básica");
        (0, test_1.expect)(seeds[0].steps).toContain('1. Clic en "Inicio".');
        (0, test_1.expect)(seeds[0].steps).toContain('2. Clic en "Tarjetas".');
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes('Validar que se muestre "Tarjeta Básica"'))).toBe(true);
        // Should NOT have click step for non-clickable card
        (0, test_1.expect)(seeds[0].steps.some((s) => s.includes('Clic en "Tarjeta Básica"'))).toBe(false);
    });
    (0, test_1.test)("skips products already covered by AI scenarios", () => {
        const routeProfile = {
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
        const existingScenarios = [
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
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, existingScenarios, mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        // Should only generate seed for Producto B (Producto A is covered)
        (0, test_1.expect)(seeds.length).toBe(1);
        (0, test_1.expect)(seeds[0].title).toContain("Producto B");
    });
    (0, test_1.test)("skips products covered by validation steps in AI scenarios", () => {
        const routeProfile = {
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
        const existingScenarios = [
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
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, existingScenarios, mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        // Should not generate seed because Producto A is already validated
        (0, test_1.expect)(seeds.length).toBe(0);
    });
    (0, test_1.test)("generates multiple seeds for multiple uncovered products", () => {
        const routeProfile = {
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
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        (0, test_1.expect)(seeds.length).toBe(3);
        (0, test_1.expect)(seeds.map((s) => s.title)).toEqual(test_1.expect.arrayContaining([
            test_1.expect.stringContaining("Producto A"),
            test_1.expect.stringContaining("Producto B"),
            test_1.expect.stringContaining("Producto C"),
        ]));
    });
    (0, test_1.test)("seed scenarios have required fields for validation", () => {
        const routeProfile = {
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
        const seeds = (0, scenario_deterministic_seeds_1.generateDeterministicSeeds)(routeProfile, [], mockIssue, "test-app", "exhaustive", { automationType: "ui_discovery", setupStrategy: "no_login" });
        (0, test_1.expect)(seeds.length).toBe(1);
        const seed = seeds[0];
        // Verify all required fields for validation
        (0, test_1.expect)(seed.title).toBeTruthy();
        (0, test_1.expect)(seed.steps).toBeTruthy();
        (0, test_1.expect)(seed.steps.length).toBeGreaterThan(0);
        (0, test_1.expect)(seed.expectedResult).toBeTruthy();
        (0, test_1.expect)(seed.preconditions).toBeTruthy();
        (0, test_1.expect)(seed.appSlug).toBe("test-app");
        (0, test_1.expect)(seed.routeProfile).toBe("test-profile");
        (0, test_1.expect)(seed.mcpExecutable).toBe(true);
        (0, test_1.expect)(seed.type).toBe("functional");
        (0, test_1.expect)(seed.automationType).toBe("ui_discovery"); // From appConfig
        (0, test_1.expect)(seed.setupStrategy).toBe("no_login"); // From appConfig
        (0, test_1.expect)(seed.sourceIssueKey).toBe("TEST-1"); // From HU (mockIssue.key), not "SEED"
        (0, test_1.expect)(seed.generationSource).toBe("deterministic_seed"); // Traceability
    });
});
