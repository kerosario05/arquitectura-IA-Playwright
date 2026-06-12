import { test, expect } from "@playwright/test";
import { classifyScenarioMode } from "../src/scenarios/scenario-mode-classifier";
import type { McpRouteProfile } from "../src/scenarios/scenario-types";

test.describe("Scenario Mode Classifier", () => {
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

  test.describe("Mode Detection", () => {
    test("should detect detail_navigation mode", () => {
      const huText = "Visualizar detalle del producto incluyendo nombre y descripción";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.mode).toBe("detail_navigation");
      expect(result.hasBacking).toBe(true);
    });

    test("should detect listing_validation mode", () => {
      const huText = "Validar que se muestre el listado de opciones disponibles";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.mode).toBe("listing_validation");
      expect(result.hasBacking).toBe(true);
    });

    test("should detect return_navigation mode", () => {
      const huText = "Volver al listado después de visualizar el detalle";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.mode).toBe("return_navigation");
      expect(result.hasBacking).toBe(true);
    });

    test("should detect action_button_validation mode", () => {
      const huText = "Validar que el botón Solicitar esté visible";
      const result = classifyScenarioMode(huText, null);

      expect(result.mode).toBe("action_button_validation");
      expect(result.hasBacking).toBe(false); // No route profile
    });

    test("should detect subcategory_navigation mode", () => {
      const huText = "Navegar a la categoría de tarjetas";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.mode).toBe("subcategory_navigation");
    });

    test("should default to unknown mode for unclear intent", () => {
      const huText = "Realizar operación bancaria";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.mode).toBe("unknown");
    });
  });

  test.describe("Route Backing Validation", () => {
    test("should detect missing route profile", () => {
      const huText = "Visualizar detalle del producto";
      const result = classifyScenarioMode(huText, null);

      expect(result.hasBacking).toBe(false);
      expect(result.missingSteps).toContain("routeProfile");
    });

    test("should detect missing list target for detail_navigation", () => {
      const incompleteProfile: McpRouteProfile = {
        ...completeRouteProfile,
        visibleControls: [] // Missing list targets
      };

      const huText = "Visualizar información del producto";
      const result = classifyScenarioMode(huText, incompleteProfile);

      expect(result.mode).toBe("detail_navigation");
      expect(result.hasBacking).toBe(false);
      expect(result.missingSteps).toContain("list_target");
    });

    test("should detect missing domainTerm for detail_navigation", () => {
      const incompleteProfile: McpRouteProfile = {
        ...completeRouteProfile,
        domainTerms: {} // Missing domain terms
      };

      const huText = "Visualizar detalle del producto";
      const result = classifyScenarioMode(huText, incompleteProfile);

      expect(result.mode).toBe("detail_navigation");
      expect(result.hasBacking).toBe(false);
      expect(result.missingSteps).toContain("domainTerm_for_selection");
    });

    test("should detect missing intermediates for subcategory_navigation", () => {
      const incompleteProfile: McpRouteProfile = {
        ...completeRouteProfile,
        intermediates: {} // Missing intermediates
      };

      const huText = "Navegar a la categoría de tarjetas";
      const result = classifyScenarioMode(huText, incompleteProfile);

      expect(result.mode).toBe("subcategory_navigation");
      expect(result.hasBacking).toBe(false);
      expect(result.missingSteps).toContain("intermediates");
    });

    test("should detect missing return control for return_navigation", () => {
      const incompleteProfile: McpRouteProfile = {
        ...completeRouteProfile,
        visibleControls: ["Iniciar", "Información de productos", "Tarjetas"] // No "Volver"
      };

      const huText = "Volver al listado después de ver el detalle";
      const result = classifyScenarioMode(huText, incompleteProfile);

      expect(result.mode).toBe("return_navigation");
      expect(result.hasBacking).toBe(false);
      expect(result.missingSteps).toContain("return_control");
    });
  });

  test.describe("Confidence Assignment", () => {
    test("should assign high confidence when all backing exists", () => {
      const huText = "Visualizar detalle del producto";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.confidence).toBe("high");
      expect(result.hasBacking).toBe(true);
    });

    test("should assign medium confidence for missing intermediate", () => {
      const incompleteProfile: McpRouteProfile = {
        ...completeRouteProfile,
        intermediates: {}
      };

      const huText = "Navegar a tarjetas";
      const result = classifyScenarioMode(huText, incompleteProfile);

      expect(result.confidence).toBe("medium");
    });

    test("should assign low confidence for missing route profile", () => {
      const huText = "Visualizar detalle del producto";
      const result = classifyScenarioMode(huText, null);

      expect(result.confidence).toBe("low");
      expect(result.hasBacking).toBe(false);
    });

    test("should assign low confidence for unknown mode", () => {
      const huText = "Realizar operación compleja";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.mode).toBe("unknown");
      expect(result.confidence).toBe("low");
    });
  });

  test.describe("Required Route Depth", () => {
    test("should calculate depth 1 for listing_validation", () => {
      const huText = "Validar que se muestre el listado";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.requiredRouteDepth).toBe(1);
    });

    test("should calculate depth 2 for subcategory_navigation", () => {
      const huText = "Navegar a la categoría";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.requiredRouteDepth).toBe(2);
    });

    test("should calculate depth 3 for detail_navigation", () => {
      const huText = "Visualizar información del producto";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.requiredRouteDepth).toBe(3);
    });

    test("should calculate depth 3 for return_navigation", () => {
      const huText = "Volver al listado";
      const result = classifyScenarioMode(huText, completeRouteProfile);

      expect(result.requiredRouteDepth).toBe(3);
    });
  });
});
