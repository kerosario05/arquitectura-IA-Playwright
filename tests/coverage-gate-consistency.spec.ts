import { expect, test } from "@playwright/test";
import {
  evaluateGenerationSuccess,
  computeBranchCoverageCheck,
  type BranchCoverageCheck,
} from "../src/scenarios/scenario-preview.service";
import {
  buildRequirementAccounting,
  computeFunctionalCoverage,
  evaluateFunctionalCoverageInvariant,
} from "../src/scenarios/scenario-functional-quality";
import type {
  FunctionalBranchRef,
  FunctionalCoverageResult,
  McpScenario,
} from "../src/scenarios/scenario-types";

// ── Helpers ──────────────────────────────────────────────────────────────────

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

function makeScenario(
  title: string,
  steps: string[],
  functionalBranch?: FunctionalBranchRef,
  opts: { executionMode?: string; mcpExecutable?: boolean; authIntent?: string } = {},
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
    mcpExecutable: opts.mcpExecutable ?? true,
    executionMode: opts.executionMode ?? "standard",
    functionalBranch,
    authIntent: opts.authIntent as any,
  } as McpScenario;
}

function fc(required: number, covered: number, missing: string[]): FunctionalCoverageResult {
  return { required, covered, missing, valid: missing.length === 0 && required > 0 };
}

function bc(overrides: Partial<BranchCoverageCheck>): BranchCoverageCheck {
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

test.describe("evaluateGenerationSuccess", () => {
  const baseBranchCoverage = bc({ required: 2, covered: 2, missing: [], valid: true });

  test("functionalCoverage invalid => generationSuccess false with reason", () => {
    const result = evaluateGenerationSuccess(
      true,
      baseBranchCoverage,
      true,
      fc(6, 4, ["action:1", "visibility:1"]),
    );
    expect(result.generationSuccess).toBe(false);
    expect(result.blockedReasons).toContain("functional_coverage_incomplete");
  });

  test("functionalCoverage valid + all other checks pass => generationSuccess true", () => {
    const result = evaluateGenerationSuccess(
      true,
      baseBranchCoverage,
      true,
      fc(6, 6, []),
    );
    expect(result.generationSuccess).toBe(true);
    expect(result.blockedReasons).toHaveLength(0);
  });

  test("functionalCoverage valid but branchCoverage invalid => still fails", () => {
    const result = evaluateGenerationSuccess(
      true,
      bc({ required: 2, covered: 1, missing: ["branch-B"], valid: false }),
      true,
      fc(6, 6, []),
    );
    expect(result.generationSuccess).toBe(false);
    expect(result.blockedReasons).toContain("branch_coverage_invalid");
    expect(result.blockedReasons).not.toContain("functional_coverage_incomplete");
  });

  test("functionalCoverage invalid AND branchCoverage invalid => both reasons", () => {
    const result = evaluateGenerationSuccess(
      true,
      bc({ required: 2, covered: 1, missing: ["branch-B"], valid: false }),
      true,
      fc(6, 4, ["action:1", "visibility:1"]),
    );
    expect(result.generationSuccess).toBe(false);
    expect(result.blockedReasons).toContain("branch_coverage_invalid");
    expect(result.blockedReasons).toContain("functional_coverage_incomplete");
  });

  test("coverageRequirementsAvailable false => separate reason", () => {
    const result = evaluateGenerationSuccess(
      true,
      baseBranchCoverage,
      false,
      fc(0, 0, []),
    );
    expect(result.generationSuccess).toBe(false);
    expect(result.blockedReasons).toContain("coverage_requirements_unavailable");
  });
});

// ── computeBranchCoverageCheck: pending accounting ───────────────────────────

test.describe("computeBranchCoverageCheck pending accounting", () => {
  const branches = [makeBranch("A", "Alfa", "Detalle A"), makeBranch("B", "Beta", "Detalle B")];

  test("required=2 covered=1 with1 pending => valid=true (pending alone does not invalidate)", () => {
    const scenarios = [
      makeScenario(
        "Scenario Alfa",
        ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'],
        branches[0],
      ),
      makeScenario(
        "Scenario Beta pending",
        ['1. Clic en "Beta"'],
        branches[1],
        { executionMode: "adaptive", mcpExecutable: false, authIntent: "gate_observation" },
      ),
    ];
    const result = computeBranchCoverageCheck(branches, scenarios, {
      coverageRequirementsAvailable: true,
    });
    expect(result.required).toBe(2);
    expect(result.covered).toBe(1);
    expect(result.pending).toHaveLength(1);
    expect(result.missing).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  test("required=2 covered=2 => valid=true", () => {
    const scenarios = [
      makeScenario(
        "Scenario Alfa",
        ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'],
        branches[0],
      ),
      makeScenario(
        "Scenario Beta",
        ['1. Clic en "Beta"', '2. Validar que se muestra "Detalle B"'],
        branches[1],
      ),
    ];
    const result = computeBranchCoverageCheck(branches, scenarios, {
      coverageRequirementsAvailable: true,
    });
    expect(result.required).toBe(2);
    expect(result.covered).toBe(2);
    expect(result.missing).toHaveLength(0);
    expect(result.valid).toBe(true);
  });

  test("required=0 => valid=true (no branches required)", () => {
    const result = computeBranchCoverageCheck([], [], {
      coverageRequirementsAvailable: true,
    });
    expect(result.required).toBe(0);
    expect(result.valid).toBe(true);
  });

  test("required=2 covered=1 missing=1 no pending => valid=false", () => {
    const scenarios = [
      makeScenario(
        "Scenario Alfa",
        ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'],
        branches[0],
      ),
    ];
    const result = computeBranchCoverageCheck(branches, scenarios, {
      coverageRequirementsAvailable: true,
    });
    expect(result.required).toBe(2);
    expect(result.covered).toBe(1);
    expect(result.missing).toContain("B");
    expect(result.pending).toHaveLength(0);
    expect(result.valid).toBe(false);
  });

  test("mathematical coherence: required = covered + missing + pending", () => {
    const scenarios = [
      makeScenario(
        "Scenario Alfa",
        ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'],
        branches[0],
      ),
      makeScenario(
        "Scenario Beta pending",
        ['1. Clic en "Beta"'],
        branches[1],
        { executionMode: "adaptive", mcpExecutable: false, authIntent: "gate_observation" },
      ),
    ];
    const result = computeBranchCoverageCheck(branches, scenarios, {
      coverageRequirementsAvailable: true,
    });
    expect(result.required).toBe(result.covered + result.missing.length + result.pending.length);
  });
});

// ── Missing requirements diagnostic ──────────────────────────────────────────

test.describe("missing requirements are observable via requirementAccounting", () => {
  const branches = [makeBranch("A", "Alfa", "Detalle A"), makeBranch("B", "Beta", "Detalle B")];

  test("2 missing requirements => missing array has exactly 2 entries with diagnostic fields", () => {
    const huText = 'Seleccionar Alfa y llegar a Detalle A. También seleccionar Beta y llegar a Detalle B.';
    const accounting = buildRequirementAccounting([], branches, huText, "HU-TEST");
    const { functionalCoverage } = accounting;

    expect(functionalCoverage.missing.length).toBeGreaterThanOrEqual(2);

    const reqById = new Map(accounting.requirements.map((r) => [r.id, r]));
    for (const missingId of functionalCoverage.missing) {
      const req = reqById.get(missingId);
      expect(req).toBeDefined();
      expect(typeof req!.category).toBe("string");
      expect(typeof req!.sourceText).toBe("string");
      expect(req!.sourceText.length).toBeGreaterThan(0);
    }
  });

  test("covered requirement does not appear in missing", () => {
    const scenarios = [
      makeScenario(
        "Scenario Alfa",
        ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'],
        branches[0],
      ),
      makeScenario(
        "Scenario Beta",
        ['1. Clic en "Beta"', '2. Validar que se muestra "Detalle B"'],
        branches[1],
      ),
    ];
    const accounting = buildRequirementAccounting(scenarios, branches, "HU completa", "HU-TEST");
    const { functionalCoverage } = accounting;

    const coveredIds = accounting.requirements
      .filter((r) => r.status === "covered")
      .map((r) => r.id);
    for (const coveredId of coveredIds) {
      expect(functionalCoverage.missing).not.toContain(coveredId);
    }
  });

  test("readiness-invalid scenario preserves canonical functional coverage", () => {
    const scenario = makeScenario(
      "Scenario Alfa readiness pending",
      ['1. Clic en "Alfa"', '2. Validar que se muestra "Detalle A"'],
      branches[0],
      { mcpExecutable: false, executionMode: "adaptive" },
    );
    scenario.validation = { valid: false, errors: ["mcpExecutable must be true"] };
    scenario.stepRequirementRefs = [
      { stepIndex: 0, requirementId: "branch:A", facet: "activation" },
    ];

    const accounting = buildRequirementAccounting([scenario], branches, "HU completa", "HU-TEST");
    expect(accounting.requirements.find((requirement) => requirement.id === "branch:A")?.status).toBe("covered");
  });
});

test.describe("final requirement accounting invariant", () => {
  const account = (id: string, status: "covered" | "nonAutomatable" | "incompleteRequirement"): any => ({
    id,
    requirementId: id,
    sourceIssueKey: "TEST",
    category: status === "nonAutomatable" ? "restart" : "visibility",
    sourceText: id,
    expectedBehavior: id,
    status,
  });

  test("six coverable plus one nonAutomatable is complete", () => {
    const result = evaluateFunctionalCoverageInvariant([
      ...Array.from({ length: 6 }, (_, index) => account(`coverable-${index}`, "covered")),
      account("non-automatable", "nonAutomatable"),
    ]);
    expect(result.valid).toBe(true);
    expect(result.coverableRequired).toBe(6);
    expect(result.coverableSatisfied).toBe(6);
    expect(result.nonAutomatable).toBe(1);
  });

  test("a missing or incomplete coverable requirement blocks coverage", () => {
    const result = evaluateFunctionalCoverageInvariant([
      account("covered", "covered"),
      account("incomplete", "incompleteRequirement"),
      account("non-automatable", "nonAutomatable"),
    ]);
    expect(result.valid).toBe(false);
    expect(result.incomplete).toBe(1);
    expect(result.missing).toContain("incomplete");
  });

  test("nonAutomatable alone does not create a functional gap", () => {
    const result = evaluateFunctionalCoverageInvariant([account("non-automatable", "nonAutomatable")]);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.nonAutomatable).toBe(1);
  });
});

// ── Narrative/compound clause false positive prevention ──────────────────────

test.describe("extractRequirements: narrative clause boundaries", () => {
  const noBranches: FunctionalBranchRef[] = [];

  test('A) "seleccionar visualizar la pantalla y poder continuar" → NO action false positive', () => {
    const accounting = buildRequirementAccounting([], noBranches, "seleccionar visualizar la pantalla y poder continuar", "HU-TEST");
    const actions = accounting.requirements.filter((r) => r.category === "action");
    expect(actions).toHaveLength(0);
  });

  test('B) "visualizar la pantalla A y poder seleccionar B" → visibility=A, action=B if B is concrete', () => {
    const accounting = buildRequirementAccounting([], noBranches, "visualizar la pantalla A y poder seleccionar B", "HU-TEST");
    const vis = accounting.requirements.filter((r) => r.category === "visibility");
    const act = accounting.requirements.filter((r) => r.category === "action");
    expect(vis.length).toBeGreaterThanOrEqual(1);
    expect(vis.some((r) => r.sourceText.toLowerCase().includes("pantalla a"))).toBe(true);
    if (act.length > 0) {
      expect(act.every((r) => !r.sourceText.toLowerCase().startsWith("visualizar"))).toBe(true);
    }
  });

  test('C) "Mostrar el resumen y seleccionar el botón de guardar" → 2 valid requirements', () => {
    const accounting = buildRequirementAccounting([], noBranches, "Mostrar el resumen y seleccionar el botón de guardar", "HU-TEST");
    const vis = accounting.requirements.filter((r) => r.category === "visibility");
    const act = accounting.requirements.filter((r) => r.category === "action");
    expect(vis.length + act.length).toBeGreaterThanOrEqual(2);
  });

  test('D) no duplicate from overlapping parse: "seleccionar la opción X" → 1 action not 2', () => {
    const accounting = buildRequirementAccounting([], noBranches, "seleccionar la opción X", "HU-TEST");
    const actions = accounting.requirements.filter((r) => r.category === "action");
    expect(actions.length).toBeLessThanOrEqual(1);
  });
});
