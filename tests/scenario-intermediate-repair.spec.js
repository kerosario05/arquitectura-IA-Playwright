"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_intermediate_repair_1 = require("../src/scenarios/scenario-intermediate-repair");
const route_profile_derived_context_1 = require("../src/scenarios/route-profile-derived-context");
test_1.test.describe("Scenario Intermediate Step Resolution and Repair", () => {
    (0, test_1.test)("inserts required intermediate before target final", () => {
        // Setup: Route profile with explicit targetPaths
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {
                productos: ["Información de productos", "Cuentas", "Cuentas de Efectivo"],
            },
            domainTerms: {},
            visibleControls: ["Pesos", "Dólares", "Euros"],
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
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), ["Iniciar"]);
        // Scenario with missing intermediate
        const scenario = {
            sourceIssueKey: "TEST-1",
            title: "Test scenario",
            steps: [
                '1. Clic en "Iniciar".',
                '2. Clic en "Información de productos".',
                '3. Clic en "Cuentas de Efectivo".', // Missing "Cuentas" intermediate
                '4. Validar que se muestre "Pesos".',
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
        const repairResult = (0, scenario_intermediate_repair_1.repairMissingIntermediates)(scenario, routeProfile, derivedContext, undefined, "medium");
        (0, test_1.expect)(repairResult.repaired).toBe(true);
        (0, test_1.expect)(repairResult.insertedCount).toBe(1);
        (0, test_1.expect)(repairResult.reasonCode).toBe("missing_intermediate_step_repaired");
        // Check that "Cuentas" was inserted
        const repairedSteps = repairResult.repairedSteps;
        (0, test_1.expect)(repairedSteps).toContain('3. Clic en "Cuentas".');
        (0, test_1.expect)(repairedSteps).toContain('4. Clic en "Cuentas de Efectivo".');
        (0, test_1.expect)(repairedSteps).toContain('5. Validar que se muestre "Pesos".');
        // Check diagnostic
        const insertDiag = repairResult.diagnostics.find((d) => d.decision === "inserted");
        (0, test_1.expect)(insertDiag).toBeDefined();
        (0, test_1.expect)(insertDiag?.insertedIntermediate).toBe("Cuentas");
    });
    (0, test_1.test)("no insertion if intermediate already present", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {
                productos: ["Información de productos", "Cuentas", "Cuentas de Efectivo"],
            },
            domainTerms: {},
            visibleControls: ["Pesos"],
            representativeFixture: {},
            notes: [],
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), ["Iniciar"]);
        // Scenario with complete path
        const scenario = {
            sourceIssueKey: "TEST-2",
            title: "Complete path scenario",
            steps: [
                '1. Clic en "Iniciar".',
                '2. Clic en "Información de productos".',
                '3. Clic en "Cuentas".',
                '4. Clic en "Cuentas de Efectivo".',
                '5. Validar que se muestre "Pesos".',
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
        const repairResult = (0, scenario_intermediate_repair_1.repairMissingIntermediates)(scenario, routeProfile, derivedContext, undefined, "medium");
        (0, test_1.expect)(repairResult.repaired).toBe(false);
        (0, test_1.expect)(repairResult.insertedCount).toBe(0);
        (0, test_1.expect)(repairResult.reasonCode).toBe("no_repair_needed");
    });
    (0, test_1.test)("rejects if missing intermediate and no reliable path", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {}, // No intermediates defined
            domainTerms: {},
            visibleControls: ["Cuentas de Efectivo", "Pesos"],
            representativeFixture: {},
            notes: [],
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), ["Iniciar"]);
        // Scenario with missing intermediate and no path
        const scenario = {
            sourceIssueKey: "TEST-3",
            title: "Unresolvable path scenario",
            steps: [
                '1. Clic en "Iniciar".',
                '2. Clic en "Información de productos".',
                '3. Clic en "Cuentas de Efectivo".', // Missing intermediate but no path defined
                '4. Validar que se muestre "Pesos".',
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
        const repairResult = (0, scenario_intermediate_repair_1.repairMissingIntermediates)(scenario, routeProfile, derivedContext, undefined, "medium");
        (0, test_1.expect)(repairResult.repaired).toBe(false);
        (0, test_1.expect)(repairResult.reasonCode).toBe("unresolvable_path");
        const errorDiag = repairResult.diagnostics.find((d) => d.level === "error");
        (0, test_1.expect)(errorDiag).toBeDefined();
        (0, test_1.expect)(errorDiag?.decision).toBe("rejected_unresolvable");
    });
    (0, test_1.test)("does not insert assertionOnlyTerm as intermediate", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {
                saldo: "saldo disponible", // Assertion-only term
            },
            visibleControls: ["Cuentas", "saldo disponible"],
            representativeFixture: {},
            notes: [],
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), ["Iniciar"]);
        // Verify saldo is in assertionOnlyTerms
        (0, test_1.expect)(derivedContext.assertionOnlyTerms).toContain("saldo disponible");
        // Verify saldo is NOT in allowedExecutableClicks
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("saldo disponible");
    });
    (0, test_1.test)("does not insert sensitiveAction as intermediate", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Cuentas", "Solicitar", "Pagar"],
            representativeFixture: {},
            notes: [],
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), ["Iniciar"]);
        // Verify sensitive actions are identified
        (0, test_1.expect)(derivedContext.sensitiveActions).toContain("Solicitar");
        (0, test_1.expect)(derivedContext.sensitiveActions).toContain("Pagar");
        // Verify sensitive actions are NOT in allowedExecutableClicks by default
        // (unless explicitly backed by entry/intermediates/executableRouteSteps)
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Solicitar");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Pagar");
    });
    (0, test_1.test)("supports normalized labels and mojibake", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {
                productos: ["Información de productos", "Tarjetas", "Tarjetas de crédito"],
            },
            domainTerms: {},
            visibleControls: ["Beneficios"],
            representativeFixture: {},
            notes: [],
            targetPaths: {
                "Tarjetas de crédito": {
                    target: "Tarjetas de crédito",
                    requiredIntermediates: ["Información de productos", "Tarjetas"],
                    confidence: "high",
                    source: "manual",
                },
            },
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), ["Iniciar"]);
        // Scenario with mojibake/accent variations
        const scenario = {
            sourceIssueKey: "TEST-4",
            title: "Normalization test",
            steps: [
                '1. Clic en "Iniciar".',
                '2. Clic en "Informacion de productos".', // Missing accent
                '3. Clic en "Tarjetas de credito".', // Missing accent
                '4. Validar que se muestre "Beneficios".',
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
        const repairResult = (0, scenario_intermediate_repair_1.repairMissingIntermediates)(scenario, routeProfile, derivedContext, undefined, "medium");
        // Should insert "Tarjetas" intermediate despite accent variations
        (0, test_1.expect)(repairResult.repaired).toBe(true);
        (0, test_1.expect)(repairResult.insertedCount).toBe(1);
        const repairedSteps = repairResult.repairedSteps;
        (0, test_1.expect)(repairedSteps).toContain('3. Clic en "Tarjetas".');
    });
    (0, test_1.test)("multi-project works without hardcoded targets", () => {
        // Test with two completely different app profiles
        const profileA = {
            name: "retail-profile",
            entry: [{ businessLabel: "home", visibleLabel: "Start" }],
            aliases: {},
            intermediates: {
                shopping: ["Products", "Electronics", "Smartphones"],
            },
            domainTerms: {},
            visibleControls: ["iPhone", "Samsung", "Price"],
            representativeFixture: {},
            notes: [],
            targetPaths: {
                Smartphones: {
                    target: "Smartphones",
                    requiredIntermediates: ["Products", "Electronics"],
                    confidence: "high",
                    source: "manual",
                },
            },
        };
        const profileB = {
            name: "banking-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Comenzar" }],
            aliases: {},
            intermediates: {
                servicios: ["Servicios", "Inversiones", "Fondos"],
            },
            domainTerms: {},
            visibleControls: ["Renta Fija", "Renta Variable", "Tasas"],
            representativeFixture: {},
            notes: [],
            targetPaths: {
                Fondos: {
                    target: "Fondos",
                    requiredIntermediates: ["Servicios", "Inversiones"],
                    confidence: "high",
                    source: "manual",
                },
            },
        };
        // App A scenario
        const derivedContextA = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("retail-app", profileA, new Map(), ["Start"]);
        const scenarioA = {
            sourceIssueKey: "RETAIL-1",
            title: "Browse smartphones",
            steps: [
                '1. Clic en "Start".',
                '2. Clic en "Products".',
                '3. Clic en "Smartphones".', // Missing "Electronics"
                '4. Validar que se muestre "iPhone".',
            ],
            preconditions: [],
            expectedResult: "Test",
            type: "Functional",
            database: "",
            isConverted: 1,
            automationType: "ui",
            setupStrategy: "default",
            appSlug: "retail-app",
            routeProfile: "retail-profile",
            dataRequirements: "",
            nonExecutableCriteria: "",
            mcpExecutable: true,
        };
        const repairResultA = (0, scenario_intermediate_repair_1.repairMissingIntermediates)(scenarioA, profileA, derivedContextA, undefined, "medium");
        (0, test_1.expect)(repairResultA.repaired).toBe(true);
        (0, test_1.expect)(repairResultA.repairedSteps).toContain('3. Clic en "Electronics".');
        (0, test_1.expect)(repairResultA.repairedSteps).toContain('4. Clic en "Smartphones".');
        // App B scenario
        const derivedContextB = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("banking-app", profileB, new Map(), ["Comenzar"]);
        const scenarioB = {
            sourceIssueKey: "BANK-1",
            title: "Ver fondos",
            steps: [
                '1. Clic en "Comenzar".',
                '2. Clic en "Servicios".',
                '3. Clic en "Fondos".', // Missing "Inversiones"
                '4. Validar que se muestre "Renta Fija".',
            ],
            preconditions: [],
            expectedResult: "Test",
            type: "Functional",
            database: "",
            isConverted: 1,
            automationType: "ui",
            setupStrategy: "default",
            appSlug: "banking-app",
            routeProfile: "banking-profile",
            dataRequirements: "",
            nonExecutableCriteria: "",
            mcpExecutable: true,
        };
        const repairResultB = (0, scenario_intermediate_repair_1.repairMissingIntermediates)(scenarioB, profileB, derivedContextB, undefined, "medium");
        (0, test_1.expect)(repairResultB.repaired).toBe(true);
        (0, test_1.expect)(repairResultB.repairedSteps).toContain('3. Clic en "Inversiones".');
        (0, test_1.expect)(repairResultB.repairedSteps).toContain('4. Clic en "Fondos".');
    });
    (0, test_1.test)("validates navigation coherence detects missing intermediates", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {
                productos: ["Información de productos", "Cuentas", "Cuentas de Efectivo"],
            },
            domainTerms: {},
            visibleControls: ["Pesos"],
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
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), ["Iniciar"]);
        const steps = [
            '1. Clic en "Iniciar".',
            '2. Clic en "Información de productos".',
            '3. Clic en "Cuentas de Efectivo".', // Missing "Cuentas"
            '4. Validar que se muestre "Pesos".',
        ];
        const coherenceCheck = (0, scenario_intermediate_repair_1.validateNavigationCoherence)(steps, routeProfile, derivedContext);
        (0, test_1.expect)(coherenceCheck.coherent).toBe(false);
        (0, test_1.expect)(coherenceCheck.missingIntermediates.length).toBeGreaterThan(0);
        (0, test_1.expect)(coherenceCheck.diagnostics.length).toBeGreaterThan(0);
    });
    (0, test_1.test)("path resolution from executableRouteSteps includes all intermediates", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Préstamos", "Personales"],
            representativeFixture: {},
            notes: [],
        };
        const routeResolution = {
            scenarioMode: "detail_navigation",
            routeConfidence: "high",
            executableRouteSteps: [
                '1. Clic en "Iniciar".',
                '2. Clic en "Información de productos".',
                '3. Clic en "Préstamos".',
                '4. Clic en "Personales".',
            ],
            diagnostics: [],
            canGenerate: true,
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map([["TEST-1", routeResolution]]), ["Iniciar"]);
        // Should include all targets from executableRouteSteps
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Iniciar");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Información de productos");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Préstamos");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Personales");
    });
});
