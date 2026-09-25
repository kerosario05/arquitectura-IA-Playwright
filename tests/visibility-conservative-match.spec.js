"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
function makeScenario(title, steps) {
    return {
        sourceIssueKey: "HU-VIS",
        title,
        steps,
        preconditions: [],
        expectedResult: "OK",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_discovery",
        setupStrategy: "no_login",
        appSlug: "test-app",
        routeProfile: "",
        dataRequirements: "",
        nonExecutableCriteria: "",
        mcpExecutable: true,
    };
}
function visibilityStatus(hu, scenarios) {
    const { requirements } = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, [], hu, "HU-VIS");
    const vis = requirements.find((r) => r.category === "visibility");
    (0, test_1.expect)(vis, "visibility requirement must exist").toBeTruthy();
    return vis.status;
}
(0, test_1.test)("typo-near + morphological variant: 'apntalla de inicio' covered by 'pantalla inicial'", () => {
    const hu = "visualizar la apntalla de inicio.";
    const scenarios = [makeScenario("Bienvenida", ['1. Validar que se muestre "pantalla inicial".'])];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("covered");
});
(0, test_1.test)("exact existing match remains covered", () => {
    const hu = "visualizar la pantalla de inicio.";
    const scenarios = [makeScenario("Inicio", ['1. Validar que se muestre "pantalla de inicio".'])];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("covered");
});
(0, test_1.test)("single shared generic token is NOT enough: 'pantalla de inicio' vs 'pantalla de error'", () => {
    const hu = "visualizar la pantalla de inicio.";
    const scenarios = [makeScenario("Error", ['1. Validar que se muestre "pantalla de error".'])];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
(0, test_1.test)("distinct business terms NOT conflated: 'pantalla de selección' vs 'pantalla de inicio'", () => {
    const hu = "visualizar la pantalla de selección.";
    const scenarios = [makeScenario("Inicio", ['1. Validar que se muestre "pantalla de inicio".'])];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
(0, test_1.test)("distinct business terms NOT conflated: 'mensaje de bienvenida' vs 'mensaje de error'", () => {
    const hu = "visualizar el mensaje de bienvenida.";
    const scenarios = [makeScenario("Error", ['1. Validar que se muestre "mensaje de error".'])];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
(0, test_1.test)("tokens from different assertions are never mixed → false", () => {
    const hu = "visualizar la apntalla de inicio.";
    const scenarios = [
        makeScenario("Split A", ['1. Validar que se muestre "pantalla".', '2. Validar que se muestre "inicial".']),
    ];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
(0, test_1.test)("generic false-positive: 'saldo' vs 'salto' must NOT match", () => {
    const hu = "visualizar el saldo.";
    const scenarios = [makeScenario("Salto", ['1. Validar que se muestre "salto".'])];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
(0, test_1.test)("generic false-positive: 'estado' vs 'estufa' must NOT match", () => {
    const hu = "visualizar el estado.";
    const scenarios = [makeScenario("Estufa", ['1. Validar que se muestre "estufa".'])];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
