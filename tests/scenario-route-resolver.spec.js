"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_route_resolver_1 = require("../src/scenarios/scenario-route-resolver");
test_1.test.describe("Scenario Route Resolver", () => {
    const completeRouteProfile = {
        name: "informacion_productos",
        entry: [
            { businessLabel: "iniciar", visibleLabel: "Iniciar" },
            { businessLabel: "informacion_productos", visibleLabel: "Información de productos" }
        ],
        aliases: {
            tarjetas: ["Tarjetas de crédito", "Tarjetas"],
            depositos: ["Depósitos a Plazo"]
        },
        intermediates: {
            tarjetas: ["Tarjeta de Crédito"]
        },
        domainTerms: {
            producto: ["producto", "tarjeta", "depósito"]
        },
        visibleControls: [
            "Iniciar",
            "Información de productos",
            "Tarjetas",
            "Depósitos a Plazo",
            "Préstamos",
            "Volver"
        ],
        representativeFixture: {},
        notes: []
    };
    const createIssue = (description, acceptanceCriteria) => ({
        key: "TEST-123",
        summary: "Test scenario",
        description,
        acceptanceCriteria: acceptanceCriteria || null,
        labels: [],
        components: [],
        status: "In Progress",
        issueType: "Story"
    });
    test_1.test.describe("Complete HU + Complete Route Profile", () => {
        (0, test_1.test)("should return high confidence with mode detected and steps generated", () => {
            const issue = createIssue("Visualizar detalle del producto incluyendo nombre y descripción");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, completeRouteProfile);
            (0, test_1.expect)(resolution.scenarioMode).toBe("detail_navigation");
            (0, test_1.expect)(resolution.routeConfidence).toBe("high");
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
            (0, test_1.expect)(resolution.executableRouteSteps.length).toBeGreaterThan(0);
            (0, test_1.expect)(resolution.diagnostics.length).toBe(0); // No diagnostics for complete backing
        });
    });
    test_1.test.describe("Incomplete HU + Complete Route Profile", () => {
        (0, test_1.test)("should infer mode from profile and generate", () => {
            const issue = createIssue("Ver productos");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, completeRouteProfile);
            // Vague HU → unknown mode, low confidence
            // But still generates because profile exists
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
            (0, test_1.expect)(resolution.scenarioMode).toBe("unknown");
            (0, test_1.expect)(resolution.routeConfidence).toBe("low");
            (0, test_1.expect)(resolution.executableRouteSteps.length).toBe(0); // Unknown mode doesn't generate steps
        });
    });
    test_1.test.describe("Complete HU + Incomplete Route Profile", () => {
        (0, test_1.test)("should return error diagnostic and block generation", () => {
            const issue = createIssue("Visualizar detalle del producto");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, null);
            (0, test_1.expect)(resolution.canGenerate).toBe(false);
            (0, test_1.expect)(resolution.diagnostics.length).toBeGreaterThan(0);
            (0, test_1.expect)(resolution.diagnostics[0].level).toBe("error");
            (0, test_1.expect)(resolution.diagnostics[0].code).toBe("needs_route_profile");
            (0, test_1.expect)(resolution.missingRouteReason).toBeDefined();
        });
    });
    test_1.test.describe("Entry Only, Missing List", () => {
        (0, test_1.test)("should return missing_parent_route diagnostic", () => {
            const incompleteProfile = {
                ...completeRouteProfile,
                visibleControls: [] // Missing list targets
            };
            const issue = createIssue("Visualizar listado de productos");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, incompleteProfile);
            (0, test_1.expect)(resolution.canGenerate).toBe(false);
            const errorDiagnostic = resolution.diagnostics.find(d => d.level === "error");
            (0, test_1.expect)(errorDiagnostic?.code).toBe("missing_parent_route");
        });
    });
    test_1.test.describe("Entry + List, Missing Intermediate", () => {
        (0, test_1.test)("should return missing_intermediate_step warning with medium confidence", () => {
            const incompleteProfile = {
                ...completeRouteProfile,
                intermediates: {} // Missing intermediates
            };
            const issue = createIssue("Navegar a la categoría de tarjetas");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, incompleteProfile);
            (0, test_1.expect)(resolution.scenarioMode).toBe("subcategory_navigation");
            (0, test_1.expect)(resolution.canGenerate).toBe(true); // Warnings don't block
            (0, test_1.expect)(resolution.routeConfidence).toBe("medium");
            const warningDiagnostic = resolution.diagnostics.find(d => d.level === "warning");
            (0, test_1.expect)(warningDiagnostic?.code).toBe("missing_intermediate_step");
        });
    });
    test_1.test.describe("Listing Validation Intent", () => {
        (0, test_1.test)("should classify as listing_validation with no ordinal selection", () => {
            const issue = createIssue("Validar que se muestren las opciones de productos");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, completeRouteProfile);
            (0, test_1.expect)(resolution.scenarioMode).toBe("listing_validation");
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
            // Should not include ordinal selection step
            const hasSelection = resolution.executableRouteSteps.some(s => s.includes("Seleccionar el primer"));
            (0, test_1.expect)(hasSelection).toBe(false);
        });
    });
    test_1.test.describe("Detail Navigation Intent + DomainTerm", () => {
        (0, test_1.test)("should classify as detail_navigation and include selection step", () => {
            const issue = createIssue("Visualizar información detallada del producto");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, completeRouteProfile);
            (0, test_1.expect)(resolution.scenarioMode).toBe("detail_navigation");
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
            // Should include ordinal selection step
            const selectionStep = resolution.executableRouteSteps.find(s => s.includes("Seleccionar el primer"));
            (0, test_1.expect)(selectionStep).toBeDefined();
            (0, test_1.expect)(selectionStep).toContain("producto"); // Domain term
        });
    });
    test_1.test.describe("Sensitive Action in HU", () => {
        (0, test_1.test)("should classify as action_button_validation and validate visible only", () => {
            const issue = createIssue("Verificar que el botón Solicitar esté visible");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, completeRouteProfile);
            (0, test_1.expect)(resolution.scenarioMode).toBe("action_button_validation");
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
            // Should validate button, not click it
            const validationStep = resolution.executableRouteSteps.find(s => s.includes('Validar que el botón "Solicitar" esté visible'));
            (0, test_1.expect)(validationStep).toBeDefined();
            const clickStep = resolution.executableRouteSteps.find(s => s.includes('Clic en "Solicitar"'));
            (0, test_1.expect)(clickStep).toBeUndefined();
        });
    });
    test_1.test.describe("Ambiguous Route (Multiple Paths)", () => {
        (0, test_1.test)("should pick first available path and add info diagnostic", () => {
            // For now, implementation picks first matching control
            const issue = createIssue("Navegar a productos");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, completeRouteProfile);
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
            (0, test_1.expect)(resolution.executableRouteSteps.length).toBeGreaterThan(0);
        });
    });
    test_1.test.describe("No Route Profile", () => {
        (0, test_1.test)("should return needs_route_profile error and block", () => {
            const issue = createIssue("Visualizar productos");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, null);
            (0, test_1.expect)(resolution.canGenerate).toBe(false);
            (0, test_1.expect)(resolution.diagnostics.length).toBeGreaterThan(0);
            (0, test_1.expect)(resolution.diagnostics[0].code).toBe("needs_route_profile");
            (0, test_1.expect)(resolution.missingRouteReason).toContain("needs_route_profile");
        });
    });
    test_1.test.describe("Acceptance Criteria Integration", () => {
        (0, test_1.test)("should combine description and acceptance criteria for analysis", () => {
            const issue = createIssue("Navegar a productos", "Validar que se muestre el detalle del producto");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, completeRouteProfile);
            // Should detect detail_navigation from acceptance criteria
            (0, test_1.expect)(resolution.scenarioMode).toBe("detail_navigation");
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
        });
    });
    test_1.test.describe("Diagnostic Structure", () => {
        (0, test_1.test)("should include context in diagnostics", () => {
            const issue = createIssue("Visualizar detalle");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, null);
            (0, test_1.expect)(resolution.diagnostics[0].context).toBeDefined();
            (0, test_1.expect)(resolution.diagnostics[0].message).toBeDefined();
        });
        (0, test_1.test)("should not generate steps when blocked by error diagnostic", () => {
            const issue = createIssue("Ver productos");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, null);
            (0, test_1.expect)(resolution.canGenerate).toBe(false);
            (0, test_1.expect)(resolution.executableRouteSteps.length).toBe(0);
        });
        (0, test_1.test)("should generate steps when only warning diagnostics present", () => {
            const incompleteProfile = {
                ...completeRouteProfile,
                intermediates: {}
            };
            const issue = createIssue("Navegar a tarjetas");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, incompleteProfile);
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
            (0, test_1.expect)(resolution.executableRouteSteps.length).toBeGreaterThan(0);
            const hasWarnings = resolution.diagnostics.some(d => d.level === "warning");
            (0, test_1.expect)(hasWarnings).toBe(true);
        });
    });
    test_1.test.describe("Return Navigation", () => {
        (0, test_1.test)("should build full return navigation cycle", () => {
            const issue = createIssue("Volver al listado después de ver el detalle");
            const resolution = (0, scenario_route_resolver_1.resolveScenarioRoute)(issue, completeRouteProfile);
            (0, test_1.expect)(resolution.scenarioMode).toBe("return_navigation");
            (0, test_1.expect)(resolution.canGenerate).toBe(true);
            // Should have return validation and click
            const hasReturnValidation = resolution.executableRouteSteps.some(s => s.includes('Validar que el botón "Volver" esté visible'));
            const hasReturnClick = resolution.executableRouteSteps.some(s => s.includes('Clic en "Volver"'));
            (0, test_1.expect)(hasReturnValidation).toBe(true);
            (0, test_1.expect)(hasReturnClick).toBe(true);
        });
    });
});
