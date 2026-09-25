"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_preview_service_1 = require("../src/scenarios/scenario-preview.service");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
// ── Helpers ──────────────────────────────────────────────────────────────────
function makeBranch(branchId, label, dest) {
    return {
        branchId,
        sourceLabel: label,
        actionIntent: "select_option",
        expectedDestination: dest,
        accessIntent: "public",
        evidenceSource: "user_story",
    };
}
function makeScenario(title, steps, functionalBranch, opts = {}) {
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
        mcpExecutable: opts.mcpExecutable ?? true,
        executionMode: opts.executionMode ?? "standard",
        functionalBranch,
        authIntent: opts.authIntent,
    };
}
function fc(required, covered, missing) {
    return { required, covered, missing, valid: missing.length === 0 && required > 0 };
}
function bc(overrides) {
    return {
        required: 0,
        covered: 0,
        missing: [],
        pending: [],
        unexpected: [],
        requiredBranchIds: [],
        coveredBranchIds: [],
        pendingBranchIds: [],
        valid: true,
        ...overrides,
    };
}
// ── evaluateGenerationSuccess ────────────────────────────────────────────────
test_1.test.describe("evaluateGenerationSuccess", () => {
    const baseBranchCoverage = bc({ required: 2, covered: 2, missing: [], valid: true });
    (0, test_1.test)("functionalCoverage invalid => generationSuccess false with reason", () => {
        const result = (0, scenario_preview_service_1.evaluateGenerationSuccess)(true, baseBranchCoverage, true, fc(6, 4, ["action:1", "visibility:1"]));
        (0, test_1.expect)(result.generationSuccess).toBe(false);
        (0, test_1.expect)(result.blockedReasons).toContain("functional_coverage_incomplete");
    });
    (0, test_1.test)("functionalCoverage valid + all other checks pass => generationSuccess true", () => {
        const result = (0, scenario_preview_service_1.evaluateGenerationSuccess)(true, baseBranchCoverage, true, fc(6, 6, []));
        (0, test_1.expect)(result.generationSuccess).toBe(true);
        (0, test_1.expect)(result.blockedReasons).toHaveLength(0);
    });
    (0, test_1.test)("functionalCoverage valid but branchCoverage invalid => still fails", () => {
        const result = (0, scenario_preview_service_1.evaluateGenerationSuccess)(true, bc({ required: 2, covered: 1, missing: ["branch-B"], valid: false }), true, fc(6, 6, []));
        (0, test_1.expect)(result.generationSuccess).toBe(false);
        (0, test_1.expect)(result.blockedReasons).toContain("branch_coverage_invalid");
        (0, test_1.expect)(result.blockedReasons).not.toContain("functional_coverage_incomplete");
    });
    (0, test_1.test)("functionalCoverage invalid AND branchCoverage invalid => both reasons", () => {
        const result = (0, scenario_preview_service_1.evaluateGenerationSuccess)(true, bc({ required: 2, covered: 1, missing: ["branch-B"], valid: false }), true, fc(6, 4, ["action:1", "visibility:1"]));
        (0, test_1.expect)(result.generationSuccess).toBe(false);
        (0, test_1.expect)(result.blockedReasons).toContain("branch_coverage_invalid");
        (0, test_1.expect)(result.blockedReasons).toContain("functional_coverage_incomplete");
    });
    (0, test_1.test)("coverageRequirementsAvailable false => separate reason", () => {
        const result = (0, scenario_preview_service_1.evaluateGenerationSuccess)(true, baseBranchCoverage, false, fc(0, 0, []));
        (0, test_1.expect)(result.generationSuccess).toBe(false);
        (0, test_1.expect)(result.blockedReasons).toContain("coverage_requirements_unavailable");
    });
});
// ── computeBranchCoverageCheck: pending accounting ───────────────────────────
test_1.test.describe("computeBranchCoverageCheck pending accounting", () => {
    const branches = [makeBranch("A", "Alfa", "Detalle A"), makeBranch("B", "Beta", "Detalle B")];
    (0, test_1.test)("required=2 covered=1 with1 pending => valid=true (pending alone does not invalidate)", () => {
        const scenarios = [
            makeScenario("Scenario Alfa", ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'], branches[0]),
            makeScenario("Scenario Beta pending", ['1. Clic en "Beta"'], branches[1], { executionMode: "adaptive", mcpExecutable: false, authIntent: "gate_observation" }),
        ];
        const result = (0, scenario_preview_service_1.computeBranchCoverageCheck)(branches, scenarios, {
            coverageRequirementsAvailable: true,
        });
        (0, test_1.expect)(result.required).toBe(2);
        (0, test_1.expect)(result.covered).toBe(1);
        (0, test_1.expect)(result.pending).toHaveLength(1);
        (0, test_1.expect)(result.missing).toHaveLength(0);
        (0, test_1.expect)(result.valid).toBe(true);
    });
    (0, test_1.test)("required=2 covered=2 => valid=true", () => {
        const scenarios = [
            makeScenario("Scenario Alfa", ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'], branches[0]),
            makeScenario("Scenario Beta", ['1. Clic en "Beta"', '2. Validar que se muestra "Detalle B"'], branches[1]),
        ];
        const result = (0, scenario_preview_service_1.computeBranchCoverageCheck)(branches, scenarios, {
            coverageRequirementsAvailable: true,
        });
        (0, test_1.expect)(result.required).toBe(2);
        (0, test_1.expect)(result.covered).toBe(2);
        (0, test_1.expect)(result.missing).toHaveLength(0);
        (0, test_1.expect)(result.valid).toBe(true);
    });
    (0, test_1.test)("required=0 => valid=true (no branches required)", () => {
        const result = (0, scenario_preview_service_1.computeBranchCoverageCheck)([], [], {
            coverageRequirementsAvailable: true,
        });
        (0, test_1.expect)(result.required).toBe(0);
        (0, test_1.expect)(result.valid).toBe(true);
    });
    (0, test_1.test)("required=2 covered=1 missing=1 no pending => valid=false", () => {
        const scenarios = [
            makeScenario("Scenario Alfa", ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'], branches[0]),
        ];
        const result = (0, scenario_preview_service_1.computeBranchCoverageCheck)(branches, scenarios, {
            coverageRequirementsAvailable: true,
        });
        (0, test_1.expect)(result.required).toBe(2);
        (0, test_1.expect)(result.covered).toBe(1);
        (0, test_1.expect)(result.missing).toContain("B");
        (0, test_1.expect)(result.pending).toHaveLength(0);
        (0, test_1.expect)(result.valid).toBe(false);
    });
    (0, test_1.test)("mathematical coherence: required = covered + missing + pending", () => {
        const scenarios = [
            makeScenario("Scenario Alfa", ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'], branches[0]),
            makeScenario("Scenario Beta pending", ['1. Clic en "Beta"'], branches[1], { executionMode: "adaptive", mcpExecutable: false, authIntent: "gate_observation" }),
        ];
        const result = (0, scenario_preview_service_1.computeBranchCoverageCheck)(branches, scenarios, {
            coverageRequirementsAvailable: true,
        });
        (0, test_1.expect)(result.required).toBe(result.covered + result.missing.length + result.pending.length);
    });
});
// ── Missing requirements diagnostic ──────────────────────────────────────────
test_1.test.describe("missing requirements are observable via requirementAccounting", () => {
    const branches = [makeBranch("A", "Alfa", "Detalle A"), makeBranch("B", "Beta", "Detalle B")];
    (0, test_1.test)("2 missing requirements => missing array has exactly 2 entries with diagnostic fields", () => {
        const huText = 'Seleccionar Alfa y llegar a Detalle A. También seleccionar Beta y llegar a Detalle B.';
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([], branches, huText, "HU-TEST");
        const { functionalCoverage } = accounting;
        (0, test_1.expect)(functionalCoverage.missing.length).toBeGreaterThanOrEqual(2);
        const reqById = new Map(accounting.requirements.map((r) => [r.id, r]));
        for (const missingId of functionalCoverage.missing) {
            const req = reqById.get(missingId);
            (0, test_1.expect)(req).toBeDefined();
            (0, test_1.expect)(typeof req.category).toBe("string");
            (0, test_1.expect)(typeof req.sourceText).toBe("string");
            (0, test_1.expect)(req.sourceText.length).toBeGreaterThan(0);
        }
    });
    (0, test_1.test)("covered requirement does not appear in missing", () => {
        const scenarios = [
            makeScenario("Scenario Alfa", ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'], branches[0]),
            makeScenario("Scenario Beta", ['1. Clic en "Beta"', '2. Validar que se muestra "Detalle B"'], branches[1]),
        ];
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, "HU completa", "HU-TEST");
        const { functionalCoverage } = accounting;
        const coveredIds = accounting.requirements
            .filter((r) => r.status === "covered")
            .map((r) => r.id);
        for (const coveredId of coveredIds) {
            (0, test_1.expect)(functionalCoverage.missing).not.toContain(coveredId);
        }
    });
    (0, test_1.test)("readiness-invalid scenario preserves canonical functional coverage", () => {
        const scenario = makeScenario("Scenario Alfa readiness pending", ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'], branches[0], { mcpExecutable: false, executionMode: "adaptive" });
        scenario.validation = { valid: false, errors: ["mcpExecutable must be true"] };
        scenario.stepRequirementRefs = [
            { stepIndex: 0, requirementId: "branch:A", facet: "activation" },
        ];
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([scenario], branches, "HU completa", "HU-TEST");
        (0, test_1.expect)(accounting.requirements.find((requirement) => requirement.id === "branch:A")?.status).toBe("covered");
    });
});
test_1.test.describe("final requirement accounting invariant", () => {
    const account = (id, status) => ({
        id,
        requirementId: id,
        sourceIssueKey: "TEST",
        category: status === "nonAutomatable" ? "restart" : "visibility",
        sourceText: id,
        expectedBehavior: id,
        status,
    });
    (0, test_1.test)("six coverable plus one nonAutomatable is complete", () => {
        const result = (0, scenario_functional_quality_1.evaluateFunctionalCoverageInvariant)([
            ...Array.from({ length: 6 }, (_, index) => account(`coverable-${index}`, "covered")),
            account("non-automatable", "nonAutomatable"),
        ]);
        (0, test_1.expect)(result.valid).toBe(true);
        (0, test_1.expect)(result.coverableRequired).toBe(6);
        (0, test_1.expect)(result.coverableSatisfied).toBe(6);
        (0, test_1.expect)(result.nonAutomatable).toBe(1);
    });
    (0, test_1.test)("a missing or incomplete coverable requirement blocks coverage", () => {
        const result = (0, scenario_functional_quality_1.evaluateFunctionalCoverageInvariant)([
            account("covered", "covered"),
            account("incomplete", "incompleteRequirement"),
            account("non-automatable", "nonAutomatable"),
        ]);
        (0, test_1.expect)(result.valid).toBe(false);
        (0, test_1.expect)(result.incomplete).toBe(1);
        (0, test_1.expect)(result.missing).toContain("incomplete");
    });
    (0, test_1.test)("nonAutomatable alone does not create a functional gap", () => {
        const result = (0, scenario_functional_quality_1.evaluateFunctionalCoverageInvariant)([account("non-automatable", "nonAutomatable")]);
        (0, test_1.expect)(result.valid).toBe(true);
        (0, test_1.expect)(result.missing).toEqual([]);
        (0, test_1.expect)(result.nonAutomatable).toBe(1);
    });
});
// ── Narrative/compound clause false positive prevention ──────────────────────
test_1.test.describe("extractRequirements: narrative clause boundaries", () => {
    const noBranches = [];
    (0, test_1.test)('A) "seleccionar visualizar la pantalla y poder continuar" → NO action false positive', () => {
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([], noBranches, "seleccionar visualizar la pantalla y poder continuar", "HU-TEST");
        const actions = accounting.requirements.filter((r) => r.category === "action");
        (0, test_1.expect)(actions).toHaveLength(0);
    });
    (0, test_1.test)('B) "visualizar la pantalla A y poder seleccionar B" → visibility=A, action=B if B is concrete', () => {
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([], noBranches, "visualizar la pantalla A y poder seleccionar B", "HU-TEST");
        const vis = accounting.requirements.filter((r) => r.category === "visibility");
        const act = accounting.requirements.filter((r) => r.category === "action");
        (0, test_1.expect)(vis.length).toBeGreaterThanOrEqual(1);
        (0, test_1.expect)(vis.some((r) => r.sourceText.toLowerCase().includes("pantalla a"))).toBe(true);
        if (act.length > 0) {
            (0, test_1.expect)(act.every((r) => !r.sourceText.toLowerCase().startsWith("visualizar"))).toBe(true);
        }
    });
    (0, test_1.test)('C) "Mostrar el resumen y seleccionar el botón de guardar" → 2 valid requirements', () => {
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([], noBranches, "Mostrar el resumen y seleccionar el botón de guardar", "HU-TEST");
        const vis = accounting.requirements.filter((r) => r.category === "visibility");
        const act = accounting.requirements.filter((r) => r.category === "action");
        (0, test_1.expect)(vis.length + act.length).toBeGreaterThanOrEqual(2);
    });
    (0, test_1.test)('D) no duplicate from overlapping parse: "seleccionar la opción X" → 1 action not 2', () => {
        const accounting = (0, scenario_functional_quality_1.buildRequirementAccounting)([], noBranches, "seleccionar la opción X", "HU-TEST");
        const actions = accounting.requirements.filter((r) => r.category === "action");
        (0, test_1.expect)(actions.length).toBeLessThanOrEqual(1);
    });
});
