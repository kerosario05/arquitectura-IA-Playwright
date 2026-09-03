import { test, expect } from "@playwright/test";
import { aggregateLaunchCaseIds, buildCanonicalPublishedCases, buildLaunchSelectionPlan, classifyLaunchScenarioAuthority, launchExecution, resolveExistingCaseExecutionPlan } from "../src/server/jobs/launch-orchestrator";
import type { PromotedAutomationIndexEntry } from "../src/types/automation-promotion.types";
import { extractExistingTestRailCaseIdsFromPayload, extractLaunchScenariosFromPayload } from "../src/server/routes/runs";
import { validatePromotedEntryForExecution } from "../src/server/jobs/discovery-batch-runner";

function makeGeneratedScenario(id: string, title = "Generated scenario") {
  return {
    scenarioId: id,
    title,
    steps: ['Clic en "Iniciar".'],
    expectedResult: "OK",
    preconditions: [],
  };
}

function makeAutomationEntry(input: Partial<PromotedAutomationIndexEntry> & Pick<PromotedAutomationIndexEntry, "id" | "caseId">): PromotedAutomationIndexEntry {
  return {
    title: "Persisted automation",
    planPath: "automations/apps/project/cases/case/plan.json",
    specPath: "automations/apps/project/cases/case/case.spec.ts",
    appSlug: "project",
    appProfile: "project",
    appConfigPath: "automations/apps/project/app.config.json",
    status: "active",
    source: "discovery",
    pomStatus: "promoted",
    specVerificationStatus: "passed",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...input,
  };
}

test("solo Jira/IA: todos los escenarios seleccionados van a publicación", () => {
  const payload = {
    selectedScenarios: [
      makeGeneratedScenario("JIRA-001", "Escenario Jira 1"),
      makeGeneratedScenario("JIRA-002", "Escenario Jira 2"),
    ],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.scenariosToPublish.map((s) => s.scenarioId)).toEqual(["JIRA-001", "JIRA-002"]);
  expect(plan.existingTestRailCaseIds).toHaveLength(0);
});

test("solo casos existentes de TestRail: selección launchable sin escenarios a publicar", () => {
  const payload = {
    selectedTestRailCases: [
      { caseId: 42811, title: "Caso 42811" },
      { id: "42812", title: "Caso 42812" },
    ],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.scenariosToPublish).toHaveLength(0);
  expect(plan.existingTestRailCaseIds).toHaveLength(2);
  expect(plan.existingTestRailCaseIds).toEqual(expect.arrayContaining([42811, 42812]));
  expect(plan.invalidScenarioTitles).toHaveLength(0);
});

test("selección mixta: publica solo IA/Jira nuevos y reutiliza caseIds existentes", () => {
  const payload = {
    selectedScenarios: [
      makeGeneratedScenario("GEN-001", "Escenario IA nuevo"),
      { ...makeGeneratedScenario("LEGACY-CASE-55", "Caso existente"), testRailCaseId: 55 },
    ],
    selectedCaseIds: [55, 56],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.scenariosToPublish.map((s) => s.scenarioId)).toEqual(["GEN-001"]);
  expect(plan.existingTestRailCaseIds).toEqual(expect.arrayContaining([55, 56]));
  expect(plan.existingScenarios.map((s) => s.scenarioId)).toEqual(["LEGACY-CASE-55"]);
});

test("equivalentes de fuentes de caseIds se deduplican", () => {
  const payload = {
    selectedCaseIds: ["77", 78],
    testRailCaseIds: [78, "79"],
    existingTestRailCaseIds: [79, 80],
    selectedTestRailCases: [{ caseId: 80 }, { testRailCaseId: 81 }],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);

  expect(existingTestRailCaseIds.sort((a, b) => a - b)).toEqual([77, 78, 79, 80, 81]);
});

test("escenario con metadata.caseId no entra al plan de publicación", () => {
  const payload = {
    selectedScenarios: [
      {
        ...makeGeneratedScenario("WITH-META-CASE"),
        metadata: { caseId: 901 },
      },
    ],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.scenariosToPublish).toHaveLength(0);
  expect(plan.existingTestRailCaseIds).toEqual([901]);
});

test("escenario sin scenarioId ni caseId queda inválido para evitar ejecución ambigua", () => {
  const payload = {
    selectedScenarios: [
      {
        title: "Sin identificador",
        steps: ['Clic en "Iniciar".'],
        expectedResult: "OK",
        preconditions: [],
      },
    ],
  };

  const selectedScenarios = extractLaunchScenariosFromPayload(payload);
  const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(payload, selectedScenarios);
  const plan = buildLaunchSelectionPlan({ selectedScenarios, existingTestRailCaseIds });

  expect(plan.invalidScenarioTitles).toEqual(["Sin identificador"]);
});

test("launch authority preserves adaptive readiness and does not upgrade it", () => {
  expect(classifyLaunchScenarioAuthority({ mcpExecutable: true })).toBe("standard");
  expect(classifyLaunchScenarioAuthority({ mcpExecutable: false })).toBe("adaptive");
  expect(classifyLaunchScenarioAuthority({ mcpExecutable: true, executionReadiness: "requires_route_discovery" })).toBe("adaptive");
  expect(classifyLaunchScenarioAuthority({ executionReadiness: "requires_route_discovery" })).toBe("adaptive");
});

test("payload extraction preserves launch authority fields", () => {
  const [scenario] = extractLaunchScenariosFromPayload({
    selectedScenarios: [{
      ...makeGeneratedScenario("ADAPTIVE-001"),
      mcpExecutable: false,
      executionReadiness: "requires_route_discovery",
      semanticValidity: "valid",
      automationType: "ui_discovery",
    }],
  });
  expect(scenario).toMatchObject({
    mcpExecutable: false,
    executionReadiness: "requires_route_discovery",
    semanticValidity: "valid",
    automationType: "ui_discovery",
  });
});

test("pure nonAutomatable classification is not placed in standard launch", () => {
  expect(classifyLaunchScenarioAuthority({
    mcpExecutable: true,
    launchClassification: "nonAutomatable",
  })).toBe("nonAutomatable");
});

test("agrega created caseId al conjunto final", () => {
  expect(aggregateLaunchCaseIds([], [{ caseId: 123 }])).toEqual([123]);
});

test("agrega recovery caseId cuando add_case falla", () => {
  expect(aggregateLaunchCaseIds([], [{ testRailCaseId: 456 }])).toEqual([456]);
});

test("combina existing y recovered caseIds", () => {
  expect(aggregateLaunchCaseIds([100], [{ caseId: 456 }])).toEqual([100, 456]);
});

test("deduplica caseIds repetidos", () => {
  expect(aggregateLaunchCaseIds([456], [{ caseId: 456 }, { id: 456 }])).toEqual([456]);
});

test("ignora caseIds undefined, NaN e inválidos", () => {
  expect(aggregateLaunchCaseIds([undefined, Number.NaN, 0, -1], [{ caseId: undefined }])).toEqual([]);
});

test("mantiene publish_failed cuando no existen caseIds válidos", () => {
  expect(aggregateLaunchCaseIds([], [])).toEqual([]);
});

test("route discovery publication enters the canonical published mapping", () => {
  const routeDiscoveryPublishedCases = [
    {
      scenarioId: "route-custom-1",
      caseId: 701,
      title: "Route scenario",
      sourceType: "jira_preview" as const,
      launchScenarioId: "launch-route-1",
      executionScenarioId: "PREVIEW-001",
      testrailCustomScenarioId: "route-custom-1",
      sourceIssueKey: "ISSUE-1",
    },
  ];
  const result = buildCanonicalPublishedCases([
    { source: "route_discovery_publication", entries: routeDiscoveryPublishedCases },
  ]);

  expect(result.publishedCases).toEqual(routeDiscoveryPublishedCases);
  expect(result.excluded).toEqual([]);
});

test("route discovery alone keeps final totals and scenario mapping non-zero", () => {
  const { publishedCases } = buildCanonicalPublishedCases([
    { source: "standard_publication", entries: [] },
    { source: "route_discovery_publication", entries: [
      { scenarioId: "route-1", executionScenarioId: "PREVIEW-001", caseId: 702, title: "Route" },
    ] },
  ]);
  const scenarioToCaseMap = new Map(publishedCases.flatMap((entry) => [
    [entry.scenarioId, entry.caseId] as const,
    ...(entry.executionScenarioId ? [[entry.executionScenarioId, entry.caseId] as const] : []),
  ]));

  expect(publishedCases).toHaveLength(1);
  expect(scenarioToCaseMap.size).toBeGreaterThan(0);
});

test("manifest and child metadata consume the same canonical mapping", () => {
  const canonical = buildCanonicalPublishedCases([
    { source: "route_discovery_publication", entries: [
      { scenarioId: "route-2", executionScenarioId: "PREVIEW-002", caseId: 703, title: "Route" },
    ] },
  ]).publishedCases;
  const manifest = { publishedCases: canonical };
  const childMetadata = { publishedCases: canonical };

  expect(manifest.publishedCases).toBe(childMetadata.publishedCases);
  expect(manifest.publishedCases).toEqual(canonical);
});

test("canonical mapping deduplicates duplicate caseIds across sources", () => {
  const result = buildCanonicalPublishedCases([
    { source: "standard_publication", entries: [
      { scenarioId: "custom-1", caseId: 704, title: "Standard", testrailCustomScenarioId: "custom-1" },
    ] },
    { source: "route_discovery_publication", entries: [
      { scenarioId: "custom-1", caseId: 704, title: "Route duplicate", executionScenarioId: "PREVIEW-003" },
    ] },
  ]);

  expect(result.publishedCases).toHaveLength(1);
  expect(result.publishedCases[0]).toMatchObject({ caseId: 704, executionScenarioId: "PREVIEW-003" });
});

test("canonical mapping excludes published items without sufficient identity", () => {
  const result = buildCanonicalPublishedCases([
    { source: "route_discovery_publication", entries: [{ caseId: 705, title: "Missing identity" }] },
  ]);

  expect(result.publishedCases).toEqual([]);
  expect(result.excluded).toEqual([
    { source: "route_discovery_publication", index: 0, reason: "missing_mapping_identity" },
  ]);
});

test("empty launch remains non-launchable without external publication", async () => {
  const result = await launchExecution({
    appSlug: "generic-app",
    projectId: 1,
    sectionId: 1,
    selectedScenarios: [],
  });

  expect(result).toMatchObject({ ok: false, error: "no_launchable_scenarios" });
});

test("E1 existing case with verified promoted spec is accepted for direct reuse", () => {
  const entry = makeAutomationEntry({ id: "automation-one", caseId: 801 });
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [801],
    appSlug: "project",
    entries: [entry],
    validateSpec: () => ({ reusable: true, reason: "promoted_spec_valid", specPath: entry.specPath }),
  });

  expect(plan.launchAccepted).toBe(true);
  expect(plan.existingSpec).toMatchObject([{ caseId: 801, executionSource: "existing_spec", mcpRequired: false }]);
  expect(plan.mcpRequired).toEqual([]);
});

test("E2 existing identity without reusable spec is accepted for MCP preparation", () => {
  const entry = makeAutomationEntry({ id: "automation-two", caseId: 802 });
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [802],
    appSlug: "project",
    entries: [entry],
    validateSpec: () => ({ reusable: false, reason: "missing_spec_file" }),
  });

  expect(plan.launchAccepted).toBe(true);
  expect(plan.mcpRequired).toMatchObject([{ caseId: 802, executionSource: "mcp_required", reasonCode: "missing_spec_file" }]);
});

test("E3 existing cases preserve mixed existing-spec and MCP-required routes", () => {
  const reusable = makeAutomationEntry({ id: "automation-three", caseId: 803 });
  const missingSpec = makeAutomationEntry({ id: "automation-four", caseId: 804 });
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [803, 804],
    appSlug: "project",
    entries: [reusable, missingSpec],
    validateSpec: (entry) => entry.caseId === 803
      ? { reusable: true, reason: "promoted_spec_valid", specPath: entry.specPath }
      : { reusable: false, reason: "missing_spec_file" },
  });

  expect(plan.existingSpec.map((unit) => unit.caseId)).toEqual([803]);
  expect(plan.mcpRequired.map((unit) => unit.caseId)).toEqual([804]);
  expect(plan.blocked).toEqual([]);
});

test("E4 case without persisted mapping is blocked without invented identity", () => {
  const plan = resolveExistingCaseExecutionPlan({ caseIds: [805], appSlug: "project", entries: [] });

  expect(plan.launchAccepted).toBe(false);
  expect(plan.blocked).toEqual([{ caseId: 805, executionSource: "blocked", reasonCode: "automation_mapping_not_found", mcpRequired: false }]);
  expect(plan.blocked[0].scenarioId).toBeUndefined();
});

test("E6 spec owned by another app is not reusable", () => {
  const entry = makeAutomationEntry({ id: "automation-six", caseId: 806, appSlug: "another-project", appProfile: "another-project" });
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [806],
    appSlug: "project",
    entries: [entry],
    validateSpec: () => ({ reusable: true, reason: "promoted_spec_valid", specPath: entry.specPath }),
  });

  expect(plan.existingSpec).toEqual([]);
  expect(plan.blocked).toMatchObject([{ caseId: 806, reasonCode: "app_ownership_mismatch" }]);
});

test("E7 non-promoted spec falls back to MCP when identity and ownership are valid", () => {
  const entry = makeAutomationEntry({ id: "automation-seven", caseId: 807, pomStatus: "needs_page_method" });
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [807],
    appSlug: "project",
    entries: [entry],
    validateSpec: () => ({ reusable: false, reason: "blocked_status_needs_page_method" }),
  });

  expect(plan.existingSpec).toEqual([]);
  expect(plan.mcpRequired).toMatchObject([{ caseId: 807, executionSource: "mcp_required", reasonCode: "pom_not_promoted" }]);
});

test("E8 blocked_missing_pom is reparable and enters MCP discovery", () => {
  const entry = makeAutomationEntry({ id: "automation-eight", caseId: 808, status: "blocked_missing_pom", pomStatus: "needs_page_object" });
  const validation = validatePromotedEntryForExecution({ caseId: 808, appSlug: "project", entry });
  const plan = resolveExistingCaseExecutionPlan({
    caseIds: [808],
    appSlug: "project",
    entries: [entry],
    validateSpec: () => validation,
  });

  expect(validation).toMatchObject({ reusable: false, blocked: false, reason: "status_blocked_missing_pom" });
  expect(plan.blocked).toEqual([]);
  expect(plan.mcpRequired).toMatchObject([{ caseId: 808, executionSource: "mcp_required", mcpRequired: true }]);
});

test("E9 a repaired automation switches from MCP-required to existing-spec reuse", () => {
  const entry = makeAutomationEntry({ id: "automation-nine", caseId: 809, status: "blocked_missing_pom", pomStatus: "needs_page_object" });
  const incomplete = resolveExistingCaseExecutionPlan({
    caseIds: [809],
    appSlug: "project",
    entries: [entry],
    validateSpec: () => ({ reusable: false, blocked: false, reason: "status_blocked_missing_pom" }),
  });
  const promoted = resolveExistingCaseExecutionPlan({
    caseIds: [809],
    appSlug: "project",
    entries: [{ ...entry, status: "active", pomStatus: "promoted", specVerificationStatus: "passed" }],
    validateSpec: () => ({ reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: entry.specPath }),
  });

  expect(incomplete.mcpRequired).toMatchObject([{ caseId: 809, executionSource: "mcp_required" }]);
  expect(promoted.existingSpec).toMatchObject([{ caseId: 809, executionSource: "existing_spec" }]);
  expect(promoted.mcpRequired).toEqual([]);
});
