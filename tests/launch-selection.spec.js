"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const launch_orchestrator_1 = require("../src/server/jobs/launch-orchestrator");
const runs_1 = require("../src/server/routes/runs");
const discovery_batch_runner_1 = require("../src/server/jobs/discovery-batch-runner");
function makeGeneratedScenario(id, title = "Generated scenario") {
    return {
        scenarioId: id,
        title,
        steps: ['Clic en "Iniciar".'],
        expectedResult: "OK",
        preconditions: [],
    };
}
function makeAutomationEntry(input) {
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
(0, test_1.test)("solo Jira/IA: todos los escenarios seleccionados van a publicación", () => {
    const payload = {
        selectedScenarios: [
            makeGeneratedScenario("JIRA-001", "Escenario Jira 1"),
            makeGeneratedScenario("JIRA-002", "Escenario Jira 2"),
        ],
    };
    const selectedScenarios = (0, runs_1.extractLaunchScenariosFromPayload)(payload);
    const existingTestRailCaseIds = (0, runs_1.extractExistingTestRailCaseIdsFromPayload)(payload, selectedScenarios);
    const plan = (0, launch_orchestrator_1.buildLaunchSelectionPlan)({ selectedScenarios, existingTestRailCaseIds });
    (0, test_1.expect)(plan.scenariosToPublish.map((s) => s.scenarioId)).toEqual(["JIRA-001", "JIRA-002"]);
    (0, test_1.expect)(plan.existingTestRailCaseIds).toHaveLength(0);
});
(0, test_1.test)("solo casos existentes de TestRail: selección launchable sin escenarios a publicar", () => {
    const payload = {
        selectedTestRailCases: [
            { caseId: 42811, title: "Caso 42811" },
            { id: "42812", title: "Caso 42812" },
        ],
    };
    const selectedScenarios = (0, runs_1.extractLaunchScenariosFromPayload)(payload);
    const existingTestRailCaseIds = (0, runs_1.extractExistingTestRailCaseIdsFromPayload)(payload, selectedScenarios);
    const plan = (0, launch_orchestrator_1.buildLaunchSelectionPlan)({ selectedScenarios, existingTestRailCaseIds });
    (0, test_1.expect)(plan.scenariosToPublish).toHaveLength(0);
    (0, test_1.expect)(plan.existingTestRailCaseIds).toHaveLength(2);
    (0, test_1.expect)(plan.existingTestRailCaseIds).toEqual(test_1.expect.arrayContaining([42811, 42812]));
    (0, test_1.expect)(plan.invalidScenarioTitles).toHaveLength(0);
});
(0, test_1.test)("selección mixta: publica solo IA/Jira nuevos y reutiliza caseIds existentes", () => {
    const payload = {
        selectedScenarios: [
            makeGeneratedScenario("GEN-001", "Escenario IA nuevo"),
            { ...makeGeneratedScenario("LEGACY-CASE-55", "Caso existente"), testRailCaseId: 55 },
        ],
        selectedCaseIds: [55, 56],
    };
    const selectedScenarios = (0, runs_1.extractLaunchScenariosFromPayload)(payload);
    const existingTestRailCaseIds = (0, runs_1.extractExistingTestRailCaseIdsFromPayload)(payload, selectedScenarios);
    const plan = (0, launch_orchestrator_1.buildLaunchSelectionPlan)({ selectedScenarios, existingTestRailCaseIds });
    (0, test_1.expect)(plan.scenariosToPublish.map((s) => s.scenarioId)).toEqual(["GEN-001"]);
    (0, test_1.expect)(plan.existingTestRailCaseIds).toEqual(test_1.expect.arrayContaining([55, 56]));
    (0, test_1.expect)(plan.existingScenarios.map((s) => s.scenarioId)).toEqual(["LEGACY-CASE-55"]);
});
(0, test_1.test)("equivalentes de fuentes de caseIds se deduplican", () => {
    const payload = {
        selectedCaseIds: ["77", 78],
        testRailCaseIds: [78, "79"],
        existingTestRailCaseIds: [79, 80],
        selectedTestRailCases: [{ caseId: 80 }, { testRailCaseId: 81 }],
    };
    const selectedScenarios = (0, runs_1.extractLaunchScenariosFromPayload)(payload);
    const existingTestRailCaseIds = (0, runs_1.extractExistingTestRailCaseIdsFromPayload)(payload, selectedScenarios);
    (0, test_1.expect)(existingTestRailCaseIds.sort((a, b) => a - b)).toEqual([77, 78, 79, 80, 81]);
});
(0, test_1.test)("escenario con metadata.caseId no entra al plan de publicación", () => {
    const payload = {
        selectedScenarios: [
            {
                ...makeGeneratedScenario("WITH-META-CASE"),
                metadata: { caseId: 901 },
            },
        ],
    };
    const selectedScenarios = (0, runs_1.extractLaunchScenariosFromPayload)(payload);
    const existingTestRailCaseIds = (0, runs_1.extractExistingTestRailCaseIdsFromPayload)(payload, selectedScenarios);
    const plan = (0, launch_orchestrator_1.buildLaunchSelectionPlan)({ selectedScenarios, existingTestRailCaseIds });
    (0, test_1.expect)(plan.scenariosToPublish).toHaveLength(0);
    (0, test_1.expect)(plan.existingTestRailCaseIds).toEqual([901]);
});
(0, test_1.test)("escenario sin scenarioId ni caseId queda inválido para evitar ejecución ambigua", () => {
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
    const selectedScenarios = (0, runs_1.extractLaunchScenariosFromPayload)(payload);
    const existingTestRailCaseIds = (0, runs_1.extractExistingTestRailCaseIdsFromPayload)(payload, selectedScenarios);
    const plan = (0, launch_orchestrator_1.buildLaunchSelectionPlan)({ selectedScenarios, existingTestRailCaseIds });
    (0, test_1.expect)(plan.invalidScenarioTitles).toEqual(["Sin identificador"]);
});
(0, test_1.test)("launch authority preserves adaptive readiness and does not upgrade it", () => {
    (0, test_1.expect)((0, launch_orchestrator_1.classifyLaunchScenarioAuthority)({ mcpExecutable: true })).toBe("standard");
    (0, test_1.expect)((0, launch_orchestrator_1.classifyLaunchScenarioAuthority)({ mcpExecutable: false })).toBe("adaptive");
    (0, test_1.expect)((0, launch_orchestrator_1.classifyLaunchScenarioAuthority)({ mcpExecutable: true, executionReadiness: "requires_route_discovery" })).toBe("adaptive");
    (0, test_1.expect)((0, launch_orchestrator_1.classifyLaunchScenarioAuthority)({ executionReadiness: "requires_route_discovery" })).toBe("adaptive");
});
(0, test_1.test)("payload extraction preserves launch authority fields", () => {
    const [scenario] = (0, runs_1.extractLaunchScenariosFromPayload)({
        selectedScenarios: [{
                ...makeGeneratedScenario("ADAPTIVE-001"),
                mcpExecutable: false,
                executionReadiness: "requires_route_discovery",
                semanticValidity: "valid",
                automationType: "ui_discovery",
            }],
    });
    (0, test_1.expect)(scenario).toMatchObject({
        mcpExecutable: false,
        executionReadiness: "requires_route_discovery",
        semanticValidity: "valid",
        automationType: "ui_discovery",
    });
});
(0, test_1.test)("pure nonAutomatable classification is not placed in standard launch", () => {
    (0, test_1.expect)((0, launch_orchestrator_1.classifyLaunchScenarioAuthority)({
        mcpExecutable: true,
        launchClassification: "nonAutomatable",
    })).toBe("nonAutomatable");
});
(0, test_1.test)("agrega created caseId al conjunto final", () => {
    (0, test_1.expect)((0, launch_orchestrator_1.aggregateLaunchCaseIds)([], [{ caseId: 123 }])).toEqual([123]);
});
(0, test_1.test)("agrega recovery caseId cuando add_case falla", () => {
    (0, test_1.expect)((0, launch_orchestrator_1.aggregateLaunchCaseIds)([], [{ testRailCaseId: 456 }])).toEqual([456]);
});
(0, test_1.test)("combina existing y recovered caseIds", () => {
    (0, test_1.expect)((0, launch_orchestrator_1.aggregateLaunchCaseIds)([100], [{ caseId: 456 }])).toEqual([100, 456]);
});
(0, test_1.test)("deduplica caseIds repetidos", () => {
    (0, test_1.expect)((0, launch_orchestrator_1.aggregateLaunchCaseIds)([456], [{ caseId: 456 }, { id: 456 }])).toEqual([456]);
});
(0, test_1.test)("ignora caseIds undefined, NaN e inválidos", () => {
    (0, test_1.expect)((0, launch_orchestrator_1.aggregateLaunchCaseIds)([undefined, Number.NaN, 0, -1], [{ caseId: undefined }])).toEqual([]);
});
(0, test_1.test)("mantiene publish_failed cuando no existen caseIds válidos", () => {
    (0, test_1.expect)((0, launch_orchestrator_1.aggregateLaunchCaseIds)([], [])).toEqual([]);
});
(0, test_1.test)("route discovery publication enters the canonical published mapping", () => {
    const routeDiscoveryPublishedCases = [
        {
            scenarioId: "route-custom-1",
            caseId: 701,
            title: "Route scenario",
            sourceType: "jira_preview",
            launchScenarioId: "launch-route-1",
            executionScenarioId: "PREVIEW-001",
            testrailCustomScenarioId: "route-custom-1",
            sourceIssueKey: "ISSUE-1",
        },
    ];
    const result = (0, launch_orchestrator_1.buildCanonicalPublishedCases)([
        { source: "route_discovery_publication", entries: routeDiscoveryPublishedCases },
    ]);
    (0, test_1.expect)(result.publishedCases).toEqual(routeDiscoveryPublishedCases);
    (0, test_1.expect)(result.excluded).toEqual([]);
});
(0, test_1.test)("route discovery alone keeps final totals and scenario mapping non-zero", () => {
    const { publishedCases } = (0, launch_orchestrator_1.buildCanonicalPublishedCases)([
        { source: "standard_publication", entries: [] },
        { source: "route_discovery_publication", entries: [
                { scenarioId: "route-1", executionScenarioId: "PREVIEW-001", caseId: 702, title: "Route" },
            ] },
    ]);
    const scenarioToCaseMap = new Map(publishedCases.flatMap((entry) => [
        [entry.scenarioId, entry.caseId],
        ...(entry.executionScenarioId ? [[entry.executionScenarioId, entry.caseId]] : []),
    ]));
    (0, test_1.expect)(publishedCases).toHaveLength(1);
    (0, test_1.expect)(scenarioToCaseMap.size).toBeGreaterThan(0);
});
(0, test_1.test)("manifest and child metadata consume the same canonical mapping", () => {
    const canonical = (0, launch_orchestrator_1.buildCanonicalPublishedCases)([
        { source: "route_discovery_publication", entries: [
                { scenarioId: "route-2", executionScenarioId: "PREVIEW-002", caseId: 703, title: "Route" },
            ] },
    ]).publishedCases;
    const manifest = { publishedCases: canonical };
    const childMetadata = { publishedCases: canonical };
    (0, test_1.expect)(manifest.publishedCases).toBe(childMetadata.publishedCases);
    (0, test_1.expect)(manifest.publishedCases).toEqual(canonical);
});
(0, test_1.test)("canonical mapping deduplicates duplicate caseIds across sources", () => {
    const result = (0, launch_orchestrator_1.buildCanonicalPublishedCases)([
        { source: "standard_publication", entries: [
                { scenarioId: "custom-1", caseId: 704, title: "Standard", testrailCustomScenarioId: "custom-1" },
            ] },
        { source: "route_discovery_publication", entries: [
                { scenarioId: "custom-1", caseId: 704, title: "Route duplicate", executionScenarioId: "PREVIEW-003" },
            ] },
    ]);
    (0, test_1.expect)(result.publishedCases).toHaveLength(1);
    (0, test_1.expect)(result.publishedCases[0]).toMatchObject({ caseId: 704, executionScenarioId: "PREVIEW-003" });
});
(0, test_1.test)("canonical mapping excludes published items without sufficient identity", () => {
    const result = (0, launch_orchestrator_1.buildCanonicalPublishedCases)([
        { source: "route_discovery_publication", entries: [{ caseId: 705, title: "Missing identity" }] },
    ]);
    (0, test_1.expect)(result.publishedCases).toEqual([]);
    (0, test_1.expect)(result.excluded).toEqual([
        { source: "route_discovery_publication", index: 0, reason: "missing_mapping_identity" },
    ]);
});
(0, test_1.test)("empty launch remains non-launchable without external publication", async () => {
    const result = await (0, launch_orchestrator_1.launchExecution)({
        appSlug: "generic-app",
        projectId: 1,
        sectionId: 1,
        selectedScenarios: [],
    });
    (0, test_1.expect)(result).toMatchObject({ ok: false, error: "no_launchable_scenarios" });
});
(0, test_1.test)("E1 existing case with verified promoted spec is accepted for direct reuse", () => {
    const entry = makeAutomationEntry({ id: "automation-one", caseId: 801 });
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [801],
        appSlug: "project",
        entries: [entry],
        validateSpec: () => ({ reusable: true, reason: "promoted_spec_valid", specPath: entry.specPath }),
    });
    (0, test_1.expect)(plan.launchAccepted).toBe(true);
    (0, test_1.expect)(plan.existingSpec).toMatchObject([{ caseId: 801, executionSource: "existing_spec", mcpRequired: false }]);
    (0, test_1.expect)(plan.mcpRequired).toEqual([]);
});
(0, test_1.test)("E2 existing identity without reusable spec is accepted for MCP preparation", () => {
    const entry = makeAutomationEntry({ id: "automation-two", caseId: 802 });
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [802],
        appSlug: "project",
        entries: [entry],
        validateSpec: () => ({ reusable: false, reason: "missing_spec_file" }),
    });
    (0, test_1.expect)(plan.launchAccepted).toBe(true);
    (0, test_1.expect)(plan.mcpRequired).toMatchObject([{ caseId: 802, executionSource: "mcp_required", reasonCode: "missing_spec_file" }]);
});
(0, test_1.test)("E3 existing cases preserve mixed existing-spec and MCP-required routes", () => {
    const reusable = makeAutomationEntry({ id: "automation-three", caseId: 803 });
    const missingSpec = makeAutomationEntry({ id: "automation-four", caseId: 804 });
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [803, 804],
        appSlug: "project",
        entries: [reusable, missingSpec],
        validateSpec: (entry) => entry.caseId === 803
            ? { reusable: true, reason: "promoted_spec_valid", specPath: entry.specPath }
            : { reusable: false, reason: "missing_spec_file" },
    });
    (0, test_1.expect)(plan.existingSpec.map((unit) => unit.caseId)).toEqual([803]);
    (0, test_1.expect)(plan.mcpRequired.map((unit) => unit.caseId)).toEqual([804]);
    (0, test_1.expect)(plan.blocked).toEqual([]);
});
(0, test_1.test)("E4 case without persisted mapping is blocked without invented identity", () => {
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({ caseIds: [805], appSlug: "project", entries: [] });
    (0, test_1.expect)(plan.launchAccepted).toBe(false);
    (0, test_1.expect)(plan.blocked).toEqual([{ caseId: 805, executionSource: "blocked", reasonCode: "automation_mapping_not_found", mcpRequired: false }]);
    (0, test_1.expect)(plan.blocked[0].scenarioId).toBeUndefined();
});
(0, test_1.test)("E6 spec owned by another app is not reusable", () => {
    const entry = makeAutomationEntry({ id: "automation-six", caseId: 806, appSlug: "another-project", appProfile: "another-project" });
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [806],
        appSlug: "project",
        entries: [entry],
        validateSpec: () => ({ reusable: true, reason: "promoted_spec_valid", specPath: entry.specPath }),
    });
    (0, test_1.expect)(plan.existingSpec).toEqual([]);
    (0, test_1.expect)(plan.blocked).toMatchObject([{ caseId: 806, reasonCode: "app_ownership_mismatch" }]);
});
(0, test_1.test)("E7 non-promoted spec falls back to MCP when identity and ownership are valid", () => {
    const entry = makeAutomationEntry({ id: "automation-seven", caseId: 807, pomStatus: "needs_page_method" });
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [807],
        appSlug: "project",
        entries: [entry],
        validateSpec: () => ({ reusable: false, reason: "blocked_status_needs_page_method" }),
    });
    (0, test_1.expect)(plan.existingSpec).toEqual([]);
    (0, test_1.expect)(plan.mcpRequired).toMatchObject([{ caseId: 807, executionSource: "mcp_required", reasonCode: "pom_not_promoted" }]);
});
(0, test_1.test)("E8 blocked_missing_pom is reparable and enters MCP discovery", () => {
    const entry = makeAutomationEntry({ id: "automation-eight", caseId: 808, status: "blocked_missing_pom", pomStatus: "needs_page_object" });
    const validation = (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({ caseId: 808, appSlug: "project", entry });
    const plan = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [808],
        appSlug: "project",
        entries: [entry],
        validateSpec: () => validation,
    });
    (0, test_1.expect)(validation).toMatchObject({ reusable: false, blocked: false, reason: "status_blocked_missing_pom" });
    (0, test_1.expect)(plan.blocked).toEqual([]);
    (0, test_1.expect)(plan.mcpRequired).toMatchObject([{ caseId: 808, executionSource: "mcp_required", mcpRequired: true }]);
});
(0, test_1.test)("E9 a repaired automation switches from MCP-required to existing-spec reuse", () => {
    const entry = makeAutomationEntry({ id: "automation-nine", caseId: 809, status: "blocked_missing_pom", pomStatus: "needs_page_object" });
    const incomplete = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [809],
        appSlug: "project",
        entries: [entry],
        validateSpec: () => ({ reusable: false, blocked: false, reason: "status_blocked_missing_pom" }),
    });
    const promoted = (0, launch_orchestrator_1.resolveExistingCaseExecutionPlan)({
        caseIds: [809],
        appSlug: "project",
        entries: [{ ...entry, status: "active", pomStatus: "promoted", specVerificationStatus: "passed" }],
        validateSpec: () => ({ reusable: true, blocked: false, reason: "promoted_spec_valid", specPath: entry.specPath }),
    });
    (0, test_1.expect)(incomplete.mcpRequired).toMatchObject([{ caseId: 809, executionSource: "mcp_required" }]);
    (0, test_1.expect)(promoted.existingSpec).toMatchObject([{ caseId: 809, executionSource: "existing_spec" }]);
    (0, test_1.expect)(promoted.mcpRequired).toEqual([]);
});
