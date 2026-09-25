"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
function makeScenario(title, steps) {
    return {
        sourceIssueKey: "HU-TEST",
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
(0, test_1.test)("invented ordinal removed, functional noun preserved", () => {
    const hu = "Seleccionar un préstamo del listado.";
    const step = "Seleccionar el primer préstamo visible del listado";
    const result = (0, scenario_functional_quality_1.normalizeInventedOrdinalSelection)(step, hu);
    (0, test_1.expect)(result).toBe("Seleccionar un préstamo visible del listado");
});
(0, test_1.test)("ordinal declared by HU is preserved", () => {
    const hu = "Seleccionar la primera opción del listado.";
    const step = "Seleccionar la primera opción del listado";
    const result = (0, scenario_functional_quality_1.normalizeInventedOrdinalSelection)(step, hu);
    (0, test_1.expect)(result).toBe(step);
});
(0, test_1.test)("invented ordinal with feminine noun normalized", () => {
    const hu = "Seleccionar una cuenta.";
    const step = "Seleccionar la primera cuenta";
    const result = (0, scenario_functional_quality_1.normalizeInventedOrdinalSelection)(step, hu);
    (0, test_1.expect)(result).toBe("Seleccionar una cuenta");
});
(0, test_1.test)("non-ordinal concrete selection unchanged", () => {
    const hu = "Seleccionar producto.";
    const step = "Seleccionar producto";
    (0, test_1.expect)((0, scenario_functional_quality_1.normalizeInventedOrdinalSelection)(step, hu)).toBe(step);
});
(0, test_1.test)("quality pass normalizes steps in scenarios; accounting stays adaptive without authority", () => {
    const hu = "Seleccionar un préstamo del listado.";
    const scenario = makeScenario("Selecciona préstamo", ["Seleccionar el primer préstamo visible del listado."]);
    const quality = (0, scenario_functional_quality_1.applyFunctionalScenarioQuality)([scenario], [], hu);
    const out = quality.scenarios[0];
    (0, test_1.expect)(out.steps).toContain("Seleccionar un préstamo visible del listado.");
    // Accounting: dynamic selection stays adaptive / requires_runtime_materialization
    const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)(out.steps ? [out] : [], [], hu, "HU-TEST");
    const dynamic = accounting.requirements.find((r) => r.category === "action");
    (0, test_1.expect)(dynamic).toBeDefined();
    (0, test_1.expect)(dynamic.status).toBe("adaptive");
    (0, test_1.expect)(dynamic.reasonCode).toBe("requires_runtime_materialization");
    (0, test_1.expect)(accounting.functionalCoverage.missing).not.toContain(dynamic.id);
    // No authority introduced: accounting never touches allowedExecutableClicks
    (0, test_1.expect)(accounting.summary.adaptive).toBeGreaterThanOrEqual(1);
    (0, test_1.expect)(out.mcpExecutable).toBe(true); // execution backing decided elsewhere
});
