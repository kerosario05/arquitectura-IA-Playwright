import { expect, test } from "@playwright/test";
import {
  buildRequirementAccounting,
  computeFunctionalCoverage,
} from "../src/scenarios/scenario-functional-quality";
import type {
  FunctionalBranchRef,
  McpScenario,
  RequirementStatus,
} from "../src/scenarios/scenario-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeScenario(
  title: string,
  steps: string[],
  functionalBranch?: FunctionalBranchRef,
): McpScenario {
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

function makeBranch(branchId: string, label: string, dest: string): FunctionalBranchRef {
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

test("Fixture 1: full coverage — branches, visibility, action, negative all covered", () => {
  const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa"), makeBranch("branch-b", "Beta", "Pantalla Beta")];
  const hu = "Para continuar debe seleccionar Entry. La pantalla debe mostrar Bienvenida. Puede seleccionar Alfa o Beta. No mostrar datos restringidos.";

  const scenarios = [
    makeScenario("Alfa", ['1. Clic en "Entry".', '2. Clic en "Alfa".', '3. Validar que se muestre "Pantalla Alfa".'], branches[0]),
    makeScenario("Beta", ['1. Clic en "Entry".', '2. Clic en "Beta".', '3. Validar que se muestre "Pantalla Beta".'], branches[1]),
    makeScenario("Bienvenida", ['1. Validar que se muestre "Bienvenida".']),
    makeScenario("Negativo", ['1. Validar que no se muestre "datos restringidos".']),
  ];

  const { requirements, summary, functionalCoverage } = buildRequirementAccounting(scenarios, branches, hu, "HU-1");

  // 1. Every explicit requirement has a stable id and sourceIssueKey.
  expect(requirements.length).toBeGreaterThan(0);
  for (const r of requirements) {
    expect(r.id).toBeTruthy();
    expect(r.sourceIssueKey).toBe("HU-1");
    expect(r.category).toBeTruthy();
    expect(r.status).toBeTruthy();
  }

  // 3. Branch A and B are counted separately.
  const branchIds = requirements.filter((r) => r.category === "branch").map((r) => r.id);
  expect(branchIds).toContain("branch:branch-a");
  expect(branchIds).toContain("branch:branch-b");

  // Entry appears exactly ONCE as a requirement (no action+prerequisite dup).
  const entryReqs = requirements.filter(
    (r) => r.expectedBehavior?.toLowerCase().includes("entry") || r.sourceText.toLowerCase().includes("entry"),
  );
  expect(entryReqs.length).toBe(1);

  // All 5 requirements covered.
  expect(summary.covered).toBe(5);
  expect(summary.total).toBe(5);
  expect(functionalCoverage).toEqual({ required: 5, covered: 5, missing: [], valid: true });
});

test("Fixture 1: negative rule missing → not covered and reported missing", () => {
  const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa"), makeBranch("branch-b", "Beta", "Pantalla Beta")];
  const hu = "Para continuar debe seleccionar Entry. La pantalla debe mostrar Bienvenida. Puede seleccionar Alfa o Beta. No mostrar datos restringidos.";

  const scenarios = [
    makeScenario("Alfa", ['1. Clic en "Entry".', '2. Clic en "Alfa".', '3. Validar que se muestre "Pantalla Alfa".'], branches[0]),
    makeScenario("Beta", ['1. Clic en "Entry".', '2. Clic en "Beta".', '3. Validar que se muestre "Pantalla Beta".'], branches[1]),
    makeScenario("Bienvenida", ['1. Validar que se muestre "Bienvenida".']),
  ];

  const { requirements, functionalCoverage } = buildRequirementAccounting(scenarios, branches, hu, "HU-1");

  const negative = requirements.find((r) => r.category === "negative");
  expect(negative).toBeDefined();
  expect(negative?.status).toBe("incompleteRequirement");
  expect(negative?.reasonCode).toBe("no_covering_scenario");

  // 5. Negative rule requires a negative assertion; a missing one is a gap.
  expect(functionalCoverage.missing).toContain("negative:1");
  expect(functionalCoverage.valid).toBe(false);
  expect(functionalCoverage.required).toBe(5);
  expect(functionalCoverage.covered).toBe(4);
});

test("Fixture 1: every requirement has a terminal status (none disappear silently)", () => {
  const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa")];
  const hu = "Puede seleccionar Alfa. No mostrar datos restringidos.";
  const scenarios = [makeScenario("Alfa", ['1. Clic en "Alfa".', '2. Validar que se muestre "Pantalla Alfa".'], branches[0])];

  const { requirements, summary } = buildRequirementAccounting(scenarios, branches, hu, "HU-1");
  const statuses = new Set<RequirementStatus>(["covered", "adaptive", "nonAutomatable", "incompleteRequirement"]);
  for (const r of requirements) {
    expect(statuses.has(r.status)).toBe(true);
  }
  const sum = summary.covered + summary.adaptive + summary.nonAutomatable + summary.incompleteRequirement;
  expect(sum).toBe(summary.total);
});

// ── Fixture 2: one action + one content validation ───────────────────────────

test("Fixture 2: action + content restriction covered", () => {
  const hu = "El usuario debe seleccionar Producto y validar que solo se muestre Detalle.";
  const scenarios = [makeScenario("Producto", ['1. Clic en "Producto".', '2. Validar que se muestre "Detalle".'])];

  const { requirements, summary, functionalCoverage } = buildRequirementAccounting(scenarios, [], hu, "HU-2");
  const categories = requirements.map((r) => r.category);
  expect(categories).toContain("action");
  expect(categories).toContain("content_restriction");
  expect(summary.covered).toBe(2);
  expect(functionalCoverage).toEqual({ required: 2, covered: 2, missing: [], valid: true });
});

// ── Fixture 3: timeout + restart/environment — never fabricated coverage ─────

test("Fixture 3: inactivity/restart/environment are adaptive/nonAutomatable, never covered", () => {
  const hu = "La sesión debe expirar tras 5 minutos de inactividad. El sistema debe recuperarse tras un reinicio. El entorno restringido no permite conexiones.";
  const scenarios: McpScenario[] = [];

  const { requirements, summary, functionalCoverage } = buildRequirementAccounting(scenarios, [], hu, "HU-3");

  const inactivity = requirements.find((r) => r.category === "inactivity");
  const restart = requirements.find((r) => r.category === "restart");
  const environment = requirements.find((r) => r.category === "environment");

  // 7. timeout without capability is NOT covered.
  expect(inactivity?.status).toBe("adaptive");
  expect(inactivity?.reasonCode).toBe("timeout_requirement");

  // 8. restart without capability is NOT covered.
  expect(restart?.status).toBe("nonAutomatable");
  expect(environment?.status).toBe("nonAutomatable");
  expect(restart?.reasonCode).toBe("non_ui_requirement");

  // 9/10. No evaluable functional requirement → required=0, valid=true.
  expect(summary.adaptive).toBe(1);
  expect(summary.nonAutomatable).toBe(2);
  expect(summary.total).toBe(3);
  expect(functionalCoverage).toEqual({ required: 0, covered: 0, missing: [], valid: true });
});

// ── Fixture 4: truncated requirement → incompleteRequirement, not missing ────

test("Fixture 4: truncated source is incompleteRequirement, excluded from missing", () => {
  const hu = "Seleccionar Alfa y validar que se muestre el resumen de...";
  const scenarios: McpScenario[] = [];

  const { requirements, functionalCoverage } = buildRequirementAccounting(scenarios, [], hu, "HU-4");

  const visibility = requirements.find((r) => r.category === "visibility");
  expect(visibility).toBeDefined();
  expect(visibility?.status).toBe("incompleteRequirement");
  expect(visibility?.reasonCode).toBe("incomplete_source_text");

  const action = requirements.find((r) => r.category === "action");
  expect(action?.status).toBe("incompleteRequirement");
  expect(action?.reasonCode).toBe("no_covering_scenario");

  // Truncated requirement is accounted but NOT in missing; the evaluable action is.
  expect(functionalCoverage.missing).not.toContain("visibility:1");
  expect(functionalCoverage.missing).toContain("action:1");
  expect(functionalCoverage.required).toBe(1);
  expect(functionalCoverage.valid).toBe(false);
});

// ── Fixture 5: branch assertion-only never covers branch execution ───────────

test("Fixture 5: assertVisible(branch) does not cover branch click requirement", () => {
  const branches = [makeBranch("branch-c", "Gamma", "Pantalla Gamma")];
  const hu = "Puede seleccionar Gamma.";
  const scenarios = [makeScenario("Gamma visible", ['1. Validar que se muestre "Gamma".'])];

  const { requirements, functionalCoverage } = buildRequirementAccounting(scenarios, branches, hu, "HU-5");

  const branch = requirements.find((r) => r.category === "branch");
  expect(branch?.status).toBe("incompleteRequirement");
  expect(branch?.reasonCode).toBe("no_covering_scenario");
  expect(functionalCoverage.missing).toContain("branch:branch-c");
  expect(functionalCoverage.valid).toBe(false);
});

// ── Validation 6: negative precondition validated before executing prerequisite ─

test("prerequisite state validated before the click is covered", () => {
  const hu = "No avanzar antes de Iniciar.";
  const before = makeScenario("Pre-Iniciar", ['1. Validar que se muestre "Iniciar".', '2. Clic en "Continuar".']);
  const { functionalCoverage: covBefore } = buildRequirementAccounting([before], [], hu, "HU-6a");
  expect(covBefore.required).toBe(1);
  expect(covBefore.missing).toEqual([]);
  expect(covBefore.valid).toBe(true);
});

test("prerequisite state validated AFTER the click is NOT covered", () => {
  const hu = "No avanzar antes de Iniciar.";
  const after = makeScenario("Post-Iniciar", ['1. Clic en "Continuar".', '2. Validar que se muestre "Iniciar".']);
  const { functionalCoverage: covAfter } = buildRequirementAccounting([after], [], hu, "HU-6b");
  expect(covAfter.required).toBe(1);
  expect(covAfter.missing).toEqual(["entry_precondition:1"]);
  expect(covAfter.valid).toBe(false);
});

// ── Validation 10: required = covered + missing ──────────────────────────────

test("required is always covered + missing (mathematical coherence)", () => {
  const cases = [
    { hu: "Seleccionar Alfa.", scenarios: [] as McpScenario[], branches: [] as FunctionalBranchRef[] },
    { hu: "Seleccionar Alfa.", scenarios: [makeScenario("A", ['1. Clic en "Alfa".'])], branches: [] },
    { hu: "Puede seleccionar Alfa o Beta. No mostrar X.", scenarios: [], branches: [makeBranch("a", "Alfa", "DA"), makeBranch("b", "Beta", "DB")] },
  ];
  for (const c of cases) {
    const { functionalCoverage } = buildRequirementAccounting(c.scenarios, c.branches, c.hu, "HU-10");
    expect(functionalCoverage.covered + functionalCoverage.missing.length).toBe(functionalCoverage.required);
  }
});

// ── Validation 11: Knowledge=0 does not alter extraction (scenario-independent) ─

test("requirement extraction is identical with or without covering scenarios", () => {
  const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa")];
  const hu = "Puede seleccionar Alfa. No mostrar datos restringidos.";

  const withScenarios = buildRequirementAccounting(
    [makeScenario("A", ['1. Clic en "Alfa".', '2. Validar que se muestre "Pantalla Alfa".', '3. Validar que no se muestre "datos restringidos".'], branches[0])],
    branches,
    hu,
    "HU-11",
  );
  const withoutScenarios = buildRequirementAccounting([], branches, hu, "HU-11");

  expect(withScenarios.requirements.map((r) => r.id)).toEqual(withoutScenarios.requirements.map((r) => r.id));
});

// ── Validation 12/13: deterministic and no input mutation ────────────────────

test("functionalCoverage is deterministic and does not mutate inputs", () => {
  const branches = [makeBranch("branch-a", "Alfa", "Pantalla Alfa")];
  const hu = "Puede seleccionar Alfa.";
  const scenarios = [makeScenario("A", ['1. Clic en "Alfa".', '2. Validar que se muestre "Pantalla Alfa".'], branches[0])];

  const branchesBefore = JSON.stringify(branches);
  const scenariosBefore = JSON.stringify(scenarios);

  const first = buildRequirementAccounting(scenarios, branches, hu, "HU-13");
  const second = buildRequirementAccounting(scenarios, branches, hu, "HU-13");

  expect(first.functionalCoverage).toEqual(second.functionalCoverage);
  expect(first.requirements).toEqual(second.requirements);
  expect(JSON.stringify(branches)).toBe(branchesBefore);
  expect(JSON.stringify(scenarios)).toBe(scenariosBefore);
});

// ── computeFunctionalCoverage unit behavior ──────────────────────────────────

test("computeFunctionalCoverage treats adaptive/nonAutomatable as accounted, not missing", () => {
  const requirements = [
    { id: "branch:a", sourceIssueKey: "H", category: "branch" as const, sourceText: "A", status: "covered" as const },
    { id: "inactivity:1", sourceIssueKey: "H", category: "inactivity" as const, sourceText: "t", status: "adaptive" as const, reasonCode: "timeout_requirement" },
    { id: "restart:1", sourceIssueKey: "H", category: "restart" as const, sourceText: "r", status: "nonAutomatable" as const, reasonCode: "non_ui_requirement" },
  ];
  const coverage = computeFunctionalCoverage(requirements);
  expect(coverage.required).toBe(1);
  expect(coverage.covered).toBe(1);
  expect(coverage.missing).toEqual([]);
  expect(coverage.valid).toBe(true);
});

test("requirements derived from text, not fixed counts (fixture scale)", () => {
  const small = buildRequirementAccounting([], [], "Seleccionar Alfa.", "S");
  const large = buildRequirementAccounting(
    [],
    [makeBranch("a", "Alfa", "DA"), makeBranch("b", "Beta", "DB")],
    "Puede seleccionar Alfa o Beta. La pantalla debe mostrar Bienvenida. No mostrar datos restringidos.",
    "L",
  );
  expect(small.requirements.length).toBe(1);
  expect(large.requirements.length).toBeGreaterThan(small.requirements.length);
});