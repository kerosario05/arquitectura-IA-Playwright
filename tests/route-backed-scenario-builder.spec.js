"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const route_backed_scenario_builder_1 = require("../src/scenarios/route-backed-scenario-builder");
test_1.test.describe("Route-Backed Scenario Builder", () => {
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
            "Préstamos"
        ],
        representativeFixture: {},
        notes: []
    };
    test_1.test.describe("Listing Validation Steps", () => {
        (0, test_1.test)("should build entry + list navigation + validations only", () => {
            const mode = "listing_validation";
            const huIntent = "Validar que se muestren las opciones de productos disponibles";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // Should have entry steps
            (0, test_1.expect)(steps[0]).toContain('Clic en "Iniciar"');
            (0, test_1.expect)(steps[1]).toContain('Clic en "Información de productos"');
            // Should have validations (not clicks) for list items
            const validationSteps = steps.filter(s => s.includes("Validar que se muestre"));
            (0, test_1.expect)(validationSteps.length).toBeGreaterThan(0);
            // Should NOT have ordinal selection
            const selectionSteps = steps.filter(s => s.includes("Seleccionar el primer"));
            (0, test_1.expect)(selectionSteps.length).toBe(0);
        });
        (0, test_1.test)("should not click on list items", () => {
            const mode = "listing_validation";
            const huIntent = "Listar productos disponibles";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // After entry, should only have validations, not clicks
            const afterEntry = steps.slice(2);
            const clickSteps = afterEntry.filter(s => s.includes('Clic en "Tarjetas"') || s.includes('Clic en "Depósitos"'));
            (0, test_1.expect)(clickSteps.length).toBe(0);
        });
    });
    test_1.test.describe("Detail Navigation Steps", () => {
        (0, test_1.test)("should build entry + list + selection + detail validations", () => {
            const mode = "detail_navigation";
            const huIntent = "Visualizar información del producto incluyendo nombre y descripción";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // Should have entry steps
            (0, test_1.expect)(steps[0]).toContain('Clic en "Iniciar"');
            (0, test_1.expect)(steps[1]).toContain('Clic en "Información de productos"');
            // Should have ordinal selection
            const selectionSteps = steps.filter(s => s.includes("Seleccionar el primer"));
            (0, test_1.expect)(selectionSteps.length).toBe(1);
            (0, test_1.expect)(selectionSteps[0]).toContain("producto"); // Domain term
            // Should have detail validations after selection
            const validationSteps = steps.filter(s => s.includes("Validar que se muestre"));
            (0, test_1.expect)(validationSteps.length).toBeGreaterThan(0);
        });
        (0, test_1.test)("should include intermediate navigation", () => {
            const mode = "detail_navigation";
            const huIntent = "Ver detalle de tarjeta de crédito";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // Should navigate through intermediate (Tarjeta de Crédito)
            const intermediateStep = steps.find(s => s.includes('Clic en "Tarjeta de Crédito"'));
            (0, test_1.expect)(intermediateStep).toBeDefined();
        });
        (0, test_1.test)("should use domain term from route profile", () => {
            const mode = "detail_navigation";
            const huIntent = "Visualizar información del producto";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            const selectionStep = steps.find(s => s.includes("Seleccionar el primer"));
            (0, test_1.expect)(selectionStep).toContain("producto"); // From domainTerms
        });
    });
    test_1.test.describe("Return Navigation Steps", () => {
        (0, test_1.test)("should build full cycle with return click", () => {
            const mode = "return_navigation";
            const huIntent = "Volver al listado después de ver el detalle";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // Should have detail navigation first
            const selectionStep = steps.find(s => s.includes("Seleccionar el primer"));
            (0, test_1.expect)(selectionStep).toBeDefined();
            // Should have return button validation
            const returnValidation = steps.find(s => s.includes('Validar que el botón "Volver" esté visible'));
            (0, test_1.expect)(returnValidation).toBeDefined();
            // Should have return click
            const returnClick = steps.find(s => s.includes('Clic en "Volver"'));
            (0, test_1.expect)(returnClick).toBeDefined();
            // Return validation should come after return click
            const returnValidationIndex = steps.findIndex(s => s.includes('Validar que el botón "Volver"'));
            const returnClickIndex = steps.findIndex(s => s.includes('Clic en "Volver"'));
            (0, test_1.expect)(returnClickIndex).toBeGreaterThan(returnValidationIndex);
        });
    });
    test_1.test.describe("Subcategory Navigation Steps", () => {
        (0, test_1.test)("should build entry + intermediates + validation", () => {
            const mode = "subcategory_navigation";
            const huIntent = "Navegar a la categoría de tarjetas";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // Should have entry steps
            (0, test_1.expect)(steps[0]).toContain('Clic en "Iniciar"');
            // Should have intermediate navigation
            const intermediateStep = steps.find(s => s.includes('Clic en "Tarjeta de Crédito"'));
            (0, test_1.expect)(intermediateStep).toBeDefined();
        });
    });
    test_1.test.describe("Action Button Validation Steps", () => {
        (0, test_1.test)("should validate button visible, no click", () => {
            const mode = "action_button_validation";
            const huIntent = "Validar que el botón Solicitar esté visible";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // Should have entry steps
            (0, test_1.expect)(steps[0]).toContain('Clic en "Iniciar"');
            // Should validate button visible
            const validationStep = steps.find(s => s.includes('Validar que el botón "Solicitar" esté visible'));
            (0, test_1.expect)(validationStep).toBeDefined();
            // Should NOT have click on sensitive button
            const clickStep = steps.find(s => s.includes('Clic en "Solicitar"'));
            (0, test_1.expect)(clickStep).toBeUndefined();
        });
        (0, test_1.test)("should detect Pagar action", () => {
            const mode = "action_button_validation";
            const huIntent = "Verificar que el botón Pagar esté disponible";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            const validationStep = steps.find(s => s.includes('Validar que el botón "Pagar" esté visible'));
            (0, test_1.expect)(validationStep).toBeDefined();
        });
    });
    test_1.test.describe("Unknown Mode", () => {
        (0, test_1.test)("should return empty steps for unknown mode", () => {
            const mode = "unknown";
            const huIntent = "Realizar operación compleja";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            (0, test_1.expect)(steps.length).toBe(0);
        });
    });
    test_1.test.describe("Step Numbering", () => {
        (0, test_1.test)("should use canonical numbering format", () => {
            const mode = "detail_navigation";
            const huIntent = "Ver detalle del producto";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // Each step should be numbered
            steps.forEach((step, index) => {
                const expectedNumber = index + 1;
                (0, test_1.expect)(step).toMatch(new RegExp(`^${expectedNumber}\\.`));
            });
        });
        (0, test_1.test)("should have sequential numbering", () => {
            const mode = "listing_validation";
            const huIntent = "Listar productos";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            for (let i = 0; i < steps.length; i++) {
                (0, test_1.expect)(steps[i]).toMatch(new RegExp(`^${i + 1}\\.`));
            }
        });
    });
    test_1.test.describe("Canonical Labels", () => {
        (0, test_1.test)("should use visibleLabel from entry", () => {
            const mode = "listing_validation";
            const huIntent = "Listar productos";
            const steps = (0, route_backed_scenario_builder_1.buildExecutableSteps)(mode, completeRouteProfile, huIntent);
            // Should use "Iniciar" not "iniciar"
            (0, test_1.expect)(steps[0]).toContain('"Iniciar"');
            // Should use "Información de productos" not "informacion_productos"
            (0, test_1.expect)(steps[1]).toContain('"Información de productos"');
        });
    });
});
