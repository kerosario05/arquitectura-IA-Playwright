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
(0, test_1.test)("title fallback: title + assertion step → covered", () => {
    const hu = "visualizar la apntalla de inicio.";
    const scenarios = [
        makeScenario("Visualizar la pantalla inicial", ['1. Validar que se muestre "logo".']),
    ];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("covered");
});
(0, test_1.test)("title rejected: negative/error title has no visibility verb → not covered", () => {
    const hu = "visualizar la pantalla de inicio.";
    const scenarios = [
        makeScenario("Error al abrir pantalla de inicio", ['1. Validar que se muestre "mensaje de error".']),
    ];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
(0, test_1.test)("title rejected: no assertion step → not covered", () => {
    const hu = "visualizar el panel principal.";
    const scenarios = [
        makeScenario("Visualizar panel principal", ['1. Clic en "X".']),
    ];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
(0, test_1.test)("exact assertion match → covered (unchanged)", () => {
    const hu = "visualizar la pantalla de inicio.";
    const scenarios = [
        makeScenario("Inicio", ['1. Validar que se muestre "pantalla de inicio".']),
    ];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("covered");
});
(0, test_1.test)("token assertion match → covered (unchanged)", () => {
    const hu = "visualizar la apntalla de inicio.";
    const scenarios = [
        makeScenario("Bienvenida", ['1. Validar que se muestre "pantalla inicial".']),
    ];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("covered");
});
(0, test_1.test)("false positive preserved: single shared token not enough → not covered", () => {
    const hu = "visualizar la pantalla de inicio.";
    const scenarios = [
        makeScenario("Error", ['1. Validar que se muestre "pantalla de error".']),
    ];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
(0, test_1.test)("false positive preserved: saldo vs salto → not covered", () => {
    const hu = "visualizar el saldo.";
    const scenarios = [
        makeScenario("Salto", ['1. Validar que se muestre "salto".']),
    ];
    (0, test_1.expect)(visibilityStatus(hu, scenarios)).toBe("incompleteRequirement");
});
