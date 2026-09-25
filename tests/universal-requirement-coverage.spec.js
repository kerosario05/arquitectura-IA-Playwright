"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const scenario_functional_quality_1 = require("../src/scenarios/scenario-functional-quality");
// ── Helpers ──────────────────────────────────────────────────────────────────
function makeScenario(title, steps, functionalBranch) {
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
        functionalBranch,
    };
}
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
// ── Fixture 1: visible state + prerequisite + 2 branches + negative rule ─────
(0, test_1.test)("Fixture 1: full coverage — branches, visibility, action, negative all covered", () => {
    const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa"), makeBranch("branch-b", "Beta", "Pantalla Beta")];
    const hu = "Para continuar debe seleccionar Entry. La pantalla debe mostrar Bienvenida. Puede seleccionar Alfa o Beta. No mostrar datos restringidos.";
    const scenarios = [
        makeScenario("Alfa", ['1. Clic en "Entry".', '2. Clic en "Alfa".', '3. Validar que se muestre "Pantalla Alfa".'], branches[0]),
        makeScenario("Beta", ['1. Clic en "Entry".', '2. Clic en "Beta".', '3. Validar que se muestre "Pantalla Beta".'], branches[1]),
        makeScenario("Bienvenida", ['1. Validar que se muestre "Bienvenida".']),
        makeScenario("Negativo", ['1. Validar que no se muestre "datos restringidos".']),
    ];
    const { requirements, summary, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, hu, "HU-1");
    // 1. Every explicit requirement has a stable id and sourceIssueKey.
    (0, test_1.expect)(requirements.length).toBeGreaterThan(0);
    for (const r of requirements) {
        (0, test_1.expect)(r.id).toBeTruthy();
        (0, test_1.expect)(r.sourceIssueKey).toBe("HU-1");
        (0, test_1.expect)(r.category).toBeTruthy();
        (0, test_1.expect)(r.status).toBeTruthy();
    }
    // 3. Branch A and B are counted separately.
    const branchIds = requirements.filter((r) => r.category === "branch").map((r) => r.id);
    (0, test_1.expect)(branchIds).toContain("branch:branch-a");
    (0, test_1.expect)(branchIds).toContain("branch:branch-b");
    // Entry appears exactly ONCE as a requirement (no action+prerequisite dup).
    const entryReqs = requirements.filter((r) => r.expectedBehavior?.toLowerCase().includes("entry") || r.sourceText.toLowerCase().includes("entry"));
    (0, test_1.expect)(entryReqs.length).toBe(1);
    // All 5 requirements covered.
    (0, test_1.expect)(summary.covered).toBe(5);
    (0, test_1.expect)(summary.total).toBe(5);
    (0, test_1.expect)(functionalCoverage).toEqual({ required: 5, covered: 5, missing: [], valid: true });
});
(0, test_1.test)("Fixture 1: negative rule missing → not covered and reported missing", () => {
    const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa"), makeBranch("branch-b", "Beta", "Pantalla Beta")];
    const hu = "Para continuar debe seleccionar Entry. La pantalla debe mostrar Bienvenida. Puede seleccionar Alfa o Beta. No mostrar datos restringidos.";
    const scenarios = [
        makeScenario("Alfa", ['1. Clic en "Entry".', '2. Clic en "Alfa".', '3. Validar que se muestre "Pantalla Alfa".'], branches[0]),
        makeScenario("Beta", ['1. Clic en "Entry".', '2. Clic en "Beta".', '3. Validar que se muestre "Pantalla Beta".'], branches[1]),
        makeScenario("Bienvenida", ['1. Validar que se muestre "Bienvenida".']),
    ];
    const { requirements, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, hu, "HU-1");
    const negative = requirements.find((r) => r.category === "negative");
    (0, test_1.expect)(negative).toBeDefined();
    (0, test_1.expect)(negative?.status).toBe("incompleteRequirement");
    (0, test_1.expect)(negative?.reasonCode).toBe("no_covering_scenario");
    // 5. Negative rule requires a negative assertion; a missing one is a gap.
    (0, test_1.expect)(functionalCoverage.missing).toContain("negative:1");
    (0, test_1.expect)(functionalCoverage.valid).toBe(false);
    (0, test_1.expect)(functionalCoverage.required).toBe(5);
    (0, test_1.expect)(functionalCoverage.covered).toBe(4);
});
(0, test_1.test)("Fixture 1: every requirement has a terminal status (none disappear silently)", () => {
    const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa")];
    const hu = "Puede seleccionar Alfa. No mostrar datos restringidos.";
    const scenarios = [makeScenario("Alfa", ['1. Clic en "Alfa".', '2. Validar que se muestre "Pantalla Alfa".'], branches[0])];
    const { requirements, summary } = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, hu, "HU-1");
    const statuses = new Set(["covered", "adaptive", "nonAutomatable", "incompleteRequirement"]);
    for (const r of requirements) {
        (0, test_1.expect)(statuses.has(r.status)).toBe(true);
    }
    const sum = summary.covered + summary.adaptive + summary.nonAutomatable + summary.incompleteRequirement;
    (0, test_1.expect)(sum).toBe(summary.total);
});
// ── Fixture 2: one action + one content validation ───────────────────────────
(0, test_1.test)("Fixture 2: action + content restriction covered", () => {
    const hu = "El usuario debe seleccionar Producto y validar que solo se muestre Detalle.";
    const scenarios = [makeScenario("Producto", ['1. Clic en "Producto".', '2. Validar que se muestre "Detalle".'])];
    const { requirements, summary, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, [], hu, "HU-2");
    const categories = requirements.map((r) => r.category);
    (0, test_1.expect)(categories).toContain("action");
    (0, test_1.expect)(categories).toContain("content_restriction");
    (0, test_1.expect)(summary.covered).toBe(2);
    (0, test_1.expect)(functionalCoverage).toEqual({ required: 2, covered: 2, missing: [], valid: true });
});
// ── Fixture 3: timeout + restart/environment — never fabricated coverage ─────
(0, test_1.test)("Fixture 3: inactivity/restart/environment are adaptive/nonAutomatable, never covered", () => {
    const hu = "La sesión debe expirar tras 5 minutos de inactividad. El sistema debe recuperarse tras un reinicio. El entorno restringido no permite conexiones.";
    const scenarios = [];
    const { requirements, summary, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, [], hu, "HU-3");
    const inactivity = requirements.find((r) => r.category === "inactivity");
    const restart = requirements.find((r) => r.category === "restart");
    const environment = requirements.find((r) => r.category === "environment");
    // 7. timeout without capability is NOT covered.
    (0, test_1.expect)(inactivity?.status).toBe("adaptive");
    (0, test_1.expect)(inactivity?.reasonCode).toBe("timeout_requirement");
    // 8. restart without capability is NOT covered.
    (0, test_1.expect)(restart?.status).toBe("nonAutomatable");
    (0, test_1.expect)(environment?.status).toBe("nonAutomatable");
    (0, test_1.expect)(restart?.reasonCode).toBe("non_ui_requirement");
    // 9/10. No evaluable functional requirement → required=0, valid=true.
    (0, test_1.expect)(summary.adaptive).toBe(1);
    (0, test_1.expect)(summary.nonAutomatable).toBe(2);
    (0, test_1.expect)(summary.total).toBe(3);
    (0, test_1.expect)(functionalCoverage).toEqual({ required: 0, covered: 0, missing: [], valid: true });
});
// ── Fixture 4: truncated requirement → incompleteRequirement, not missing ────
(0, test_1.test)("Fixture 4: truncated source is incompleteRequirement, excluded from missing", () => {
    const hu = "Seleccionar Alfa y validar que se muestre el resumen de...";
    const scenarios = [];
    const { requirements, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, [], hu, "HU-4");
    const visibility = requirements.find((r) => r.category === "visibility");
    (0, test_1.expect)(visibility).toBeDefined();
    (0, test_1.expect)(visibility?.status).toBe("incompleteRequirement");
    (0, test_1.expect)(visibility?.reasonCode).toBe("incomplete_source_text");
    const action = requirements.find((r) => r.category === "action");
    (0, test_1.expect)(action?.status).toBe("incompleteRequirement");
    (0, test_1.expect)(action?.reasonCode).toBe("no_covering_scenario");
    // Truncated requirement is accounted but NOT in missing; the evaluable action is.
    (0, test_1.expect)(functionalCoverage.missing).not.toContain("visibility:1");
    (0, test_1.expect)(functionalCoverage.missing).toContain("action:1");
    (0, test_1.expect)(functionalCoverage.required).toBe(1);
    (0, test_1.expect)(functionalCoverage.valid).toBe(false);
});
// ── Fixture 5: branch assertion-only never covers branch execution ───────────
(0, test_1.test)("Fixture 5: assertVisible(branch) does not cover branch click requirement", () => {
    const branches = [makeBranch("branch-c", "Gamma", "Pantalla Gamma")];
    const hu = "Puede seleccionar Gamma.";
    const scenarios = [makeScenario("Gamma visible", ['1. Validar que se muestre "Gamma".'])];
    const { requirements, functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, hu, "HU-5");
    const branch = requirements.find((r) => r.category === "branch");
    (0, test_1.expect)(branch?.status).toBe("incompleteRequirement");
    (0, test_1.expect)(branch?.reasonCode).toBe("no_covering_scenario");
    (0, test_1.expect)(functionalCoverage.missing).toContain("branch:branch-c");
    (0, test_1.expect)(functionalCoverage.valid).toBe(false);
});
// ── Validation 6: negative precondition validated before executing prerequisite ─
(0, test_1.test)("prerequisite state validated before the click is covered", () => {
    const hu = "No avanzar antes de Iniciar.";
    const before = makeScenario("Pre-Iniciar", ['1. Validar que se muestre "Iniciar".', '2. Clic en "Continuar".']);
    const { functionalCoverage: covBefore } = (0, scenario_functional_quality_1.buildRequirementAccounting)([before], [], hu, "HU-6a");
    (0, test_1.expect)(covBefore.required).toBe(1);
    (0, test_1.expect)(covBefore.missing).toEqual([]);
    (0, test_1.expect)(covBefore.valid).toBe(true);
});
(0, test_1.test)("prerequisite state validated AFTER the click is NOT covered", () => {
    const hu = "No avanzar antes de Iniciar.";
    const after = makeScenario("Post-Iniciar", ['1. Clic en "Continuar".', '2. Validar que se muestre "Iniciar".']);
    const { functionalCoverage: covAfter } = (0, scenario_functional_quality_1.buildRequirementAccounting)([after], [], hu, "HU-6b");
    (0, test_1.expect)(covAfter.required).toBe(1);
    (0, test_1.expect)(covAfter.missing).toEqual(["entry_precondition:1"]);
    (0, test_1.expect)(covAfter.valid).toBe(false);
});
// ── Validation 10: required = covered + missing ──────────────────────────────
(0, test_1.test)("required is always covered + missing (mathematical coherence)", () => {
    const cases = [
        { hu: "Seleccionar Alfa.", scenarios: [], branches: [] },
        { hu: "Seleccionar Alfa.", scenarios: [makeScenario("A", ['1. Clic en "Alfa".'])], branches: [] },
        { hu: "Puede seleccionar Alfa o Beta. No mostrar X.", scenarios: [], branches: [makeBranch("a", "Alfa", "DA"), makeBranch("b", "Beta", "DB")] },
    ];
    for (const c of cases) {
        const { functionalCoverage } = (0, scenario_functional_quality_1.buildRequirementAccounting)(c.scenarios, c.branches, c.hu, "HU-10");
        (0, test_1.expect)(functionalCoverage.covered + functionalCoverage.missing.length).toBe(functionalCoverage.required);
    }
});
// ── Validation 11: Knowledge=0 does not alter extraction (scenario-independent) ─
(0, test_1.test)("requirement extraction is identical with or without covering scenarios", () => {
    const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa")];
    const hu = "Puede seleccionar Alfa. No mostrar datos restringidos.";
    const withScenarios = (0, scenario_functional_quality_1.buildRequirementAccounting)([makeScenario("A", ['1. Clic en "Alfa".', '2. Validar que se muestre "Pantalla Alfa".', '3. Validar que no se muestre "datos restringidos".'], branches[0])], branches, hu, "HU-11");
    const withoutScenarios = (0, scenario_functional_quality_1.buildRequirementAccounting)([], branches, hu, "HU-11");
    (0, test_1.expect)(withScenarios.requirements.map((r) => r.id)).toEqual(withoutScenarios.requirements.map((r) => r.id));
});
// ── Validation 12/13: deterministic and no input mutation ────────────────────
(0, test_1.test)("functionalCoverage is deterministic and does not mutate inputs", () => {
    const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa")];
    const hu = "Puede seleccionar Alfa.";
    const scenarios = [makeScenario("A", ['1. Clic en "Alfa".', '2. Validar que se muestre "Pantalla Alfa".'], branches[0])];
    const branchesBefore = JSON.stringify(branches);
    const scenariosBefore = JSON.stringify(scenarios);
    const first = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, hu, "HU-13");
    const second = (0, scenario_functional_quality_1.buildRequirementAccounting)(scenarios, branches, hu, "HU-13");
    (0, test_1.expect)(first.functionalCoverage).toEqual(second.functionalCoverage);
    (0, test_1.expect)(first.requirements).toEqual(second.requirements);
    (0, test_1.expect)(JSON.stringify(branches)).toBe(branchesBefore);
    (0, test_1.expect)(JSON.stringify(scenarios)).toBe(scenariosBefore);
});
// ── computeFunctionalCoverage unit behavior ──────────────────────────────────
(0, test_1.test)("computeFunctionalCoverage treats adaptive/nonAutomatable as accounted, not missing", () => {
    const requirements = [
        { id: "branch:a", sourceIssueKey: "H", category: "branch", sourceText: "A", status: "covered" },
        { id: "inactivity:1", sourceIssueKey: "H", category: "inactivity", sourceText: "t", status: "adaptive", reasonCode: "timeout_requirement" },
        { id: "restart:1", sourceIssueKey: "H", category: "restart", sourceText: "r", status: "nonAutomatable", reasonCode: "non_ui_requirement" },
    ];
    const coverage = (0, scenario_functional_quality_1.computeFunctionalCoverage)(requirements);
    (0, test_1.expect)(coverage.required).toBe(1);
    (0, test_1.expect)(coverage.covered).toBe(1);
    (0, test_1.expect)(coverage.missing).toEqual([]);
    (0, test_1.expect)(coverage.valid).toBe(true);
});
(0, test_1.test)("requirements derived from text, not fixed counts (fixture scale)", () => {
    const small = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [], "Seleccionar Alfa.", "S");
    const large = (0, scenario_functional_quality_1.buildRequirementAccounting)([], [makeBranch("a", "Alfa", "DA"), makeBranch("b", "Beta", "DB")], "Puede seleccionar Alfa o Beta. La pantalla debe mostrar Bienvenida. No mostrar datos restringidos.", "L");
    (0, test_1.expect)(small.requirements.length).toBe(1);
    (0, test_1.expect)(large.requirements.length).toBeGreaterThan(small.requirements.length);
});
