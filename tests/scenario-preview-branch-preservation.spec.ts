import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  extractFunctionalBranchesFromHu,
  assignFunctionalBranchesToScenarios,
  applyBranchRoutePrefixRepair,
  buildScenarioSemanticSignature,
  computeBranchCoverageCheck,
  compareVisibleScenarioSets,
  computeResponseAssemblyMetrics,
  dedupeScenariosBySemanticSignature,
  evaluateGenerationSuccess,
  markScenariosAsCoverageDiagnostics,
  reclassifyScenariosByBranchCoverage,
  preserveScenarioOnIntermediateRepairFailure,
  evaluateBranchRecoveryEvidence,
  type BranchRouteCandidate,
} from "../src/scenarios/scenario-preview.service";
import type { FunctionalBranchRef, IntermediateRepairResult, McpScenario } from "../src/scenarios/scenario-types";
import { parseAiResponse } from "../src/scenarios/scenario-output-parser";

function makeScenario(overrides: Partial<McpScenario> = {}): McpScenario {
  return {
    sourceIssueKey: overrides.sourceIssueKey ?? "HU-1",
    title: overrides.title ?? "Scenario",
    steps: overrides.steps ?? ['1. Clic en "Opción Alfa".'],
    preconditions: overrides.preconditions ?? [],
    expectedResult: overrides.expectedResult ?? "OK",
    type: overrides.type ?? "functional",
    database: overrides.database ?? "",
    isConverted: overrides.isConverted ?? 0,
    automationType: overrides.automationType ?? "ui_discovery",
    setupStrategy: overrides.setupStrategy ?? "no_login",
    appSlug: overrides.appSlug ?? "sample-app",
    targetAppSlug: overrides.targetAppSlug ?? "sample-app",
    routeProfile: overrides.routeProfile ?? "sample-profile",
    dataRequirements: overrides.dataRequirements ?? "",
    nonExecutableCriteria: overrides.nonExecutableCriteria ?? "",
    mcpExecutable: overrides.mcpExecutable ?? true,
    functionalBranch: overrides.functionalBranch,
    branchAssociation: overrides.branchAssociation,
    scenarioId: overrides.scenarioId,
  };
}

test("generateScenarioPreview initializes coverageRequirementsAvailable before first reclassification use", () => {
  const sourcePath = path.join(process.cwd(), "src", "scenarios", "scenario-preview.service.ts");
  const source = fs.readFileSync(sourcePath, "utf-8");
  const declaration = source.indexOf(
    "const coverageRequirementsAvailable = ensureCoverageRequirementsAvailable(functionalBranches);",
  );
  const reclassificationCall = source.indexOf("const reclassified = reclassifyScenariosByBranchCoverage(");
  const firstConsumption = source.indexOf("coverageRequirementsAvailable,", reclassificationCall);

  expect(declaration).toBeGreaterThan(-1);
  expect(reclassificationCall).toBeGreaterThan(-1);
  expect(firstConsumption).toBeGreaterThan(-1);
  expect(declaration).toBeLessThan(firstConsumption);
});

test("extractFunctionalBranchesFromHu creates independent branches for decision options", () => {
  const huText = [
    'Al seleccionar "Opción Alfa" conduce a "Portal Público Alfa".',
    'Al seleccionar "Opción Beta" conduce a "Portal Autenticado Beta".',
    'Al seleccionar "Opción Gamma" conduce a "Portal Público Gamma".',
  ].join("\n");
  const branches = extractFunctionalBranchesFromHu(
    huText,
    ["Opción Alfa", "Opción Beta", "Opción Gamma"],
    [],
  );

  expect(branches).toHaveLength(3);
  expect(new Set(branches.map((branch) => branch.branchId)).size).toBe(3);
  expect(branches.map((branch) => branch.expectedDestination)).toEqual(
    expect.arrayContaining(["Portal Público Alfa", "Portal Autenticado Beta", "Portal Público Gamma"]),
  );
  expect(branches.find((branch) => branch.sourceLabel === "Opción Beta")?.accessIntent).toBe("authenticated");
  expect(branches.find((branch) => branch.sourceLabel === "Opción Alfa")?.accessIntent).toBe("public");
});

test("extractFunctionalBranchesFromHu maps automatable option flows to functional branches", () => {
  const branches = extractFunctionalBranchesFromHu(
    "HU genérica con opciones",
    [],
    [],
    [
      {
        optionLabel: "Opción Alfa",
        expectedResult: "Destino Público Alfa",
        requiresAuth: false,
        source: "hu",
      },
      {
        optionLabel: "Opción Beta",
        expectedResult: "Destino Privado Beta",
        requiresAuth: true,
        source: "hu",
      },
    ],
  );

  expect(branches).toHaveLength(2);
  expect(branches.find((branch) => branch.sourceLabel === "Opción Alfa")?.accessIntent).toBe("public");
  expect(branches.find((branch) => branch.sourceLabel === "Opción Beta")?.accessIntent).toBe("authenticated");
});

test("assignFunctionalBranchesToScenarios preserves scenario-to-branch association", () => {
  const branches: FunctionalBranchRef[] = [
    {
      branchId: "branch-alpha",
      sourceLabel: "Opción Alfa",
      actionIntent: "select_option",
      expectedDestination: "Portal Público Alfa",
      accessIntent: "public",
      evidenceSource: "acceptance_criteria",
    },
    {
      branchId: "branch-beta",
      sourceLabel: "Opción Beta",
      actionIntent: "select_option",
      expectedDestination: "Portal Autenticado Beta",
      accessIntent: "authenticated",
      evidenceSource: "acceptance_criteria",
    },
  ];
  const scenarios = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        scenarioId: "alpha",
        title: "Navegar por rama Alfa",
        steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Portal Público Alfa".'],
      }),
      makeScenario({
        scenarioId: "beta",
        title: "Navegar por rama Beta",
        steps: ['1. Clic en "Opción Beta".', '2. Validar que se muestre "Portal Autenticado Beta".'],
      }),
    ],
    branches,
  );

  expect(scenarios[0].functionalBranch?.branchId).toBe("branch-alpha");
  expect(scenarios[1].functionalBranch?.branchId).toBe("branch-beta");
});

test("assignFunctionalBranchesToScenarios preserves AI-provided branchId and uses fallback only when missing", () => {
  const branches: FunctionalBranchRef[] = [
    {
      branchId: "branch-alfa",
      sourceLabel: "Opción Alfa",
      actionIntent: "select_option",
      expectedDestination: "Destino Alfa",
      accessIntent: "public",
      evidenceSource: "user_story",
    },
    {
      branchId: "branch-beta",
      sourceLabel: "Opción Beta",
      actionIntent: "select_option",
      expectedDestination: "Destino Beta Privado",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    },
  ];

  const scenarios = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        scenarioId: "s-ai",
        title: "Escenario con branchId devuelto por IA",
        functionalBranch: { ...branches[1] },
      }),
      makeScenario({
        scenarioId: "s-top-level",
        title: "Escenario con branchId plano",
        steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'],
        ...({ branchId: "branch-alfa" } as any),
      }),
      makeScenario({
        scenarioId: "s-fallback",
        title: "Escenario sin branchId",
        steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'],
      }),
    ],
    branches,
  );

  expect(scenarios[0].functionalBranch?.branchId).toBe("branch-beta");
  expect(scenarios[1].functionalBranch?.branchId).toBe("branch-alfa");
  expect(scenarios[2].functionalBranch?.branchId).toBe("branch-alfa");
});

test("assignFunctionalBranchesToScenarios ignores explicit branchId from another issue and uses scoped match", () => {
  const branches: FunctionalBranchRef[] = [
    {
      branchId: "branch-alfa",
      sourceLabel: "Opción Alfa",
      actionIntent: "select_option",
      expectedDestination: "Destino Alfa",
      accessIntent: "public",
      evidenceSource: "user_story",
      sourceRequirementId: "option-flow:HU-1:1",
    },
    {
      branchId: "branch-beta",
      sourceLabel: "Opción Beta",
      actionIntent: "select_option",
      expectedDestination: "Destino Beta",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
      sourceRequirementId: "option-flow:HU-2:1",
    },
  ];

  const [scenario] = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        sourceIssueKey: "HU-1",
        scenarioId: "cross-issue-id",
        title: "Seleccionar opción alfa",
        steps: ['1. Clic en "Opción Alfa".'],
        ...({ branchId: "branch-beta" } as any),
      }),
    ],
    branches,
  );

  expect(scenario.functionalBranch?.branchId).toBe("branch-alfa");
  expect(scenario.branchAssociation?.associationMethod).toBe("normalized_action");
});

test("assignFunctionalBranchesToScenarios prioritizes structured metadata over textual overlap", () => {
  const branches: FunctionalBranchRef[] = [
    {
      branchId: "branch-alfa",
      sourceLabel: "Opción Alfa",
      actionIntent: "select_option",
      expectedDestination: "Destino Alfa",
      accessIntent: "public",
      evidenceSource: "user_story",
      sourceRequirementId: "option-flow:HU-1:1",
    },
    {
      branchId: "branch-beta",
      sourceLabel: "Opción Beta",
      actionIntent: "select_option",
      expectedDestination: "Destino Beta",
      accessIntent: "public",
      evidenceSource: "user_story",
      sourceRequirementId: "option-flow:HU-1:2",
    },
  ];

  const [scenario] = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        sourceIssueKey: "HU-1",
        scenarioId: "metadata-priority",
        title: "Escenario de navegación",
        steps: ['1. Clic en "Opción Alfa".'],
        functionalBranch: {
          branchId: "",
          sourceLabel: "Opción Beta",
          actionIntent: "select_option",
          expectedDestination: "Destino Beta",
          accessIntent: "public",
          evidenceSource: "user_story",
        },
      }),
    ],
    branches,
  );

  expect(scenario.functionalBranch?.branchId).toBe("branch-beta");
  expect(scenario.branchAssociation?.associationMethod).toBe("structured_metadata");
});

test("assignFunctionalBranchesToScenarios normalizes action identity with accents, articles and case", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-public-info",
    sourceLabel: "Módulo de Información",
    actionIntent: "select_option",
    expectedDestination: "Pantalla informativa",
    accessIntent: "public",
    evidenceSource: "acceptance_criteria",
    sourceRequirementId: "option-flow:HU-1:1",
  };

  const [scenario] = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        sourceIssueKey: "HU-1",
        scenarioId: "normalized-action",
        title: "Validar acceso al módulo informativo",
        steps: ['1. Clic en "LA OPCIÓN modulo de informacion".'],
      }),
    ],
    [branch],
  );

  expect(scenario.functionalBranch?.branchId).toBe("branch-public-info");
  expect(scenario.branchAssociation?.associationMethod).toBe("normalized_action");
  expect(scenario.branchAssociation?.actionMatched).toBe(true);
});

test("assignFunctionalBranchesToScenarios does not associate branch on generic ambiguous wording", () => {
  const branches: FunctionalBranchRef[] = [
    {
      branchId: "branch-informacion-general",
      sourceLabel: "Información general",
      actionIntent: "select_option",
      expectedDestination: "General",
      accessIntent: "public",
      evidenceSource: "user_story",
      sourceRequirementId: "option-flow:HU-1:1",
    },
    {
      branchId: "branch-informacion-productos",
      sourceLabel: "Información de productos",
      actionIntent: "select_option",
      expectedDestination: "Productos",
      accessIntent: "public",
      evidenceSource: "user_story",
      sourceRequirementId: "option-flow:HU-1:2",
    },
  ];

  const [scenario] = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        sourceIssueKey: "HU-1",
        scenarioId: "ambiguous-generic",
        title: "Visualizar información",
        steps: ['1. Clic en "Información".'],
      }),
    ],
    branches,
  );

  expect(scenario.functionalBranch).toBeUndefined();
  expect(scenario.branchAssociation?.associationMethod).toBe("none");
});

test("assignFunctionalBranchesToScenarios keeps associationMatched true but actionMatched false for branch_id with different action identity", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-public",
    sourceLabel: "Información de productos",
    actionIntent: "select_option",
    expectedDestination: "Destino público",
    accessIntent: "public",
    evidenceSource: "user_story",
    sourceRequirementId: "option-flow:HU-1:1",
  };

  const [scenario] = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        sourceIssueKey: "HU-1",
        scenarioId: "branch-id-action-mismatch",
        functionalBranch: {
          branchId: "branch-public",
          actionIntent: "select_option",
          accessIntent: "public",
          evidenceSource: "user_story",
        },
        steps: ['1. Clic en "Iniciar".'],
      }),
    ],
    [branch],
  );

  expect(scenario.functionalBranch?.branchId).toBe("branch-public");
  expect(scenario.branchAssociation?.associationMatched).toBe(true);
  expect(scenario.branchAssociation?.expectedActionIdentity).toBe("informacion productos");
  expect(scenario.branchAssociation?.actualActionIdentity).toBe("iniciar");
  expect(scenario.branchAssociation?.actionMatched).toBe(false);
});

test("assignFunctionalBranchesToScenarios marks actionMatched true for equivalent normalized identities", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-auth",
    sourceLabel: "Transacciones y servicios",
    actionIntent: "start_authentication",
    expectedDestination: "Inicio de autenticacion",
    accessIntent: "authenticated",
    evidenceSource: "user_story",
    sourceRequirementId: "option-flow:HU-1:2",
  };

  const [scenario] = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        sourceIssueKey: "HU-1",
        scenarioId: "equivalent-action",
        ...({ branchId: "branch-auth" } as any),
        steps: ['1. Clic en "TRANSACCIONES Y SERVICIOS".'],
      }),
    ],
    [branch],
  );

  expect(scenario.branchAssociation?.associationMatched).toBe(true);
  expect(scenario.branchAssociation?.actionMatched).toBe(true);
  expect(scenario.branchAssociation?.expectedActionIdentity).toBe("transacciones servicios");
  expect(scenario.branchAssociation?.actualActionIdentity).toBe("transacciones servicios");
});

test("assignFunctionalBranchesToScenarios uses executed click target as actualActionIdentity when click step also contains assertion text", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-public",
    sourceLabel: "Información de productos",
    actionIntent: "select_option",
    expectedDestination: "Destino público",
    accessIntent: "public",
    evidenceSource: "user_story",
    sourceRequirementId: "option-flow:HU-1:1",
  };

  const [scenario] = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        sourceIssueKey: "HU-1",
        scenarioId: "click-plus-assertion-inline",
        functionalBranch: {
          branchId: "branch-public",
          actionIntent: "select_option",
          accessIntent: "public",
          evidenceSource: "user_story",
        },
        steps: ['1. Clic en "Iniciar". Validar que se muestre "Información de productos".'],
      }),
    ],
    [branch],
  );

  expect(scenario.branchAssociation?.expectedActionIdentity).toBe("informacion productos");
  expect(scenario.branchAssociation?.actualActionIdentity).toBe("iniciar");
  expect(scenario.branchAssociation?.actionMatched).toBe(false);
});

test("assignFunctionalBranchesToScenarios keeps actualActionIdentity empty when scenario has no executable action steps", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-auth",
    sourceLabel: "Transacciones y servicios",
    actionIntent: "start_authentication",
    expectedDestination: "Inicio de autenticacion",
    accessIntent: "authenticated",
    evidenceSource: "user_story",
    sourceRequirementId: "option-flow:HU-1:2",
  };

  const [scenario] = assignFunctionalBranchesToScenarios(
    [
      makeScenario({
        sourceIssueKey: "HU-1",
        scenarioId: "no-action-step",
        functionalBranch: {
          branchId: "branch-auth",
          actionIntent: "start_authentication",
          accessIntent: "authenticated",
          evidenceSource: "user_story",
        },
        steps: ['1. Validar que se muestre "Transacciones y servicios".'],
      }),
    ],
    [branch],
  );

  expect(scenario.branchAssociation?.associationMatched).toBe(true);
  expect(scenario.branchAssociation?.actualActionIdentity).toBe("");
  expect(scenario.branchAssociation?.actionMatched).toBe(false);
});

test("applyBranchRoutePrefixRepair applies only compatible route prefix per branch", () => {
  const routeCandidates: BranchRouteCandidate[] = [
    {
      routeId: "private-route",
      source: "knowledge",
      clickTargets: ["Inicio", "Zona Beta Privada"],
      accessIntent: "authenticated",
    },
    {
      routeId: "public-route",
      source: "knowledge",
      clickTargets: ["Inicio", "Portal Público Alfa"],
      accessIntent: "public",
    },
  ];

  const { scenarios } = applyBranchRoutePrefixRepair(
    [
      makeScenario({
        scenarioId: "alpha",
        title: "Flujo rama alfa",
        steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Portal Público Alfa".'],
        functionalBranch: {
          branchId: "branch-alpha",
          sourceLabel: "Opción Alfa",
          actionIntent: "select_option",
          expectedDestination: "Portal Público Alfa",
          accessIntent: "public",
          evidenceSource: "acceptance_criteria",
        },
      }),
      makeScenario({
        scenarioId: "beta",
        title: "Flujo rama beta",
        steps: ['1. Clic en "Opción Beta".', '2. Validar que se muestre "Zona Beta Privada".'],
        functionalBranch: {
          branchId: "branch-beta",
          sourceLabel: "Opción Beta",
          actionIntent: "select_option",
          expectedDestination: "Zona Beta Privada",
          accessIntent: "authenticated",
          evidenceSource: "acceptance_criteria",
        },
      }),
    ],
    routeCandidates,
  );

  expect(scenarios[0].steps[0]).toContain('Clic en "Inicio"');
  expect(scenarios[0].steps[1]).toContain('Clic en "Portal Público Alfa"');
  expect(scenarios[0].steps.join(" ")).not.toContain('Clic en "Zona Beta Privada"');

  expect(scenarios[1].steps[0]).toContain('Clic en "Inicio"');
  expect(scenarios[1].steps[1]).toContain('Clic en "Zona Beta Privada"');
});

test("applyBranchRoutePrefixRepair rejects incompatible route and preserves original branch flow", () => {
  const scenario = makeScenario({
    scenarioId: "public-beta",
    steps: ['1. Clic en "Opción Beta".', '2. Validar que se muestre "Zona Beta Privada".'],
    functionalBranch: {
      branchId: "branch-public-beta",
      sourceLabel: "Opción Beta",
      actionIntent: "select_option",
      expectedDestination: "Zona Beta Privada",
      accessIntent: "public",
      evidenceSource: "acceptance_criteria",
    },
  });
  const routeCandidates: BranchRouteCandidate[] = [
    {
      routeId: "private-route",
      source: "knowledge",
      clickTargets: ["Inicio", "Zona Beta Privada"],
      accessIntent: "authenticated",
    },
  ];

  const { scenarios, repairedCount, incompatibleCount } = applyBranchRoutePrefixRepair([scenario], routeCandidates);
  expect(repairedCount).toBe(0);
  expect(incompatibleCount).toBeGreaterThan(0);
  expect(scenarios[0].steps).toEqual(scenario.steps);
});

test("applyBranchRoutePrefixRepair does not overwrite actualActionIdentity from assertions when route is incompatible", () => {
  const scenario = makeScenario({
    scenarioId: "identity-preserved",
    steps: ['1. Clic en "Iniciar". Validar que se muestre "Información de productos".'],
    functionalBranch: {
      branchId: "branch-public",
      sourceLabel: "Información de productos",
      actionIntent: "select_option",
      expectedDestination: "Destino Público",
      accessIntent: "public",
      evidenceSource: "acceptance_criteria",
    },
  });
  const routeCandidates: BranchRouteCandidate[] = [
    {
      routeId: "auth-only",
      source: "knowledge",
      clickTargets: ["Inicio", "Zona Privada"],
      accessIntent: "authenticated",
    },
  ];

  const { scenarios } = applyBranchRoutePrefixRepair([scenario], routeCandidates);
  expect(scenarios[0].branchAssociation?.actualActionIdentity).toBe("iniciar");
  expect(scenarios[0].branchAssociation?.actionMatched).toBe(false);
  expect(scenarios[0].branchAssociation?.reasonCode).not.toBe("ok");
});

test("computeBranchCoverageCheck fails when one branch is missing even with duplicated scenarios", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    { branchId: "branch-alpha", sourceLabel: "Opción Alfa", actionIntent: "select_option", expectedDestination: "Destino Alfa", accessIntent: "public", evidenceSource: "user_story" },
    { branchId: "branch-beta", sourceLabel: "Opción Beta", actionIntent: "select_option", expectedDestination: "Destino Beta", accessIntent: "authenticated", evidenceSource: "user_story" },
  ];
  const finalScenarios = [
    makeScenario({ scenarioId: "s1", steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'], functionalBranch: requiredBranches[0] }),
    makeScenario({ scenarioId: "s2", steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'], functionalBranch: requiredBranches[0] }),
  ];

  const coverage = computeBranchCoverageCheck(requiredBranches, finalScenarios);
  expect(coverage.required).toBe(2);
  expect(coverage.covered).toBe(1);
  expect(coverage.missing).toEqual(["branch-beta"]);
  expect(coverage.valid).toBe(false);
});

test("computeBranchCoverageCheck passes when all required branches are represented", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    { branchId: "branch-alpha", sourceLabel: "Opción Alfa", actionIntent: "select_option", expectedDestination: "Destino Alfa", accessIntent: "public", evidenceSource: "user_story" },
    { branchId: "branch-beta", sourceLabel: "Opción Beta", actionIntent: "select_option", expectedDestination: "Destino Beta", accessIntent: "authenticated", evidenceSource: "user_story" },
    { branchId: "branch-gamma", sourceLabel: "Opción Gamma", actionIntent: "select_option", expectedDestination: "Destino Gamma", accessIntent: "public", evidenceSource: "user_story" },
  ];
  const finalScenarios = [
    makeScenario({ scenarioId: "alpha", title: "Alfa", steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'], functionalBranch: requiredBranches[0] }),
    makeScenario({ scenarioId: "beta", title: "Beta", steps: ['1. Clic en "Opción Beta".', '2. Validar que se muestre "Destino Beta".'], functionalBranch: requiredBranches[1] }),
    makeScenario({ scenarioId: "gamma", title: "Gamma", steps: ['1. Clic en "Opción Gamma".', '2. Validar que se muestre "Destino Gamma".'], functionalBranch: requiredBranches[2] }),
  ];

  const coverage = computeBranchCoverageCheck(requiredBranches, finalScenarios);
  expect(coverage.valid).toBe(true);
  expect(coverage.missing).toHaveLength(0);
  expect(coverage.covered).toBe(3);
});

test("computeBranchCoverageCheck requires decisive click and destination assertion per branch", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    {
      branchId: "branch-alfa",
      sourceLabel: "Opción Alfa",
      actionIntent: "select_option",
      expectedDestination: "Destino Alfa",
      accessIntent: "public",
      evidenceSource: "user_story",
    },
  ];
  const finalScenarios = [
    makeScenario({
      scenarioId: "label-only",
      steps: ['1. Validar que se muestre "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'],
      functionalBranch: requiredBranches[0],
    }),
  ];

  const coverage = computeBranchCoverageCheck(requiredBranches, finalScenarios);
  expect(coverage.valid).toBe(false);
  expect(coverage.missing).toEqual(["branch-alfa"]);
});

test("computeBranchCoverageCheck accepts auth boundary evidence for authenticated start branches", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    {
      branchId: "branch-auth-start",
      sourceLabel: "Transacciones y servicios",
      actionIntent: "start_authentication",
      expectedDestination: "Inicio de autenticacion",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    },
  ];
  const finalScenarios = [
    makeScenario({
      scenarioId: "auth-boundary",
      steps: [
        '1. Clic en "Transacciones y servicios".',
        '2. Validar que se muestre "Seleccione tipo de identificación".',
      ],
      functionalBranch: requiredBranches[0],
    }),
  ];
  const coverage = computeBranchCoverageCheck(requiredBranches, finalScenarios);
  expect(coverage.valid).toBe(true);
  expect(coverage.missing).toHaveLength(0);
});

test("computeBranchCoverageCheck rejects conceptual auth phrase as boundary evidence", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    {
      branchId: "branch-auth-start",
      sourceLabel: "Transacciones y servicios",
      actionIntent: "start_authentication",
      expectedDestination: "Inicio de autenticacion",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    },
  ];
  const finalScenarios = [
    makeScenario({
      scenarioId: "auth-conceptual",
      steps: [
        '1. Clic en "Transacciones y servicios".',
        '2. Validar que se muestre "Flujo de autenticación".',
      ],
      functionalBranch: requiredBranches[0],
    }),
  ];
  const coverage = computeBranchCoverageCheck(requiredBranches, finalScenarios);
  expect(coverage.valid).toBe(false);
  expect(coverage.missing).toEqual(["branch-auth-start"]);
});

test("computeBranchCoverageCheck does not accept private destination without auth boundary for auth-start branches", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    {
      branchId: "branch-auth-start",
      sourceLabel: "Transacciones y servicios",
      actionIntent: "start_authentication",
      expectedDestination: "Inicio de autenticacion",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    },
  ];
  const finalScenarios = [
    makeScenario({
      scenarioId: "missing-auth-boundary",
      steps: [
        '1. Clic en "Transacciones y servicios".',
        '2. Validar que se muestre "Panel privado de transacciones".',
      ],
      functionalBranch: requiredBranches[0],
    }),
  ];
  const coverage = computeBranchCoverageCheck(requiredBranches, finalScenarios);
  expect(coverage.valid).toBe(false);
  expect(coverage.missing).toEqual(["branch-auth-start"]);
});

test("computeBranchCoverageCheck marks branch_extraction_mismatch when option flows exist but branches are empty", () => {
  const coverage = computeBranchCoverageCheck([], [], { automatableOptionFlowsCount: 2 });
  expect(coverage.valid).toBe(false);
  expect(coverage.reasonCode).toBe("branch_extraction_mismatch");
});

test("computeBranchCoverageCheck marks coverage_requirements_unavailable when coverage requirements are missing", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    {
      branchId: "branch-alfa",
      sourceLabel: "Opción Alfa",
      actionIntent: "select_option",
      expectedDestination: "Destino Alfa",
      accessIntent: "public",
      evidenceSource: "user_story",
    },
  ];
  const finalScenarios = [
    makeScenario({
      scenarioId: "alfa-covered",
      steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'],
      functionalBranch: requiredBranches[0],
    }),
  ];
  const coverage = computeBranchCoverageCheck(requiredBranches, finalScenarios, {
    coverageRequirementsAvailable: false,
  });
  expect(coverage.valid).toBe(false);
  expect(coverage.reasonCode).toBe("coverage_requirements_unavailable");
});

test("computeBranchCoverageCheck allows HU without branches when no option flows exist", () => {
  const coverage = computeBranchCoverageCheck([], [], {
    automatableOptionFlowsCount: 0,
    coverageRequirementsAvailable: false,
  });
  expect(coverage.valid).toBe(true);
  expect(coverage.reasonCode).toBeUndefined();
});

test("computeBranchCoverageCheck does not count route_evidence_insufficient as covered branch", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    {
      branchId: "branch-beta",
      sourceLabel: "Opción Beta",
      actionIntent: "select_option",
      expectedDestination: "Destino Beta",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    },
  ];
  const finalScenarios = [
    makeScenario({
      scenarioId: "beta-diagnostic",
      steps: ['1. Clic en "Opción Beta".', '2. Validar que se muestre "Destino Beta".'],
      mcpExecutable: false,
      nonExecutableCriteria: "route_evidence_insufficient",
      functionalBranch: requiredBranches[0],
    }),
  ];
  const coverage = computeBranchCoverageCheck(requiredBranches, finalScenarios);
  expect(coverage.valid).toBe(false);
  expect(coverage.missing).toEqual(["branch-beta"]);
});

test("computeBranchCoverageCheck preserves destination_mismatch as uncovered even with branch_id association and action matched", () => {
  const requiredBranches: FunctionalBranchRef[] = [
    {
      branchId: "branch-public",
      sourceLabel: "Opción pública",
      actionIntent: "select_option",
      expectedDestination: "Destino público",
      accessIntent: "public",
      evidenceSource: "user_story",
    },
    {
      branchId: "branch-auth",
      sourceLabel: "Transacciones",
      actionIntent: "start_authentication",
      expectedDestination: "Inicio de autenticacion",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    },
  ];
  const publicScenario = makeScenario({
    scenarioId: "public-destination-mismatch",
    title: "Redirigir al destino publico",
    steps: ['1. Clic en "Opción pública".', '2. Validar que se muestre "Destino público".'],
    functionalBranch: requiredBranches[0],
    branchAssociation: {
      branchId: "branch-public",
      sourceIssueKey: "HU-1",
      associationMethod: "branch_id",
      associationMatched: true,
      expectedActionIdentity: "opcion publica",
      actualActionIdentity: "opcion publica",
      actionMatched: true,
      destinationMatched: false,
      destinationEvidenceKind: "none",
      destinationEvidenceSource: "route:none:destination_mismatch",
      reasonCode: "destination_mismatch",
    },
  });
  (publicScenario as any)._branchRouteCompatibility = {
    compatible: false,
    reason: "destination_mismatch",
    routeId: null,
  };

  const authScenario = makeScenario({
    scenarioId: "auth-destination-mismatch",
    title: "Iniciar autenticación",
    steps: ['1. Clic en "Transacciones".', '2. Validar que se muestre "Iniciar el flujo de autenticación".'],
    functionalBranch: requiredBranches[1],
  });
  (authScenario as any)._branchRouteCompatibility = {
    compatible: false,
    reason: "destination_mismatch",
    routeId: null,
  };

  const coverage = computeBranchCoverageCheck(requiredBranches, [publicScenario, authScenario]);
  expect(coverage.required).toBe(2);
  expect(coverage.covered).toBe(0);
  expect(coverage.missing).toEqual(["branch-public", "branch-auth"]);
  expect(coverage.valid).toBe(false);
});

test("computeBranchCoverageCheck does not infer destination from title or expectedResult when route says destination_mismatch", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-public",
    sourceLabel: "Opción pública",
    actionIntent: "select_option",
    expectedDestination: "Destino público",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const scenario = makeScenario({
    scenarioId: "public-textual-only",
    title: "Redirigir al destino público",
    steps: ['1. Clic en "Opción pública".', '2. Validar que se muestre "Pantalla principal".'],
    expectedResult: 'Se redirige al "Destino público".',
    functionalBranch: branch,
  });
  (scenario as any)._branchRouteCompatibility = {
    compatible: false,
    reason: "destination_mismatch",
    routeId: null,
  };

  const coverage = computeBranchCoverageCheck([branch], [scenario]);
  expect(coverage.covered).toBe(0);
  expect(coverage.missing).toEqual(["branch-public"]);
  expect(coverage.valid).toBe(false);
});

test("computeBranchCoverageCheck can produce covered=1 when only public route has reliable evidence", () => {
  const publicBranch: FunctionalBranchRef = {
    branchId: "branch-public",
    sourceLabel: "Opción pública",
    actionIntent: "select_option",
    expectedDestination: "Destino público",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const authBranch: FunctionalBranchRef = {
    branchId: "branch-auth",
    sourceLabel: "Transacciones",
    actionIntent: "start_authentication",
    expectedDestination: "Inicio de autenticacion",
    accessIntent: "authenticated",
    evidenceSource: "user_story",
  };
  const publicScenario = makeScenario({
    scenarioId: "public-route-backed",
    steps: ['1. Clic en "Opción pública".'],
    functionalBranch: publicBranch,
  });
  (publicScenario as any)._branchRouteCompatibility = {
    compatible: true,
    reason: "ok",
    routeId: "knowledge-1",
  };

  const authScenario = makeScenario({
    scenarioId: "auth-no-boundary",
    steps: ['1. Clic en "Transacciones".', '2. Validar que se muestre "Flujo de autenticación".'],
    functionalBranch: authBranch,
  });
  (authScenario as any)._branchRouteCompatibility = {
    compatible: false,
    reason: "destination_mismatch",
    routeId: null,
  };

  const coverage = computeBranchCoverageCheck([publicBranch, authBranch], [publicScenario, authScenario]);
  expect(coverage.required).toBe(2);
  expect(coverage.covered).toBe(1);
  expect(coverage.missing).toEqual(["branch-auth"]);
  expect(coverage.valid).toBe(false);
});

test("computeBranchCoverageCheck can produce covered=2 when both branches have reliable evidence", () => {
  const publicBranch: FunctionalBranchRef = {
    branchId: "branch-public",
    sourceLabel: "Opción pública",
    actionIntent: "select_option",
    expectedDestination: "Destino público",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const authBranch: FunctionalBranchRef = {
    branchId: "branch-auth",
    sourceLabel: "Transacciones",
    actionIntent: "start_authentication",
    expectedDestination: "Inicio de autenticacion",
    accessIntent: "authenticated",
    evidenceSource: "user_story",
  };
  const publicScenario = makeScenario({
    scenarioId: "public-route-backed",
    steps: ['1. Clic en "Opción pública".', '2. Validar que se muestre "Destino público".'],
    functionalBranch: publicBranch,
  });
  (publicScenario as any)._branchRouteCompatibility = {
    compatible: true,
    reason: "ok",
    routeId: "knowledge-1",
  };

  const authScenario = makeScenario({
    scenarioId: "auth-boundary-observable",
    steps: ['1. Clic en "Transacciones".', '2. Validar que se muestre "Seleccione tipo de identificación".'],
    functionalBranch: authBranch,
  });
  (authScenario as any)._branchRouteCompatibility = {
    compatible: true,
    reason: "ok",
    routeId: "knowledge-2",
  };

  const coverage = computeBranchCoverageCheck([publicBranch, authBranch], [publicScenario, authScenario]);
  expect(coverage.required).toBe(2);
  expect(coverage.covered).toBe(2);
  expect(coverage.missing).toHaveLength(0);
  expect(coverage.valid).toBe(true);
});

test("reclassifyScenariosByBranchCoverage reclassifies only affected branch scenarios", () => {
  const alphaBranch: FunctionalBranchRef = {
    branchId: "branch-alpha",
    sourceLabel: "Información de productos",
    actionIntent: "select_option",
    expectedDestination: "Portal público",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const betaBranch: FunctionalBranchRef = {
    branchId: "branch-beta",
    sourceLabel: "Transacciones y servicios",
    actionIntent: "start_authentication",
    expectedDestination: "Inicio de autenticacion",
    accessIntent: "authenticated",
    evidenceSource: "user_story",
  };
  const generalScenario = makeScenario({
    scenarioId: "general-ui",
    title: "Visualizar pantalla inicial",
    steps: ['1. Clic en "Iniciar".', '2. Validar que se muestre "Inicio".'],
  });
  const publicBranchScenario = makeScenario({
    scenarioId: "public-branch",
    steps: ['1. Clic en "Información de productos".', '2. Validar que se muestre "Portal público".'],
    functionalBranch: alphaBranch,
  });
  const authBranchScenario = makeScenario({
    scenarioId: "auth-branch",
    steps: ['1. Clic en "Transacciones y servicios".', '2. Validar que se muestre "Flujo de autenticación".'],
    functionalBranch: betaBranch,
  });

  const result = reclassifyScenariosByBranchCoverage(
    [generalScenario, publicBranchScenario, authBranchScenario],
    [],
    [alphaBranch, betaBranch],
  );

  expect(result.summary.considered).toBe(2);
  expect(result.summary.affected).toBe(1);
  expect(result.summary.changed).toBe(1);
  expect(result.executableScenarios.map((scenario) => scenario.scenarioId)).toEqual(
    expect.arrayContaining(["general-ui", "public-branch"]),
  );
  const reclassifiedAuth = result.adaptiveScenarios.find((scenario) => scenario.scenarioId === "auth-branch");
  expect(reclassifiedAuth).toBeDefined();
  expect(reclassifiedAuth?.mcpExecutable).toBe(false);
  expect(reclassifiedAuth?.nonExecutableCriteria).toBe("branch_coverage_incomplete");
  expect(authBranchScenario.branchAssociation?.actionMatched).toBe(true);
  expect(authBranchScenario.branchAssociation?.destinationMatched).toBe(false);
  expect(authBranchScenario.branchAssociation?.reasonCode).toBe("destination_mismatch");
});

test("reclassifyScenariosByBranchCoverage preserves action mismatch even when destination evidence exists", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-public",
    sourceLabel: "Información de productos",
    actionIntent: "select_option",
    expectedDestination: "Portal público",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const associatedScenario = makeScenario({
    scenarioId: "action-mismatch-with-route",
    steps: ['1. Clic en "Iniciar".', '2. Validar que se muestre "Portal público".'],
    functionalBranch: branch,
    branchAssociation: {
      branchId: "branch-public",
      sourceIssueKey: "HU-1",
      associationMethod: "branch_id",
      associationMatched: true,
      expectedActionIdentity: "informacion productos",
      actualActionIdentity: "iniciar",
      actionMatched: false,
      destinationMatched: true,
      destinationEvidenceKind: "route",
      destinationEvidenceSource: "route:knowledge-1",
      reasonCode: "ok",
    },
  });
  (associatedScenario as any)._branchRouteCompatibility = {
    compatible: true,
    reason: "ok",
    routeId: "knowledge-1",
  };

  const result = reclassifyScenariosByBranchCoverage(
    [associatedScenario],
    [],
    [branch],
  );

  expect(result.summary.considered).toBe(1);
  expect(result.summary.affected).toBe(1);
  expect(result.summary.changed).toBe(1);
  expect(associatedScenario.branchAssociation?.associationMatched).toBe(true);
  expect(associatedScenario.branchAssociation?.actionMatched).toBe(false);
  expect(associatedScenario.branchAssociation?.destinationMatched).toBe(true);
  expect(associatedScenario.branchAssociation?.reasonCode).toBe("branch_action_mismatch");
  expect(result.executableScenarios).toHaveLength(0);
  expect(result.adaptiveScenarios).toHaveLength(1);
});

test("reclassifyScenariosByBranchCoverage does not degrade general scenarios when missing branch has no scenario", () => {
  const alphaBranch: FunctionalBranchRef = {
    branchId: "branch-alpha",
    sourceLabel: "Información de productos",
    actionIntent: "select_option",
    expectedDestination: "Portal público",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const betaBranch: FunctionalBranchRef = {
    branchId: "branch-beta",
    sourceLabel: "Transacciones y servicios",
    actionIntent: "start_authentication",
    expectedDestination: "Inicio de autenticacion",
    accessIntent: "authenticated",
    evidenceSource: "user_story",
  };
  const generalScenario = makeScenario({
    scenarioId: "general-ui",
    steps: ['1. Clic en "Iniciar".', '2. Validar que se muestre "Inicio".'],
  });
  const publicBranchScenario = makeScenario({
    scenarioId: "public-branch",
    steps: ['1. Clic en "Información de productos".', '2. Validar que se muestre "Portal público".'],
    functionalBranch: alphaBranch,
  });

  const result = reclassifyScenariosByBranchCoverage(
    [generalScenario, publicBranchScenario],
    [],
    [alphaBranch, betaBranch],
  );

  expect(result.summary.considered).toBe(1);
  expect(result.summary.affected).toBe(0);
  expect(result.summary.changed).toBe(0);
  expect(result.executableScenarios.map((scenario) => scenario.scenarioId)).toEqual(
    expect.arrayContaining(["general-ui", "public-branch"]),
  );
  expect(result.adaptiveScenarios).toHaveLength(0);
});

test("preserveScenarioOnIntermediateRepairFailure keeps branch scenario as diagnostic without deleting steps", () => {
  const scenario = makeScenario({
    scenarioId: "auth-branch",
    steps: [
      '1. Clic en "Iniciar".',
      '2. Clic en "Opción Beta".',
      '3. Validar que se muestre "Destino Beta".',
    ],
    functionalBranch: {
      branchId: "branch-beta",
      sourceLabel: "Opción Beta",
      actionIntent: "select_option",
      expectedDestination: "Destino Beta",
      accessIntent: "authenticated",
      evidenceSource: "user_story",
    },
  });
  const repairResult: IntermediateRepairResult = {
    repaired: false,
    originalSteps: [...scenario.steps],
    repairedSteps: [...scenario.steps],
    insertedSteps: [],
    insertedCount: 0,
    reasonCode: "unresolvable_path",
    diagnostics: [
      {
        level: "error",
        target: "Opción Beta",
        decision: "rejected_unresolvable",
        message: "Cannot resolve path",
      },
    ],
  };
  const preserved = preserveScenarioOnIntermediateRepairFailure(scenario, repairResult);
  expect(preserved.steps).toEqual(scenario.steps);
  expect(preserved.mcpExecutable).toBe(false);
  expect(preserved.nonExecutableCriteria).toBe("route_evidence_insufficient");
  expect((preserved as any)._blockedReason).toBe("route_evidence_insufficient");
});

test("evaluateGenerationSuccess blocks success when branchCoverage is invalid even if visibility is equal", () => {
  const blocked = evaluateGenerationSuccess(
    true,
    {
      required: 2,
      covered: 1,
      missing: ["branch-beta"],
      unexpected: [],
      requiredBranchIds: ["branch-alfa", "branch-beta"],
      coveredBranchIds: ["branch-alfa"],
      valid: false,
    },
    true,
  );
  expect(blocked.generationSuccess).toBe(false);
  expect(blocked.blockedReasons).toContain("branch_coverage_invalid");
});

test("evaluateGenerationSuccess requires visibility + branch coverage + coverage requirements", () => {
  const ok = evaluateGenerationSuccess(
    true,
    {
      required: 2,
      covered: 2,
      missing: [],
      unexpected: [],
      requiredBranchIds: ["branch-alfa", "branch-beta"],
      coveredBranchIds: ["branch-alfa", "branch-beta"],
      valid: true,
    },
    true,
  );
  expect(ok.generationSuccess).toBe(true);
  expect(ok.blockedReasons).toHaveLength(0);
});

test("evaluateGenerationSuccess blocks success when omitted or category integrity checks fail", () => {
  const blocked = evaluateGenerationSuccess(
    true,
    {
      required: 1,
      covered: 1,
      missing: [],
      unexpected: [],
      requiredBranchIds: ["branch-alfa"],
      coveredBranchIds: ["branch-alfa"],
      valid: true,
    },
    true,
    {
      omittedValid: false,
      categoriesDisjoint: false,
    },
  );
  expect(blocked.generationSuccess).toBe(false);
  expect(blocked.blockedReasons).toContain("omitted_invalid");
  expect(blocked.blockedReasons).toContain("category_overlap_detected");
});

test("computeResponseAssemblyMetrics does not subtract rejected IDs outside candidates", () => {
  const candidate = makeScenario({ scenarioId: "candidate-1", title: "Escenario candidato" });
  const metrics = computeResponseAssemblyMetrics(
    [candidate],
    [],
    [],
    [
      { sourceIssueKey: "OTHER-1", reason: "external_rejected_one" },
      { sourceIssueKey: "OTHER-2", reason: "external_rejected_two" },
    ],
  );
  expect(metrics.candidateIds).toHaveLength(1);
  expect(metrics.rejectedCandidateIds).toHaveLength(0);
  expect(metrics.omitted).toBe(1);
  expect(metrics.omittedValid).toBe(true);
});

test("computeResponseAssemblyMetrics keeps omitted at zero when candidates are empty", () => {
  const metrics = computeResponseAssemblyMetrics(
    [],
    [],
    [],
    [
      { sourceIssueKey: "AA-1", reason: "rejected_outside_candidates" },
      { sourceIssueKey: "AA-2", reason: "rejected_outside_candidates" },
    ],
  );
  expect(metrics.candidateIds).toHaveLength(0);
  expect(metrics.omitted).toBe(0);
  expect(metrics.omittedValid).toBe(true);
});

test("markScenariosAsCoverageDiagnostics makes response scenarios non-selectable", () => {
  const diagnostics = markScenariosAsCoverageDiagnostics(
    [
      makeScenario({
        scenarioId: "alpha-standard",
        mcpExecutable: true,
        functionalBranch: {
          branchId: "branch-alfa",
          sourceLabel: "Opción Alfa",
          actionIntent: "select_option",
          expectedDestination: "Destino Alfa",
          accessIntent: "public",
          evidenceSource: "user_story",
        },
      }),
    ],
    {
      required: 2,
      covered: 1,
      missing: ["branch-beta"],
      unexpected: [],
      requiredBranchIds: ["branch-alfa", "branch-beta"],
      coveredBranchIds: ["branch-alfa"],
      valid: false,
    },
  );
  expect(diagnostics).toHaveLength(1);
  expect(diagnostics[0].mcpExecutable).toBe(false);
  expect(diagnostics[0].nonExecutableCriteria).toBe("branch_coverage_incomplete");
  expect((diagnostics[0] as any).executionMode).toBe("adaptive");
});

test("dedupeScenariosBySemanticSignature removes semantic duplicates with different titles", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-alfa",
    sourceLabel: "Opción Alfa",
    actionIntent: "select_option",
    expectedDestination: "Destino Alfa",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const scenarios = [
    makeScenario({
      scenarioId: "alfa-1",
      title: "Visualizar flujo alfa",
      steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'],
      functionalBranch: branch,
    }),
    makeScenario({
      scenarioId: "alfa-2",
      title: "Comprobar recorrido alfa",
      steps: ['1. Clic en "Opción Alfa".', '2. Verificar que se muestre "Destino Alfa".'],
      functionalBranch: branch,
    }),
  ];
  const deduped = dedupeScenariosBySemanticSignature(scenarios);
  expect(deduped.removed).toBe(1);
  expect(deduped.scenarios).toHaveLength(1);
});

test("buildScenarioSemanticSignature ignores equivalent assertion ordering", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-gamma",
    sourceLabel: "Opción Gamma",
    actionIntent: "select_option",
    expectedDestination: "Destino Gamma",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const scenarioA = makeScenario({
    scenarioId: "gamma-a",
    steps: [
      '1. Clic en "Opción Gamma".',
      '2. Validar que se muestre "Destino Gamma".',
      '3. Validar que se muestre "Detalle".',
    ],
    functionalBranch: branch,
  });
  const scenarioB = makeScenario({
    scenarioId: "gamma-b",
    steps: [
      '1. Clic en "Opción Gamma".',
      '2. Validar que se muestre "Detalle".',
      '3. Comprobar que se muestre "Destino Gamma".',
    ],
    functionalBranch: branch,
  });
  expect(buildScenarioSemanticSignature(scenarioA)).toBe(buildScenarioSemanticSignature(scenarioB));
});

test("dedupeScenariosBySemanticSignature keeps scenarios from different branches or destinations", () => {
  const alfaBranch: FunctionalBranchRef = {
    branchId: "branch-alfa",
    sourceLabel: "Opción Alfa",
    actionIntent: "select_option",
    expectedDestination: "Destino Alfa",
    accessIntent: "public",
    evidenceSource: "user_story",
  };
  const betaBranch: FunctionalBranchRef = {
    branchId: "branch-beta",
    sourceLabel: "Opción Beta",
    actionIntent: "select_option",
    expectedDestination: "Destino Beta",
    accessIntent: "authenticated",
    evidenceSource: "user_story",
  };
  const scenarios = [
    makeScenario({
      scenarioId: "alfa",
      steps: ['1. Clic en "Opción Alfa".', '2. Validar que se muestre "Destino Alfa".'],
      functionalBranch: alfaBranch,
    }),
    makeScenario({
      scenarioId: "beta",
      steps: ['1. Clic en "Opción Beta".', '2. Validar que se muestre "Destino Beta".'],
      functionalBranch: betaBranch,
    }),
  ];
  const deduped = dedupeScenariosBySemanticSignature(scenarios);
  expect(deduped.removed).toBe(0);
  expect(deduped.scenarios).toHaveLength(2);
});

test("evaluateBranchRecoveryEvidence rejects recovery when route evidence is insufficient", () => {
  const branch: FunctionalBranchRef = {
    branchId: "branch-beta",
    sourceLabel: "Opción Beta",
    actionIntent: "select_option",
    expectedDestination: "Destino Beta Privado",
    accessIntent: "authenticated",
    evidenceSource: "acceptance_criteria",
  };
  const routeCandidates: BranchRouteCandidate[] = [
    {
      routeId: "public-incompatible",
      source: "knowledge",
      clickTargets: ["Inicio", "Destino Alfa Público"],
      accessIntent: "public",
    },
  ];

  const result = evaluateBranchRecoveryEvidence(branch, routeCandidates);
  expect(result.recoverable).toBe(false);
  expect(result.reason).toBe("route_evidence_insufficient");
});

test("compareVisibleScenarioSets compares IDs and not only counts", () => {
  const finalVisible = [
    makeScenario({ scenarioId: "A" }),
    makeScenario({ scenarioId: "B" }),
  ];
  const responseVisible = [
    makeScenario({ scenarioId: "A" }),
    makeScenario({ scenarioId: "C" }),
  ];
  const comparison = compareVisibleScenarioSets(finalVisible, responseVisible);
  expect(comparison.equal).toBe(false);
  expect(comparison.missingInResponse).toEqual(["B"]);
  expect(comparison.unexpectedInResponse).toEqual(["C"]);
});

test("parseAiResponse preserves structured functionalBranch.branchId from AI JSON", () => {
  const parsed = parseAiResponse(JSON.stringify({
    appSlug: "sample-app",
    confidence: "high",
    reason: "ok",
    functionalRoute: "",
    routeProfile: {
      name: "profile",
      entry: [],
      aliases: {},
      intermediates: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
    },
    scenarios: [
      {
        sourceIssueKey: "HU-1",
        scenarioId: "HU-1:branch-beta:01",
        title: "Escenario rama beta",
        steps: ['1. Clic en "Opción Beta".'],
        preconditions: [],
        expectedResult: "OK",
        type: "functional",
        database: "",
        isConverted: 0,
        automationType: "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        appSlug: "sample-app",
        routeProfile: "profile",
        dataRequirements: "",
        nonExecutableCriteria: "",
        mcpExecutable: true,
        functionalBranch: {
          branchId: "branch-beta",
          actionIntent: "select_option",
          expectedDestination: "Destino Beta Privado",
          accessIntent: "authenticated",
          evidenceSource: "acceptance_criteria",
        },
      },
    ],
    warnings: [],
    rejected: [],
  }));

  expect(parsed).not.toBeNull();
  expect(parsed?.scenarios[0]?.functionalBranch?.branchId).toBe("branch-beta");
});

test("compareVisibleScenarioSets passes when final and response IDs are identical", () => {
  const finalVisible = [
    makeScenario({ scenarioId: "AA" }),
    makeScenario({ scenarioId: "BB" }),
  ];
  const responseVisible = [
    makeScenario({ scenarioId: "AA" }),
    makeScenario({ scenarioId: "BB" }),
  ];
  const comparison = compareVisibleScenarioSets(finalVisible, responseVisible);
  expect(comparison.equal).toBe(true);
  expect(comparison.missingInResponse).toHaveLength(0);
  expect(comparison.unexpectedInResponse).toHaveLength(0);
});

test("applyBranchRoutePrefixRepair keeps single-branch behavior", () => {
  const scenario = makeScenario({
    scenarioId: "single",
    steps: ['1. Validar que se muestre "Resultado".'],
    functionalBranch: {
      branchId: "branch-single",
      sourceLabel: "Opción Única",
      actionIntent: "select_option",
      accessIntent: "unknown",
      evidenceSource: "user_story",
    },
  });
  const routeCandidates: BranchRouteCandidate[] = [
    {
      routeId: "single-route",
      source: "hu_route",
      clickTargets: ["Inicio", "Opción Única"],
      accessIntent: "unknown",
    },
  ];

  const { scenarios, repairedCount } = applyBranchRoutePrefixRepair([scenario], routeCandidates);
  expect(repairedCount).toBe(1);
  expect(scenarios[0].steps[0]).toContain('Clic en "Inicio"');
  expect(scenarios[0].steps[1]).toContain('Clic en "Opción Única"');
});
