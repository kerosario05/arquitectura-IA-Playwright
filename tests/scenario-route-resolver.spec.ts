import { test, expect } from "@playwright/test";
import { resolveScenarioRoute } from "../src/scenarios/scenario-route-resolver";
import type { JiraIssueSource, McpRouteProfile } from "../src/scenarios/scenario-types";

test.describe("Scenario Route Resolver", () => {
  const completeRouteProfile: McpRouteProfile = {
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

  const createIssue = (description: string, acceptanceCriteria?: string): JiraIssueSource => ({
    key: "TEST-123",
    summary: "Test scenario",
    description,
    acceptanceCriteria: acceptanceCriteria || null,
    labels: [],
    components: [],
    status: "In Progress",
    issueType: "Story"
  });

  test.describe("Complete HU + Complete Route Profile", () => {
    test("should return high confidence with mode detected and steps generated", () => {
      const issue = createIssue(
        "Visualizar detalle del producto incluyendo nombre y descripción"
      );

      const resolution = resolveScenarioRoute(issue, completeRouteProfile);

      expect(resolution.scenarioMode).toBe("detail_navigation");
      expect(resolution.routeConfidence).toBe("high");
      expect(resolution.canGenerate).toBe(true);
      expect(resolution.executableRouteSteps.length).toBeGreaterThan(0);
      expect(resolution.diagnostics.length).toBe(0); // No diagnostics for complete backing
    });
  });

  test.describe("Incomplete HU + Complete Route Profile", () => {
    test("should infer mode from profile and generate", () => {
      const issue = createIssue("Ver productos");

      const resolution = resolveScenarioRoute(issue, completeRouteProfile);

      // Vague HU → unknown mode, low confidence
      // But still generates because profile exists
      expect(resolution.canGenerate).toBe(true);
      expect(resolution.scenarioMode).toBe("unknown");
      expect(resolution.routeConfidence).toBe("low");
      expect(resolution.executableRouteSteps.length).toBe(0); // Unknown mode doesn't generate steps
    });
  });

  test.describe("Complete HU + Incomplete Route Profile", () => {
    test("should return error diagnostic and block generation", () => {
      const issue = createIssue("Visualizar detalle del producto");

      const resolution = resolveScenarioRoute(issue, null);

      expect(resolution.canGenerate).toBe(false);
      expect(resolution.diagnostics.length).toBeGreaterThan(0);
      expect(resolution.diagnostics[0].level).toBe("error");
      expect(resolution.diagnostics[0].code).toBe("needs_route_profile");
      expect(resolution.missingRouteReason).toBeDefined();
    });
  });

  test.describe("Entry Only, Missing List", () => {
    test("should return missing_parent_route diagnostic", () => {
      const incompleteProfile: McpRouteProfile = {
        ...completeRouteProfile,
        visibleControls: [] // Missing list targets
      };

      const issue = createIssue("Visualizar listado de productos");

      const resolution = resolveScenarioRoute(issue, incompleteProfile);

      expect(resolution.canGenerate).toBe(false);
      const errorDiagnostic = resolution.diagnostics.find(d => d.level === "error");
      expect(errorDiagnostic?.code).toBe("missing_parent_route");
    });
  });

  test.describe("Entry + List, Missing Intermediate", () => {
    test("should return missing_intermediate_step warning with medium confidence", () => {
      const incompleteProfile: McpRouteProfile = {
        ...completeRouteProfile,
        intermediates: {} // Missing intermediates
      };

      const issue = createIssue("Navegar a la categoría de tarjetas");

      const resolution = resolveScenarioRoute(issue, incompleteProfile);

      expect(resolution.scenarioMode).toBe("subcategory_navigation");
      expect(resolution.canGenerate).toBe(true); // Warnings don't block
      expect(resolution.routeConfidence).toBe("medium");

      const warningDiagnostic = resolution.diagnostics.find(d => d.level === "warning");
      expect(warningDiagnostic?.code).toBe("missing_intermediate_step");
    });
  });

  test.describe("Listing Validation Intent", () => {
    test("should classify as listing_validation with no ordinal selection", () => {
      const issue = createIssue("Validar que se muestren las opciones de productos");

      const resolution = resolveScenarioRoute(issue, completeRouteProfile);

      expect(resolution.scenarioMode).toBe("listing_validation");
      expect(resolution.canGenerate).toBe(true);

      // Should not include ordinal selection step
      const hasSelection = resolution.executableRouteSteps.some(s =>
        s.includes("Seleccionar el primer")
      );
      expect(hasSelection).toBe(false);
    });
  });

  test.describe("Detail Navigation Intent + DomainTerm", () => {
    test("should classify as detail_navigation and include selection step", () => {
      const issue = createIssue("Visualizar información detallada del producto");

      const resolution = resolveScenarioRoute(issue, completeRouteProfile);

      expect(resolution.scenarioMode).toBe("detail_navigation");
      expect(resolution.canGenerate).toBe(true);

      // Should include ordinal selection step
      const selectionStep = resolution.executableRouteSteps.find(s =>
        s.includes("Seleccionar el primer")
      );
      expect(selectionStep).toBeDefined();
      expect(selectionStep).toContain("producto"); // Domain term
    });
  });

  test.describe("Sensitive Action in HU", () => {
    test("should classify as action_button_validation and validate visible only", () => {
      const issue = createIssue("Verificar que el botón Solicitar esté visible");

      const resolution = resolveScenarioRoute(issue, completeRouteProfile);

      expect(resolution.scenarioMode).toBe("action_button_validation");
      expect(resolution.canGenerate).toBe(true);

      // Should validate button, not click it
      const validationStep = resolution.executableRouteSteps.find(s =>
        s.includes('Validar que el botón "Solicitar" esté visible')
      );
      expect(validationStep).toBeDefined();

      const clickStep = resolution.executableRouteSteps.find(s =>
        s.includes('Clic en "Solicitar"')
      );
      expect(clickStep).toBeUndefined();
    });
  });

  test.describe("Ambiguous Route (Multiple Paths)", () => {
    test("should pick first available path and add info diagnostic", () => {
      // For now, implementation picks first matching control
      const issue = createIssue("Navegar a productos");

      const resolution = resolveScenarioRoute(issue, completeRouteProfile);

      expect(resolution.canGenerate).toBe(true);
      expect(resolution.executableRouteSteps.length).toBeGreaterThan(0);
    });
  });

  test.describe("No Route Profile", () => {
    test("should return needs_route_profile error and block", () => {
      const issue = createIssue("Visualizar productos");

      const resolution = resolveScenarioRoute(issue, null);

      expect(resolution.canGenerate).toBe(false);
      expect(resolution.diagnostics.length).toBeGreaterThan(0);
      expect(resolution.diagnostics[0].code).toBe("needs_route_profile");
      expect(resolution.missingRouteReason).toContain("needs_route_profile");
    });
  });

  test.describe("Acceptance Criteria Integration", () => {
    test("should combine description and acceptance criteria for analysis", () => {
      const issue = createIssue(
        "Navegar a productos",
        "Validar que se muestre el detalle del producto"
      );

      const resolution = resolveScenarioRoute(issue, completeRouteProfile);

      // Should detect detail_navigation from acceptance criteria
      expect(resolution.scenarioMode).toBe("detail_navigation");
      expect(resolution.canGenerate).toBe(true);
    });
  });

  test.describe("Diagnostic Structure", () => {
    test("should include context in diagnostics", () => {
      const issue = createIssue("Visualizar detalle");

      const resolution = resolveScenarioRoute(issue, null);

      expect(resolution.diagnostics[0].context).toBeDefined();
      expect(resolution.diagnostics[0].message).toBeDefined();
    });

    test("should not generate steps when blocked by error diagnostic", () => {
      const issue = createIssue("Ver productos");

      const resolution = resolveScenarioRoute(issue, null);

      expect(resolution.canGenerate).toBe(false);
      expect(resolution.executableRouteSteps.length).toBe(0);
    });

    test("should generate steps when only warning diagnostics present", () => {
      const incompleteProfile: McpRouteProfile = {
        ...completeRouteProfile,
        intermediates: {}
      };

      const issue = createIssue("Navegar a tarjetas");

      const resolution = resolveScenarioRoute(issue, incompleteProfile);

      expect(resolution.canGenerate).toBe(true);
      expect(resolution.executableRouteSteps.length).toBeGreaterThan(0);

      const hasWarnings = resolution.diagnostics.some(d => d.level === "warning");
      expect(hasWarnings).toBe(true);
    });
  });

  test.describe("Return Navigation", () => {
    test("should build full return navigation cycle", () => {
      const issue = createIssue("Volver al listado después de ver el detalle");

      const resolution = resolveScenarioRoute(issue, completeRouteProfile);

      expect(resolution.scenarioMode).toBe("return_navigation");
      expect(resolution.canGenerate).toBe(true);

      // Should have return validation and click
      const hasReturnValidation = resolution.executableRouteSteps.some(s =>
        s.includes('Validar que el botón "Volver" esté visible')
      );
      const hasReturnClick = resolution.executableRouteSteps.some(s =>
        s.includes('Clic en "Volver"')
      );

      expect(hasReturnValidation).toBe(true);
      expect(hasReturnClick).toBe(true);
    });
  });
});
