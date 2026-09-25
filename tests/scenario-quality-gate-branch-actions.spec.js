"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const codex_scenario_generator_1 = require("../src/scenarios/codex-scenario-generator");
function makeIssue(overrides = {}) {
    return {
        key: overrides.key ?? "HU-1",
        summary: overrides.summary ?? "HU de opciones",
        description: overrides.description ?? "",
        acceptanceCriteria: overrides.acceptanceCriteria ?? null,
        labels: overrides.labels ?? [],
        components: overrides.components ?? [],
        status: overrides.status ?? "To Do",
        issueType: overrides.issueType ?? "Story",
    };
}
(0, test_1.test)("quality gate preserves decisive option click detected from option flows", () => {
    const issue = makeIssue({
        key: "HU-ALFA-BETA",
        description: 'Si el usuario selecciona "Opción Beta", el sistema debe mostrar "Destino Beta".',
    });
    const routeProfile = {
        name: "test-profile",
        entry: [],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Opción Beta", "Destino Beta"],
        representativeFixture: {},
        notes: [],
    };
    const scenarios = [
        {
            sourceIssueKey: issue.key,
            title: "Flujo beta",
            steps: ['1. Clic en "Iniciar".', '2. Clic en "Opción Beta".', '3. Validar que se muestre "Destino Beta".'],
            expectedResult: "OK",
        },
    ];
    const result = (0, codex_scenario_generator_1.applyScenarioQualityGate)(scenarios, [issue], routeProfile);
    (0, test_1.expect)(result.rejected).toHaveLength(0);
    (0, test_1.expect)(result.scenarios).toHaveLength(1);
    (0, test_1.expect)(result.scenarios[0].steps.join(" ")).toContain('Clic en "Opción Beta"');
});
(0, test_1.test)("quality gate still removes unrelated visible-control navigation not required by HU option flows", () => {
    const issue = makeIssue({
        key: "HU-SIMPLE",
        description: 'Si el usuario selecciona "Opción Alfa", el sistema debe mostrar "Destino Alfa".',
    });
    const routeProfile = {
        name: "test-profile",
        entry: [],
        aliases: {},
        intermediates: {},
        domainTerms: {},
        visibleControls: ["Banner informativo", "Destino Alfa"],
        representativeFixture: {},
        notes: [],
    };
    const scenarios = [
        {
            sourceIssueKey: issue.key,
            title: "Flujo con ruido",
            steps: ['1. Clic en "Banner informativo".', '2. Clic en "Opción Alfa".', '3. Validar que se muestre "Destino Alfa".'],
            expectedResult: "OK",
        },
    ];
    const result = (0, codex_scenario_generator_1.applyScenarioQualityGate)(scenarios, [issue], routeProfile);
    (0, test_1.expect)(result.rejected).toHaveLength(0);
    (0, test_1.expect)(result.scenarios).toHaveLength(1);
    (0, test_1.expect)(result.scenarios[0].steps.join(" ")).not.toContain('Clic en "Banner informativo"');
    (0, test_1.expect)(result.scenarios[0].steps.join(" ")).toContain('Clic en "Opción Alfa"');
});
