"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const step_formatter_1 = require("../src/scenarios/step-formatter");
const route_profile_derived_context_1 = require("../src/scenarios/route-profile-derived-context");
const scenario_route_compliance_validator_1 = require("../src/scenarios/scenario-route-compliance-validator");
test_1.test.describe("Deterministic Steps Format Bug Fix", () => {
    (0, test_1.test)("converts object steps to string steps", () => {
        const objectSteps = [
            { action: "click", target: "Iniciar", description: 'Clic en "Iniciar".' },
            { action: "click", target: "Productos", description: 'Clic en "Productos".' },
            { action: "assert", target: "Lista", description: 'Validar que se muestre "Lista".' },
        ];
        const stringSteps = (0, step_formatter_1.ensureStepStrings)(objectSteps);
        (0, test_1.expect)(stringSteps).toHaveLength(3);
        (0, test_1.expect)(stringSteps[0]).toBe('1. Clic en "Iniciar".');
        (0, test_1.expect)(stringSteps[1]).toBe('2. Clic en "Productos".');
        (0, test_1.expect)(stringSteps[2]).toBe('3. Validar que se muestre "Lista".');
    });
    (0, test_1.test)("formatExecutableStep handles different action types", () => {
        (0, test_1.expect)((0, step_formatter_1.formatExecutableStep)({ action: "click", target: "Button" }, 1)).toBe('1. Clic en "Button".');
        (0, test_1.expect)((0, step_formatter_1.formatExecutableStep)({ action: "assert_visible", target: "Text" }, 2)).toBe('2. Validar que se muestre "Text".');
        (0, test_1.expect)((0, step_formatter_1.formatExecutableStep)({ action: "assert_button_visible", target: "Submit" }, 3)).toBe('3. Validar que el botón "Submit" esté visible.');
        (0, test_1.expect)((0, step_formatter_1.formatExecutableStep)({ action: "select_ordinal", target: "producto" }, 4)).toBe("4. Seleccionar el primer producto visible del listado.");
    });
    (0, test_1.test)("formatExecutableStep preserves string steps with correct numbering", () => {
        const step = '5. Clic en "Target".';
        const formatted = (0, step_formatter_1.formatExecutableStep)(step, 1);
        (0, test_1.expect)(formatted).toBe('1. Clic en "Target".');
    });
    (0, test_1.test)("normalizeScenarioSteps handles mixed formats", () => {
        const scenario = {
            sourceIssueKey: "TEST-1",
            title: "Test",
            steps: [
                '1. Clic en "A".',
                { action: "click", target: "B", description: 'Clic en "B".' },
                '3. Validar que se muestre "C".',
            ],
        };
        const normalized = (0, step_formatter_1.normalizeScenarioSteps)(scenario);
        (0, test_1.expect)(normalized.steps).toHaveLength(3);
        (0, test_1.expect)(normalized.steps[0]).toBe('1. Clic en "A".');
        (0, test_1.expect)(normalized.steps[1]).toBe('2. Clic en "B".');
        (0, test_1.expect)(normalized.steps[2]).toBe('3. Validar que se muestre "C".');
    });
    (0, test_1.test)("does not throw step.match is not a function error", () => {
        const scenario = {
            sourceIssueKey: "TEST-1",
            title: "Test",
            steps: [
                { action: "click", target: "Iniciar", description: 'Clic en "Iniciar".' },
                { action: "assert", target: "Result", description: 'Validar que se muestre "Result".' },
            ],
        };
        // This should not throw
        const normalized = (0, step_formatter_1.normalizeScenarioSteps)(scenario);
        (0, test_1.expect)(normalized.steps).toHaveLength(2);
        (0, test_1.expect)(typeof normalized.steps[0]).toBe("string");
        (0, test_1.expect)(typeof normalized.steps[1]).toBe("string");
    });
});
test_1.test.describe("AllowedExecutableClicks Classification Fix", () => {
    (0, test_1.test)("visibleControl without explicit backing NOT in allowedExecutableClicks", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Beneficios", "Requisitos", "Productos"], // Not backed
            representativeFixture: {},
            notes: [],
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), []);
        // Entry should be allowed
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Iniciar");
        // Visible controls without backing should NOT be in allowedExecutableClicks
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Beneficios");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Requisitos");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Productos");
        // They should be in visibleButNotExecutableTerms
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("Beneficios");
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("Requisitos");
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("Productos");
    });
    (0, test_1.test)("content term in visibleControls rejected as click", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Beneficios", "Información de productos"],
            representativeFixture: {},
            notes: [],
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), []);
        const scenario = {
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
        const result = (0, scenario_route_compliance_validator_1.validateScenarioCompliance)(scenario, derivedContext);
        (0, test_1.expect)(result.valid).toBe(false);
        (0, test_1.expect)(result.reasonCode).toBe("content_term_used_as_click");
    });
    (0, test_1.test)("content term as validation is allowed", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Beneficios"],
            representativeFixture: {},
            notes: [],
        };
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), []);
        const scenario = {
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
        const result = (0, scenario_route_compliance_validator_1.validateScenarioCompliance)(scenario, derivedContext);
        (0, test_1.expect)(result.valid).toBe(true);
        (0, test_1.expect)(result.reasonCode).toBe("valid");
    });
    (0, test_1.test)("targetPath steps ARE in allowedExecutableClicks", () => {
        const routeProfile = {
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
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), []);
        // Target and intermediates should be in allowedExecutableClicks
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Información de productos");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Cuentas");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Cuentas de Efectivo");
        // Check sources
        (0, test_1.expect)(derivedContext.clickSources?.get("Información de productos")).toBe("targetPath");
        (0, test_1.expect)(derivedContext.clickSources?.get("Cuentas")).toBe("targetPath");
        (0, test_1.expect)(derivedContext.clickSources?.get("Cuentas de Efectivo")).toBe("targetPath");
    });
    (0, test_1.test)("intermediate steps ARE in allowedExecutableClicks", () => {
        const routeProfile = {
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
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map(), []);
        // All intermediates should be in allowedExecutableClicks
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Información de productos");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Tarjetas");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Tarjetas de crédito");
        // Check sources
        (0, test_1.expect)(derivedContext.clickSources?.get("Información de productos")).toBe("intermediate");
        (0, test_1.expect)(derivedContext.clickSources?.get("Tarjetas")).toBe("intermediate");
        (0, test_1.expect)(derivedContext.clickSources?.get("Tarjetas de crédito")).toBe("intermediate");
    });
    (0, test_1.test)("executableRouteSteps ARE in allowedExecutableClicks", () => {
        const routeProfile = {
            name: "test-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: [],
        };
        const routeResolution = {
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
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, new Map([["TEST-1", routeResolution]]), []);
        // Targets from executableRouteSteps should be in allowedExecutableClicks
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Productos");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Ver detalles");
        // Check sources
        (0, test_1.expect)(derivedContext.clickSources?.get("Productos")).toBe("executableRouteStep");
        (0, test_1.expect)(derivedContext.clickSources?.get("Ver detalles")).toBe("executableRouteStep");
    });
    (0, test_1.test)("multiproject solution without hardcoded targets", () => {
        // Test with two different apps
        const profileA = {
            name: "retail-profile",
            entry: [{ businessLabel: "home", visibleLabel: "Start" }],
            aliases: {},
            intermediates: { nav: ["Products", "Categories"] },
            domainTerms: {},
            visibleControls: ["Featured", "Deals"], // Not backed
            representativeFixture: {},
            notes: [],
        };
        const profileB = {
            name: "banking-profile",
            entry: [{ businessLabel: "inicio", visibleLabel: "Comenzar" }],
            aliases: {},
            intermediates: { nav: ["Servicios", "Cuentas"] },
            domainTerms: {},
            visibleControls: ["Beneficios", "Tasas"], // Not backed
            representativeFixture: {},
            notes: [],
        };
        const contextA = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("retail-app", profileA, new Map(), []);
        const contextB = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("banking-app", profileB, new Map(), []);
        // App A: intermediates are allowed, visibleControls are not
        (0, test_1.expect)(contextA.allowedExecutableClicks).toContain("Products");
        (0, test_1.expect)(contextA.allowedExecutableClicks).toContain("Categories");
        (0, test_1.expect)(contextA.allowedExecutableClicks).not.toContain("Featured");
        (0, test_1.expect)(contextA.allowedExecutableClicks).not.toContain("Deals");
        // App B: intermediates are allowed, visibleControls are not
        (0, test_1.expect)(contextB.allowedExecutableClicks).toContain("Servicios");
        (0, test_1.expect)(contextB.allowedExecutableClicks).toContain("Cuentas");
        (0, test_1.expect)(contextB.allowedExecutableClicks).not.toContain("Beneficios");
        (0, test_1.expect)(contextB.allowedExecutableClicks).not.toContain("Tasas");
        // Isolation: App A terms not in App B
        (0, test_1.expect)(contextB.allowedExecutableClicks).not.toContain("Products");
        (0, test_1.expect)(contextB.allowedExecutableClicks).not.toContain("Featured");
    });
});
