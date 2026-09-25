"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const route_profile_derived_context_1 = require("../src/scenarios/route-profile-derived-context");
const scenario_route_compliance_validator_1 = require("../src/scenarios/scenario-route-compliance-validator");
test_1.test.describe("Enforcement: Content Clicks Prevention", () => {
    (0, test_1.test)("visibleControl without backing is NOT in allowedExecutableClicks", () => {
        const routeProfile = {
            name: "test",
            entry: [{ visibleLabel: "Iniciar", businessLabel: "Inicio" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Beneficios", "Requisitos", "Información de productos"],
            representativeFixture: {},
            notes: []
        };
        const routeResolutions = new Map();
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, routeResolutions, []);
        // Iniciar is in entry, so it should be allowed
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Iniciar");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Inicio");
        // visibleControls should NOT be in allowedExecutableClicks by default
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Beneficios");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Requisitos");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Información de productos");
        // visibleControls should be in visibleButNotExecutableTerms
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("Beneficios");
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("Requisitos");
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("Información de productos");
    });
    (0, test_1.test)("visibleControl backed by executableRouteSteps IS in allowedExecutableClicks", () => {
        const routeProfile = {
            name: "test",
            entry: [{ visibleLabel: "Iniciar", businessLabel: "Inicio" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Beneficios", "Información de productos"],
            representativeFixture: {},
            notes: []
        };
        const routeResolutions = new Map();
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
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, routeResolutions, []);
        // Información de productos is backed by executableRouteSteps, so it should be allowed
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Información de productos");
        // Beneficios is NOT backed, so it should NOT be allowed
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("Beneficios");
        // Beneficios should be in visibleButNotExecutableTerms
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("Beneficios");
        // Información de productos should NOT be in visibleButNotExecutableTerms (it's executable)
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).not.toContain("Información de productos");
    });
    (0, test_1.test)("content term click is rejected with content_term_used_as_click", () => {
        const mockScenario = {
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
            profileConfidence: "high",
            diagnostics: []
        };
        const result = (0, scenario_route_compliance_validator_1.validateScenarioCompliance)(mockScenario, derivedContext);
        (0, test_1.expect)(result.valid).toBe(false);
        (0, test_1.expect)(result.reasonCode).toBe("content_term_used_as_click");
        (0, test_1.expect)(result.diagnostics.length).toBeGreaterThan(0);
        (0, test_1.expect)(result.diagnostics[0].target).toBe("Beneficios");
        (0, test_1.expect)(result.diagnostics[0].message).toContain("visible content term but not executable");
    });
    (0, test_1.test)("content term validation is allowed", () => {
        const mockScenario = {
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
            profileConfidence: "high",
            diagnostics: []
        };
        const result = (0, scenario_route_compliance_validator_1.validateScenarioCompliance)(mockScenario, derivedContext);
        (0, test_1.expect)(result.valid).toBe(true);
        (0, test_1.expect)(result.reasonCode).toBe("valid");
    });
    (0, test_1.test)("domainTerms without backing are NOT in allowedExecutableClicks", () => {
        const routeProfile = {
            name: "test",
            entry: [{ visibleLabel: "Iniciar", businessLabel: "Inicio" }],
            aliases: {},
            intermediates: {},
            domainTerms: { "producto": "producto bancario", "tarjeta": "tarjeta de crédito" },
            visibleControls: [],
            representativeFixture: {},
            notes: []
        };
        const routeResolutions = new Map();
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, routeResolutions, []);
        // domainTerms should NOT be in allowedExecutableClicks by default
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("producto bancario");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).not.toContain("tarjeta de crédito");
        // domainTerms should be in visibleButNotExecutableTerms
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("producto bancario");
        (0, test_1.expect)(derivedContext.visibleButNotExecutableTerms).toContain("tarjeta de crédito");
    });
    (0, test_1.test)("intermediate targets ARE in allowedExecutableClicks", () => {
        const routeProfile = {
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
        const routeResolutions = new Map();
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, routeResolutions, []);
        // intermediates should be in allowedExecutableClicks (they are explicitly navigation)
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Productos");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Servicios");
        (0, test_1.expect)(derivedContext.allowedExecutableClicks).toContain("Ayuda");
    });
    (0, test_1.test)("assertion-only terms identified by pattern", () => {
        const routeProfile = {
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
        const routeResolutions = new Map();
        const derivedContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("test-app", routeProfile, routeResolutions, []);
        // Terms matching ASSERTION_ONLY_INDICATORS should be in assertionOnlyTerms
        (0, test_1.expect)(derivedContext.assertionOnlyTerms).toContain("saldo disponible");
        (0, test_1.expect)(derivedContext.assertionOnlyTerms).toContain("tasa de interés");
        (0, test_1.expect)(derivedContext.assertionOnlyTerms).toContain("campo de entrada");
    });
});
