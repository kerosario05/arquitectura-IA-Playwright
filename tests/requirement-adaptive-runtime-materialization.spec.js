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
(0, test_1.test)("dynamic selection, sensitive action, and visibility classification (no routeProfile/runtime)", () => {
    const hu = [
        "Seleccionar un elemento del listado dinámico.",
        "Presionar Acción sensible.",
        "Mostrar mensaje de error.",
    ].join(" ");
    const { requirements, summary, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [], hu, "HU-TEST");
    const dynamic = requirements.find((r) => r.category === "action" && r.sourceText.includes("elemento"));
    const sensitive = requirements.find((r) => r.category === "action" && r.sourceText.includes("Acción sensible"));
    const visibility = requirements.find((r) => r.category === "visibility");
    // A) dynamic collection selection → adaptive, requires_runtime_materialization
    (0, test_1.expect)(dynamic).toBeDefined();
    (0, test_1.expect)(dynamic.status).toBe("adaptive");
    (0, test_1.expect)(dynamic.reasonCode).toBe("requires_runtime_materialization");
    // B) sensitive action without runtime evidence → adaptive, not executable
    (0, test_1.expect)(sensitive).toBeDefined();
    (0, test_1.expect)(sensitive.status).toBe("adaptive");
    (0, test_1.expect)(sensitive.reasonCode).toBe("sensitive_action_requires_runtime_evidence");
    // C) visibility uncovered and functionally generable → stays missing
    (0, test_1.expect)(visibility).toBeDefined();
    (0, test_1.expect)(visibility.status).toBe("incompleteRequirement");
    (0, test_1.expect)(visibility.reasonCode).toBe("no_covering_scenario");
    (0, test_1.expect)(summary.adaptive).toBe(2);
    (0, test_1.expect)(functionalCoverage.missing).toContain(visibility.id);
    (0, test_1.expect)(functionalCoverage.missing).not.toContain(dynamic.id);
    (0, test_1.expect)(functionalCoverage.missing).not.toContain(sensitive.id);
    (0, test_1.expect)(functionalCoverage.valid).toBe(false);
});
(0, test_1.test)("D) same visibility requirement becomes covered when an equivalent assertion exists", () => {
    const hu = [
        "Seleccionar un elemento del listado dinámico.",
        "Presionar Acción sensible.",
        "Mostrar mensaje de error.",
    ].join(" ");
    const uncovered = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [], hu, "HU-TEST");
    const visUncovered = uncovered.requirements.find((r) => r.category === "visibility");
    (0, test_1.expect)(visUncovered.status).toBe("incompleteRequirement");
    (0, test_1.expect)(uncovered.functionalCoverage.missing).toContain(visUncovered.id);
    const coveringScenario = makeScenario("Muestra error", ['1. Validar que se muestre "mensaje de error".']);
    const covered = (0, scenario_functional_quality_1.buildRequirementAccounting)([coveringScenario], [], hu, "HU-TEST");
    const visCovered = covered.requirements.find((r) => r.category === "visibility");
    (0, test_1.expect)(visCovered.status).toBe("covered");
    (0, test_1.expect)(covered.functionalCoverage.missing).not.toContain(visCovered.id);
    (0, test_1.expect)(covered.functionalCoverage.valid).toBe(true);
});
(0, test_1.test)("VALIDAR ACCOUNTING FINAL — after covering the missing visibility: missing=0 valid=true, adaptive unchanged", () => {
    const hu = [
        "Seleccionar un elemento del listado dinámico.",
        "Presionar Acción sensible.",
        "Mostrar mensaje de error.",
        "Mostrar el resumen.",
    ].join(" ");
    const scenarioResumen = makeScenario("Resumen", ['1. Validar que se muestre "resumen".']);
    // Before: resumen covered, mensaje de error missing
    const before = (0, scenario_functional_quality_1.buildRequirementAccounting)([scenarioResumen], [], hu, "HU-TEST");
    (0, test_1.expect)(before.functionalCoverage.required).toBe(4);
    (0, test_1.expect)(before.functionalCoverage.covered).toBe(1);
    (0, test_1.expect)(before.summary.adaptive).toBe(2);
    (0, test_1.expect)(before.functionalCoverage.missing.length).toBe(1);
    (0, test_1.expect)(before.functionalCoverage.valid).toBe(false);
    // After: add scenario asserting "mensaje de error" → missing=0, valid=true,
    // WITHOUT converting any adaptive into covered.
    const scenarioError = makeScenario("Muestra error", ['1. Validar que se muestre "mensaje de error".']);
    const after = (0, scenario_functional_quality_1.buildRequirementAccounting)([scenarioResumen, scenarioError], [], hu, "HU-TEST");
    (0, test_1.expect)(after.functionalCoverage.required).toBe(4);
    (0, test_1.expect)(after.functionalCoverage.covered).toBe(2);
    (0, test_1.expect)(after.functionalCoverage.missing).toEqual([]);
    (0, test_1.expect)(after.functionalCoverage.valid).toBe(true);
    (0, test_1.expect)(after.summary.adaptive).toBe(2); // unchanged
    (0, test_1.expect)(after.requirements.filter((r) => r.status === "adaptive")).toHaveLength(2);
});
(0, test_1.test)("E) dynamic selection scenario 'el primer elemento visible' — no authority, adaptive", () => {
    const hu = "Seleccionar el primer elemento visible del listado.";
    const scenario = makeScenario("Primer elemento", ['1. Clic en "Primer elemento visible".']);
    const { requirements, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)([scenario], [], hu, "HU-TEST");
    const dynamic = requirements.find((r) => r.category === "action");
    (0, test_1.expect)(dynamic).toBeDefined();
    // Dynamic selection is never a concrete execution-backed target: adaptive.
    (0, test_1.expect)(dynamic.status).toBe("adaptive");
    (0, test_1.expect)(dynamic.reasonCode).toBe("requires_runtime_materialization");
    // Not counted as missing (pending runtime materialization).
    (0, test_1.expect)(functionalCoverage.missing).not.toContain(dynamic.id);
    // buildRequirementAccounting never touches allowedExecutableClicks / authority.
    (0, test_1.expect)(scenario.mcpExecutable).toBe(true); // authority decided elsewhere
});
(0, test_1.test)("ordinary uncovered concrete action stays missing (no blanket adaptive)", () => {
    const hu = "Seleccionar Alfa.";
    const { requirements, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [], hu, "HU-TEST");
    const action = requirements.find((r) => r.category === "action");
    (0, test_1.expect)(action).toBeDefined();
    (0, test_1.expect)(action.status).toBe("incompleteRequirement");
    (0, test_1.expect)(action.reasonCode).toBe("no_covering_scenario");
    (0, test_1.expect)(functionalCoverage.missing).toContain(action.id);
    (0, test_1.expect)(functionalCoverage.valid).toBe(false);
});
