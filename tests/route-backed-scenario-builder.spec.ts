import { test, expect } from "@playwright/test";
import { buildExecutableSteps } from "../src/scenarios/route-backed-scenario-builder";
import type { McpRouteProfile, ScenarioMode } from "../src/scenarios/scenario-types";

test.describe("Route-Backed Scenario Builder", () => {
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
      "Préstamos"
    ],
    representativeFixture: {},
    notes: []
  };

  test.describe("Listing Validation Steps", () => {
    test("should build entry + list navigation + validations only", () => {
      const mode: ScenarioMode = "listing_validation";
      const huIntent = "Validar que se muestren las opciones de productos disponibles";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // Should have entry steps
      expect(steps[0]).toContain('Clic en "Iniciar"');
      expect(steps[1]).toContain('Clic en "Información de productos"');

      // Should have validations (not clicks) for list items
      const validationSteps = steps.filter(s => s.includes("Validar que se muestre"));
      expect(validationSteps.length).toBeGreaterThan(0);

      // Should NOT have ordinal selection
      const selectionSteps = steps.filter(s => s.includes("Seleccionar el primer"));
      expect(selectionSteps.length).toBe(0);
    });

    test("should not click on list items", () => {
      const mode: ScenarioMode = "listing_validation";
      const huIntent = "Listar productos disponibles";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // After entry, should only have validations, not clicks
      const afterEntry = steps.slice(2);
      const clickSteps = afterEntry.filter(s => s.includes('Clic en "Tarjetas"') || s.includes('Clic en "Depósitos"'));
      expect(clickSteps.length).toBe(0);
    });
  });

  test.describe("Detail Navigation Steps", () => {
    test("should build entry + list + selection + detail validations", () => {
      const mode: ScenarioMode = "detail_navigation";
      const huIntent = "Visualizar información del producto incluyendo nombre y descripción";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // Should have entry steps
      expect(steps[0]).toContain('Clic en "Iniciar"');
      expect(steps[1]).toContain('Clic en "Información de productos"');

      // Should have ordinal selection
      const selectionSteps = steps.filter(s => s.includes("Seleccionar el primer"));
      expect(selectionSteps.length).toBe(1);
      expect(selectionSteps[0]).toContain("producto"); // Domain term

      // Should have detail validations after selection
      const validationSteps = steps.filter(s => s.includes("Validar que se muestre"));
      expect(validationSteps.length).toBeGreaterThan(0);
    });

    test("should include intermediate navigation", () => {
      const mode: ScenarioMode = "detail_navigation";
      const huIntent = "Ver detalle de tarjeta de crédito";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // Should navigate through intermediate (Tarjeta de Crédito)
      const intermediateStep = steps.find(s => s.includes('Clic en "Tarjeta de Crédito"'));
      expect(intermediateStep).toBeDefined();
    });

    test("should use domain term from route profile", () => {
      const mode: ScenarioMode = "detail_navigation";
      const huIntent = "Visualizar información del producto";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      const selectionStep = steps.find(s => s.includes("Seleccionar el primer"));
      expect(selectionStep).toContain("producto"); // From domainTerms
    });
  });

  test.describe("Return Navigation Steps", () => {
    test("should build full cycle with return click", () => {
      const mode: ScenarioMode = "return_navigation";
      const huIntent = "Volver al listado después de ver el detalle";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // Should have detail navigation first
      const selectionStep = steps.find(s => s.includes("Seleccionar el primer"));
      expect(selectionStep).toBeDefined();

      // Should have return button validation
      const returnValidation = steps.find(s => s.includes('Validar que el botón "Volver" esté visible'));
      expect(returnValidation).toBeDefined();

      // Should have return click
      const returnClick = steps.find(s => s.includes('Clic en "Volver"'));
      expect(returnClick).toBeDefined();

      // Return validation should come after return click
      const returnValidationIndex = steps.findIndex(s => s.includes('Validar que el botón "Volver"'));
      const returnClickIndex = steps.findIndex(s => s.includes('Clic en "Volver"'));
      expect(returnClickIndex).toBeGreaterThan(returnValidationIndex);
    });
  });

  test.describe("Subcategory Navigation Steps", () => {
    test("should build entry + intermediates + validation", () => {
      const mode: ScenarioMode = "subcategory_navigation";
      const huIntent = "Navegar a la categoría de tarjetas";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // Should have entry steps
      expect(steps[0]).toContain('Clic en "Iniciar"');

      // Should have intermediate navigation
      const intermediateStep = steps.find(s => s.includes('Clic en "Tarjeta de Crédito"'));
      expect(intermediateStep).toBeDefined();
    });
  });

  test.describe("Action Button Validation Steps", () => {
    test("should validate button visible, no click", () => {
      const mode: ScenarioMode = "action_button_validation";
      const huIntent = "Validar que el botón Solicitar esté visible";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // Should have entry steps
      expect(steps[0]).toContain('Clic en "Iniciar"');

      // Should validate button visible
      const validationStep = steps.find(s => s.includes('Validar que el botón "Solicitar" esté visible'));
      expect(validationStep).toBeDefined();

      // Should NOT have click on sensitive button
      const clickStep = steps.find(s => s.includes('Clic en "Solicitar"'));
      expect(clickStep).toBeUndefined();
    });

    test("should detect Pagar action", () => {
      const mode: ScenarioMode = "action_button_validation";
      const huIntent = "Verificar que el botón Pagar esté disponible";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      const validationStep = steps.find(s => s.includes('Validar que el botón "Pagar" esté visible'));
      expect(validationStep).toBeDefined();
    });
  });

  test.describe("Unknown Mode", () => {
    test("should return empty steps for unknown mode", () => {
      const mode: ScenarioMode = "unknown";
      const huIntent = "Realizar operación compleja";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      expect(steps.length).toBe(0);
    });
  });

  test.describe("Step Numbering", () => {
    test("should use canonical numbering format", () => {
      const mode: ScenarioMode = "detail_navigation";
      const huIntent = "Ver detalle del producto";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // Each step should be numbered
      steps.forEach((step, index) => {
        const expectedNumber = index + 1;
        expect(step).toMatch(new RegExp(`^${expectedNumber}\\.`));
      });
    });

    test("should have sequential numbering", () => {
      const mode: ScenarioMode = "listing_validation";
      const huIntent = "Listar productos";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      for (let i = 0; i < steps.length; i++) {
        expect(steps[i]).toMatch(new RegExp(`^${i + 1}\\.`));
      }
    });
  });

  test.describe("Canonical Labels", () => {
    test("should use visibleLabel from entry", () => {
      const mode: ScenarioMode = "listing_validation";
      const huIntent = "Listar productos";

      const steps = buildExecutableSteps(mode, completeRouteProfile, huIntent);

      // Should use "Iniciar" not "iniciar"
      expect(steps[0]).toContain('"Iniciar"');
      // Should use "Información de productos" not "informacion_productos"
      expect(steps[1]).toContain('"Información de productos"');
    });
  });
});
