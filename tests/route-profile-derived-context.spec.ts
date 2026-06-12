import { test, expect } from "@playwright/test";
import {
  buildDerivedExecutionContext,
  formatDerivedContextForPrompt,
} from "../src/scenarios/route-profile-derived-context";
import type { McpRouteProfile, ScenarioRouteResolution } from "../src/scenarios/scenario-types";

test.describe("Route Profile Derived Context - Multi-App", () => {
  test("app-a and app-b have different allowed executable clicks", () => {
    // App A profile (retail app)
    const profileA: McpRouteProfile = {
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
    const profileB: McpRouteProfile = {
      name: "app-b-profile",
      entry: [{ businessLabel: "Home", visibleLabel: "Comenzar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Cuentas", "Transferencias", "Pagos"],
      representativeFixture: {},
      notes: []
    };

    const contextA = buildDerivedExecutionContext("app-a", profileA, new Map());
    const contextB = buildDerivedExecutionContext("app-b", profileB, new Map());

    // App A should have entry steps in allowed clicks
    expect(contextA.allowedExecutableClicks).toContain("Iniciar");
    expect(contextA.allowedExecutableClicks).toContain("Inicio");

    // visibleControls without backing should NOT be in allowedExecutableClicks
    expect(contextA.allowedExecutableClicks).not.toContain("Productos");
    expect(contextA.allowedExecutableClicks).not.toContain("Carrito");
    expect(contextA.allowedExecutableClicks).not.toContain("Cuentas");
    expect(contextA.allowedExecutableClicks).not.toContain("Transferencias");

    // visibleControls should be in visibleButNotExecutableTerms
    expect(contextA.visibleButNotExecutableTerms).toContain("Productos");
    expect(contextA.visibleButNotExecutableTerms).toContain("Carrito");
    expect(contextA.visibleButNotExecutableTerms).not.toContain("Cuentas");
    expect(contextA.visibleButNotExecutableTerms).not.toContain("Transferencias");

    // App B should have entry steps in allowed clicks
    expect(contextB.allowedExecutableClicks).toContain("Comenzar");
    expect(contextB.allowedExecutableClicks).toContain("Home");

    // App B visibleControls should be in visibleButNotExecutableTerms
    expect(contextB.visibleButNotExecutableTerms).toContain("Cuentas");
    expect(contextB.visibleButNotExecutableTerms).toContain("Pagos");
    expect(contextB.visibleButNotExecutableTerms).not.toContain("Productos");
    expect(contextB.visibleButNotExecutableTerms).not.toContain("Carrito");

    // Multi-app isolation: target valid in app-a is not allowed in app-b
    // Since Productos is a visibleControl without backing, it should be in visibleButNotExecutableTerms
    const productoInAVisible = contextA.visibleButNotExecutableTerms.includes("Productos");
    const productoInBVisible = contextB.visibleButNotExecutableTerms.includes("Productos");

    expect(productoInAVisible).toBe(true);
    expect(productoInBVisible).toBe(false);
  });

  test("assertion-only terms are derived from domain terms", () => {
    const profile: McpRouteProfile = {
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

    const context = buildDerivedExecutionContext("retail-app", profile, new Map());

    // Assertion-only indicators should be detected
    expect(context.assertionOnlyTerms.length).toBeGreaterThan(0);
    expect(context.assertionOnlyTerms.some(term =>
      term.toLowerCase().includes("nombre") ||
      term.toLowerCase().includes("descripción") ||
      term.toLowerCase().includes("precio")
    )).toBe(true);
  });

  test("sensitive actions are identified", () => {
    const profile: McpRouteProfile = {
      name: "banking-app",
      entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: ["Ver cuentas", "Solicitar producto", "Pagar", "Transferir"],
      representativeFixture: {},
      notes: []
    };

    const context = buildDerivedExecutionContext("banking-app", profile, new Map());

    expect(context.sensitiveActions).toContain("Solicitar producto");
    expect(context.sensitiveActions).toContain("Pagar");
    expect(context.sensitiveActions).toContain("Transferir");
    expect(context.sensitiveActions).not.toContain("Ver cuentas");
  });

  test("executable clicks derived from route resolution steps", () => {
    const profile: McpRouteProfile = {
      name: "app-profile",
      entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: []
    };

    const routeResolutions = new Map<string, ScenarioRouteResolution>();
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

    const context = buildDerivedExecutionContext("app-a", profile, routeResolutions);

    // Should extract click targets from executable steps
    expect(context.allowedExecutableClicks).toContain("Iniciar");
    expect(context.allowedExecutableClicks).toContain("Productos");
    expect(context.allowedExecutableClicks).toContain("Electrónicos");
  });

  test("profile confidence is determined correctly", () => {
    // High confidence: complete profile
    const highProfile: McpRouteProfile = {
      name: "complete-profile",
      entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
      aliases: { "Inicio": "Home" },
      intermediates: { "main": ["Productos", "Servicios"] },
      domainTerms: { "producto": "item" },
      visibleControls: ["Iniciar", "Productos", "Carrito"],
      representativeFixture: {},
      notes: []
    };

    const routeResolutions = new Map<string, ScenarioRouteResolution>();
    routeResolutions.set("ISSUE-1", {
      scenarioMode: "listing_validation",
      routeConfidence: "high",
      executableRouteSteps: ['1. Clic en "Iniciar".', '2. Clic en "Productos".'],
      diagnostics: [],
      canGenerate: true,
      missingRouteReason: undefined
    });

    const highContext = buildDerivedExecutionContext("app-a", highProfile, routeResolutions);
    expect(highContext.profileConfidence).toBe("high");

    // Low confidence: minimal profile
    const lowProfile: McpRouteProfile = {
      name: "minimal-profile",
      entry: [],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: []
    };

    const lowContext = buildDerivedExecutionContext("app-b", lowProfile, new Map());
    expect(lowContext.profileConfidence).toBe("low");

    // None: no profile
    const noneContext = buildDerivedExecutionContext("app-c", null, new Map());
    expect(noneContext.profileConfidence).toBe("none");
  });

  test("aliases are mapped correctly", () => {
    const profile: McpRouteProfile = {
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

    const context = buildDerivedExecutionContext("app-a", profile, new Map());

    // Check aliases mapping
    expect(context.aliasesByTarget.has("Inicio")).toBe(true);
    expect(context.aliasesByTarget.get("Inicio")).toContain("Home");
    expect(context.aliasesByTarget.get("Inicio")).toContain("Start");

    // Reverse mapping: alias -> target
    expect(context.aliasesByTarget.has("Home")).toBe(true);
    expect(context.aliasesByTarget.get("Home")).toContain("Inicio");
  });

  test("format derived context for prompt includes all sections", () => {
    const profile: McpRouteProfile = {
      name: "app-profile",
      entry: [{ businessLabel: "Inicio", visibleLabel: "Iniciar" }],
      aliases: {},
      intermediates: {},
      domainTerms: { "nombre": "Product Name" },
      visibleControls: ["Iniciar", "Ver lista", "Solicitar"],
      representativeFixture: {},
      notes: []
    };

    const context = buildDerivedExecutionContext("app-a", profile, new Map());
    const formatted = formatDerivedContextForPrompt(context);

    expect(formatted).toContain("ALLOWED_EXECUTABLE_CLICKS");
    expect(formatted).toContain("ASSERTION_ONLY_TERMS");
    expect(formatted).toContain("SENSITIVE_ACTIONS");
    expect(formatted).toContain("CRITICAL RULES");
    expect(formatted).toContain("Iniciar");
    expect(formatted).toContain("Solicitar");
  });

  test("no profile returns empty context with none confidence", () => {
    const context = buildDerivedExecutionContext("no-profile-app", null, new Map());

    expect(context.allowedExecutableClicks).toEqual([]);
    expect(context.assertionOnlyTerms).toEqual([]);
    expect(context.sensitiveActions).toEqual([]);
    expect(context.profileConfidence).toBe("none");
    expect(context.diagnostics).toContain("no_route_profile_available");
  });
});
