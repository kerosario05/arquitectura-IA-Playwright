"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const route_profile_derived_context_1 = require("../src/scenarios/route-profile-derived-context");
test_1.test.describe("Route Profile Derived Context - Multi-App", () => {
    (0, test_1.test)("app-a and app-b have different allowed executable clicks", () => {
        // App A profile (retail app)
        const profileA = {
            name: "app-a-profile",
            entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Productos", "Categorías", "Carrito"],
            representativeFixture: {},
            notes: []
        };
        // App B profile (banking app)
        const profileB = {
            name: "app-b-profile",
            entry: [{ businessLabel: "Home", visibleLabel: "Comenzar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Cuentas", "Transferencias", "Pagos"],
            representativeFixture: {},
            notes: []
        };
        const contextA = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app-a", profileA, new Map());
        const contextB = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app-b", profileB, new Map());
        // App A should have entry steps in allowed clicks
        (0, test_1.expect)(contextA.allowedExecutableClicks).toContain("Iniciar");
        (0, test_1.expect)(contextA.allowedExecutableClicks).toContain("Inicio");
        // visibleControls without backing should NOT be in allowedExecutableClicks
        (0, test_1.expect)(contextA.allowedExecutableClicks).not.toContain("Productos");
        (0, test_1.expect)(contextA.allowedExecutableClicks).not.toContain("Carrito");
        (0, test_1.expect)(contextA.allowedExecutableClicks).not.toContain("Cuentas");
        (0, test_1.expect)(contextA.allowedExecutableClicks).not.toContain("Transferencias");
        // visibleControls should be in visibleButNotExecutableTerms
        (0, test_1.expect)(contextA.visibleButNotExecutableTerms).toContain("Productos");
        (0, test_1.expect)(contextA.visibleButNotExecutableTerms).toContain("Carrito");
        (0, test_1.expect)(contextA.visibleButNotExecutableTerms).not.toContain("Cuentas");
        (0, test_1.expect)(contextA.visibleButNotExecutableTerms).not.toContain("Transferencias");
        // App B should have entry steps in allowed clicks
        (0, test_1.expect)(contextB.allowedExecutableClicks).toContain("Comenzar");
        (0, test_1.expect)(contextB.allowedExecutableClicks).toContain("Home");
        // App B visibleControls should be in visibleButNotExecutableTerms
        (0, test_1.expect)(contextB.visibleButNotExecutableTerms).toContain("Cuentas");
        (0, test_1.expect)(contextB.visibleButNotExecutableTerms).toContain("Pagos");
        (0, test_1.expect)(contextB.visibleButNotExecutableTerms).not.toContain("Productos");
        (0, test_1.expect)(contextB.visibleButNotExecutableTerms).not.toContain("Carrito");
        // Multi-app isolation: target valid in app-a is not allowed in app-b
        // Since Productos is a visibleControl without backing, it should be in visibleButNotExecutableTerms
        const productoInAVisible = contextA.visibleButNotExecutableTerms.includes("Productos");
        const productoInBVisible = contextB.visibleButNotExecutableTerms.includes("Productos");
        (0, test_1.expect)(productoInAVisible).toBe(true);
        (0, test_1.expect)(productoInBVisible).toBe(false);
    });
    (0, test_1.test)("assertion-only terms are derived from domain terms", () => {
        const profile = {
            name: "retail-app",
            entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {
                "nombre": "Nombre del producto",
                "descripción": "Descripción detallada",
                "precio": "Precio unitario"
            },
            visibleControls: ["Ver detalles"],
            representativeFixture: {},
            notes: []
        };
        const context = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("retail-app", profile, new Map());
        // Assertion-only indicators should be detected
        (0, test_1.expect)(context.assertionOnlyTerms.length).toBeGreaterThan(0);
        (0, test_1.expect)(context.assertionOnlyTerms.some(term => term.toLowerCase().includes("nombre") ||
            term.toLowerCase().includes("descripción") ||
            term.toLowerCase().includes("precio"))).toBe(true);
    });
    (0, test_1.test)("sensitive actions are identified", () => {
        const profile = {
            name: "banking-app",
            entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Ver cuentas", "Solicitar producto", "Pagar", "Transferir"],
            representativeFixture: {},
            notes: []
        };
        const context = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("banking-app", profile, new Map());
        (0, test_1.expect)(context.sensitiveActions).toContain("Solicitar producto");
        (0, test_1.expect)(context.sensitiveActions).toContain("Pagar");
        (0, test_1.expect)(context.sensitiveActions).toContain("Transferir");
        (0, test_1.expect)(context.sensitiveActions).not.toContain("Ver cuentas");
    });
    (0, test_1.test)("executable clicks derived from route resolution steps", () => {
        const profile = {
            name: "app-profile",
            entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: []
        };
        const routeResolutions = new Map();
        routeResolutions.set("ISSUE-1", {
            scenarioMode: "detail_navigation",
            routeConfidence: "high",
            executableRouteSteps: [
                '1. Clic en "Iniciar".',
                '2. Clic en "Productos".',
                '3. Clic en "Electrónicos".',
            ],
            diagnostics: [],
            canGenerate: true,
            missingRouteReason: undefined
        });
        const context = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app-a", profile, routeResolutions);
        // Should extract click targets from executable steps
        (0, test_1.expect)(context.allowedExecutableClicks).toContain("Iniciar");
        (0, test_1.expect)(context.allowedExecutableClicks).toContain("Productos");
        (0, test_1.expect)(context.allowedExecutableClicks).toContain("Electrónicos");
    });
    (0, test_1.test)("profile confidence is determined correctly", () => {
        // High confidence: complete profile
        const highProfile = {
            name: "complete-profile",
            entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
            aliases: { "Inicio": "Home" },
            intermediates: { "main": ["Productos", "Servicios"] },
            domainTerms: { "producto": "item" },
            visibleControls: ["Iniciar", "Productos", "Carrito"],
            representativeFixture: {},
            notes: []
        };
        const routeResolutions = new Map();
        routeResolutions.set("ISSUE-1", {
            scenarioMode: "listing_validation",
            routeConfidence: "high",
            executableRouteSteps: ['1. Clic en "Iniciar".', '2. Clic en "Productos".'],
            diagnostics: [],
            canGenerate: true,
            missingRouteReason: undefined
        });
        const highContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app-a", highProfile, routeResolutions);
        (0, test_1.expect)(highContext.profileConfidence).toBe("high");
        // Low confidence: minimal profile
        const lowProfile = {
            name: "minimal-profile",
            entry: [],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: []
        };
        const lowContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app-b", lowProfile, new Map());
        (0, test_1.expect)(lowContext.profileConfidence).toBe("low");
        // None: no profile
        const noneContext = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app-c", null, new Map());
        (0, test_1.expect)(noneContext.profileConfidence).toBe("none");
    });
    (0, test_1.test)("aliases are mapped correctly", () => {
        const profile = {
            name: "app-profile",
            entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
            aliases: {
                "Inicio": ["Home", "Start"],
                "Productos": ["Items", "Artículos"]
            },
            intermediates: {},
            domainTerms: {},
            visibleControls: ["Inicio", "Productos"],
            representativeFixture: {},
            notes: []
        };
        const context = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app-a", profile, new Map());
        // Check aliases mapping
        (0, test_1.expect)(context.aliasesByTarget.has("Inicio")).toBe(true);
        (0, test_1.expect)(context.aliasesByTarget.get("Inicio")).toContain("Home");
        (0, test_1.expect)(context.aliasesByTarget.get("Inicio")).toContain("Start");
        // Reverse mapping: alias -> target
        (0, test_1.expect)(context.aliasesByTarget.has("Home")).toBe(true);
        (0, test_1.expect)(context.aliasesByTarget.get("Home")).toContain("Inicio");
    });
    (0, test_1.test)("format derived context for prompt includes all sections", () => {
        const profile = {
            name: "app-profile",
            entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
            aliases: {},
            intermediates: {},
            domainTerms: { "nombre": "Product Name" },
            visibleControls: ["Iniciar", "Ver lista", "Solicitar"],
            representativeFixture: {},
            notes: []
        };
        const context = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("app-a", profile, new Map());
        const formatted = (0, route_profile_derived_context_1.formatDerivedContextForPrompt)(context);
        (0, test_1.expect)(formatted).toContain("ALLOWED_EXECUTABLE_CLICKS");
        (0, test_1.expect)(formatted).toContain("ASSERTION_ONLY_TERMS");
        (0, test_1.expect)(formatted).toContain("SENSITIVE_ACTIONS");
        (0, test_1.expect)(formatted).toContain("CRITICAL RULES");
        (0, test_1.expect)(formatted).toContain("Iniciar");
        (0, test_1.expect)(formatted).toContain("Solicitar");
    });
    (0, test_1.test)("no profile returns empty context with none confidence", () => {
        const context = (0, route_profile_derived_context_1.buildDerivedExecutionContext)("no-profile-app", null, new Map());
        (0, test_1.expect)(context.allowedExecutableClicks).toEqual([]);
        (0, test_1.expect)(context.assertionOnlyTerms).toEqual([]);
        (0, test_1.expect)(context.sensitiveActions).toEqual([]);
        (0, test_1.expect)(context.profileConfidence).toBe("none");
        (0, test_1.expect)(context.diagnostics).toContain("no_route_profile_available");
    });
});
