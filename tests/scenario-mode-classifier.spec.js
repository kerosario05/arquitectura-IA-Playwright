"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_mode_classifier_1 = require("../src/scenarios/scenario-mode-classifier");
test_1.test.describe("Scenario Mode Classifier", () => {
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
    test_1.test.describe("Mode Detection", () => {
        (0, test_1.test)("should detect detail_navigation mode", () => {
            const huText = "Visualizar detalle del producto incluyendo nombre y descripción";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.mode).toBe("detail_navigation");
            (0, test_1.expect)(result.hasBacking).toBe(true);
        });
        (0, test_1.test)("should detect listing_validation mode", () => {
            const huText = "Validar que se muestre el listado de opciones disponibles";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.mode).toBe("listing_validation");
            (0, test_1.expect)(result.hasBacking).toBe(true);
        });
        (0, test_1.test)("should detect return_navigation mode", () => {
            const huText = "Volver al listado después de visualizar el detalle";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.mode).toBe("return_navigation");
            (0, test_1.expect)(result.hasBacking).toBe(true);
        });
        (0, test_1.test)("should detect action_button_validation mode", () => {
            const huText = "Validar que el botón Solicitar esté visible";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, null);
            (0, test_1.expect)(result.mode).toBe("action_button_validation");
            (0, test_1.expect)(result.hasBacking).toBe(false); // No route profile
        });
        (0, test_1.test)("should detect subcategory_navigation mode", () => {
            const huText = "Navegar a la categoría de tarjetas";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.mode).toBe("subcategory_navigation");
        });
        (0, test_1.test)("should default to unknown mode for unclear intent", () => {
            const huText = "Realizar operación bancaria";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.mode).toBe("unknown");
        });
    });
    test_1.test.describe("Route Backing Validation", () => {
        (0, test_1.test)("should detect missing route profile", () => {
            const huText = "Visualizar detalle del producto";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, null);
            (0, test_1.expect)(result.hasBacking).toBe(false);
            (0, test_1.expect)(result.missingSteps).toContain("routeProfile");
        });
        (0, test_1.test)("should detect missing list target for detail_navigation", () => {
            const incompleteProfile = {
                ...completeRouteProfile,
                visibleControls: [] // Missing list targets
            };
            const huText = "Visualizar información del producto";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, incompleteProfile);
            (0, test_1.expect)(result.mode).toBe("detail_navigation");
            (0, test_1.expect)(result.hasBacking).toBe(false);
            (0, test_1.expect)(result.missingSteps).toContain("list_target");
        });
        (0, test_1.test)("should detect missing domainTerm for detail_navigation", () => {
            const incompleteProfile = {
                ...completeRouteProfile,
                domainTerms: {} // Missing domain terms
            };
            const huText = "Visualizar detalle del producto";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, incompleteProfile);
            (0, test_1.expect)(result.mode).toBe("detail_navigation");
            (0, test_1.expect)(result.hasBacking).toBe(false);
            (0, test_1.expect)(result.missingSteps).toContain("domainTerm_for_selection");
        });
        (0, test_1.test)("should detect missing intermediates for subcategory_navigation", () => {
            const incompleteProfile = {
                ...completeRouteProfile,
                intermediates: {} // Missing intermediates
            };
            const huText = "Navegar a la categoría de tarjetas";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, incompleteProfile);
            (0, test_1.expect)(result.mode).toBe("subcategory_navigation");
            (0, test_1.expect)(result.hasBacking).toBe(false);
            (0, test_1.expect)(result.missingSteps).toContain("intermediates");
        });
        (0, test_1.test)("should detect missing return control for return_navigation", () => {
            const incompleteProfile = {
                ...completeRouteProfile,
                visibleControls: ["Iniciar", "Información de productos", "Tarjetas"] // No "Volver"
            };
            const huText = "Volver al listado después de ver el detalle";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, incompleteProfile);
            (0, test_1.expect)(result.mode).toBe("return_navigation");
            (0, test_1.expect)(result.hasBacking).toBe(false);
            (0, test_1.expect)(result.missingSteps).toContain("return_control");
        });
    });
    test_1.test.describe("Confidence Assignment", () => {
        (0, test_1.test)("should assign high confidence when all backing exists", () => {
            const huText = "Visualizar detalle del producto";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.confidence).toBe("high");
            (0, test_1.expect)(result.hasBacking).toBe(true);
        });
        (0, test_1.test)("should assign medium confidence for missing intermediate", () => {
            const incompleteProfile = {
                ...completeRouteProfile,
                intermediates: {}
            };
            const huText = "Navegar a tarjetas";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, incompleteProfile);
            (0, test_1.expect)(result.confidence).toBe("medium");
        });
        (0, test_1.test)("should assign low confidence for missing route profile", () => {
            const huText = "Visualizar detalle del producto";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, null);
            (0, test_1.expect)(result.confidence).toBe("low");
            (0, test_1.expect)(result.hasBacking).toBe(false);
        });
        (0, test_1.test)("should assign low confidence for unknown mode", () => {
            const huText = "Realizar operación compleja";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.mode).toBe("unknown");
            (0, test_1.expect)(result.confidence).toBe("low");
        });
    });
    test_1.test.describe("Required Route Depth", () => {
        (0, test_1.test)("should calculate depth 1 for listing_validation", () => {
            const huText = "Validar que se muestre el listado";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.requiredRouteDepth).toBe(1);
        });
        (0, test_1.test)("should calculate depth 2 for subcategory_navigation", () => {
            const huText = "Navegar a la categoría";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.requiredRouteDepth).toBe(2);
        });
        (0, test_1.test)("should calculate depth 3 for detail_navigation", () => {
            const huText = "Visualizar información del producto";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.requiredRouteDepth).toBe(3);
        });
        (0, test_1.test)("should calculate depth 3 for return_navigation", () => {
            const huText = "Volver al listado";
            const result = (0, scenario_mode_classifier_1.classifyScenarioMode)(huText, completeRouteProfile);
            (0, test_1.expect)(result.requiredRouteDepth).toBe(3);
        });
    });
});
