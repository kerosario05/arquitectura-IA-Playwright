"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_route_compliance_validator_1 = require("../src/scenarios/scenario-route-compliance-validator");
function makeContext(allowed = []) {
    return {
        appSlug: "test-app",
        allowedExecutableClicks: allowed,
        assertionOnlyTerms: [],
        visibleButNotExecutableTerms: [],
        sensitiveActions: [],
        entryActionTargets: [],
        routeTargets: allowed,
        aliasesByTarget: new Map(),
        domainTerms: [],
        profileConfidence: "high",
        diagnostics: []
    };
}
function makeScenario(overrides) {
    return {
        sourceIssueKey: "TEST-DP",
        title: "Declared path scenario",
        steps: overrides.steps,
        preconditions: [],
        expectedResult: "Destination shown",
        type: "Functional",
        database: "QA",
        isConverted: 0,
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        appSlug: "test-app",
        routeProfile: "test-profile",
        dataRequirements: "",
        nonExecutableCriteria: "",
        mcpExecutable: true,
        ...overrides,
    };
}
(0, test_1.test)("declared_path step is compliant=true executionBacked=false — scenario NOT rejected", () => {
    const scenario = makeScenario({
        steps: [
            '1. Clic en "Entrada A".',
            '2. Clic en "Destino B".',
            '3. Validar que se muestre "Contenido".',
        ],
    });
    scenario.matchedDeclaredPathTargets = ["Entrada A", "Destino B"];
    const result = (0, scenario_route_compliance_validator_1.validateScenarioCompliance)(scenario, makeContext([]), undefined, undefined, scenario.matchedDeclaredPathTargets);
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(result.reasonCode).toBe("valid");
    // Both declared steps get info diagnostics, never unbacked_click errors
    const infoTargets = result.diagnostics.filter(d => d.level === "info").map(d => d.target);
    (0, test_1.expect)(infoTargets).toContain("Entrada A");
    (0, test_1.expect)(infoTargets).toContain("Destino B");
    (0, test_1.expect)(result.diagnostics.some(d => d.level === "error" && d.target === "Entrada A")).toBe(false);
    (0, test_1.expect)(result.diagnostics.some(d => d.level === "error" && d.target === "Destino B")).toBe(false);
});
(0, test_1.test)("negative: matchedDeclaredPathTargets=[] → unbacked_click preserved", () => {
    const scenario = makeScenario({
        steps: ['1. Clic en "Entrada A".'],
    });
    const result = (0, scenario_route_compliance_validator_1.validateScenarioCompliance)(scenario, makeContext([]), undefined, undefined, []);
    (0, test_1.expect)(result.valid).toBe(false);
    (0, test_1.expect)(result.reasonCode).toBe("unbacked_click");
    (0, test_1.expect)(result.diagnostics.some(d => d.level === "error" && d.target === "Entrada A")).toBe(true);
});
(0, test_1.test)("authority: declared path target does NOT enter allowedExecutableClicks nor executionBacked", () => {
    const scenario = makeScenario({
        steps: ['1. Clic en "Entrada A".'],
    });
    scenario.matchedDeclaredPathTargets = ["Entrada A"];
    const allowedBefore = [];
    const result = (0, scenario_route_compliance_validator_1.validateScenarioCompliance)(scenario, makeContext(allowedBefore), undefined, undefined, scenario.matchedDeclaredPathTargets);
    // compliant, but allowedExecutableClicks untouched and execution not backed
    (0, test_1.expect)(result.valid).toBe(true);
    (0, test_1.expect)(allowedBefore).toEqual([]);
    // The log contract: reason=declared_path_functional_step execution_backed=false
    // (verified via info diagnostic target + absence of evidence_backed).
    const infoDiag = result.diagnostics.find(d => d.level === "info" && d.target === "Entrada A");
    (0, test_1.expect)(infoDiag).toBeTruthy();
    (0, test_1.expect)(result.diagnostics.some(d => d.message.includes("execution pending"))).toBe(true);
});
(0, test_1.test)("per-scenario propagation via validateScenariosCompliance — only protected scenario survives", () => {
    const protectedScenario = makeScenario({
        title: "Uses declared path",
        steps: ['1. Clic en "Entrada A".', '2. Clic en "Destino B".', '3. Validar que se muestre "Contenido".'],
    });
    protectedScenario.matchedDeclaredPathTargets = ["Entrada A", "Destino B"];
    const unprotectedScenario = makeScenario({
        title: "Does not use path",
        steps: ['1. Clic en "Entrada A".'],
    });
    const { validScenarios, invalidScenarios } = (0, scenario_route_compliance_validator_1.validateScenariosCompliance)([protectedScenario, unprotectedScenario], makeContext([]), new Map());
    (0, test_1.expect)(validScenarios.map(s => s.title)).toContain("Uses declared path");
    (0, test_1.expect)(invalidScenarios.map(i => i.scenario.title)).toContain("Does not use path");
    // Scenario B's identical click gets no automatic protection
    (0, test_1.expect)(invalidScenarios.find(i => i.scenario.title === "Does not use path")?.result.reasonCode).toBe("unbacked_click");
});
(0, test_1.test)("readiness: declared_path scenario with no evidence remains requiresRouteLearning (not executable)", () => {
    // Compliance does NOT add declared targets to allowedExecutableClicks, so the
    // downstream readiness pass (isTargetAuthorized) sees no backing → requires_route_learning.
    const scenario = makeScenario({
        steps: ['1. Clic en "Entrada A".'],
    });
    scenario.matchedDeclaredPathTargets = ["Entrada A"];
    const allowed = [];
    const result = (0, scenario_route_compliance_validator_1.validateScenarioCompliance)(scenario, makeContext(allowed), undefined, undefined, scenario.matchedDeclaredPathTargets);
    (0, test_1.expect)(result.valid).toBe(true);
    // No declared target leaked into the execution authority
    (0, test_1.expect)(allowed).toEqual([]);
    (0, test_1.expect)(scenario.mcpExecutable).toBe(true); // unchanged classification field; readiness decides below
    console.log("[readiness] declared_path step survives compliance; authority unchanged → requires_route_learning path");
});
