"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRediscoveryCreateHandoffLine = buildRediscoveryCreateHandoffLine;
exports.buildDiscoveryBatchParamsFromLaunch = buildDiscoveryBatchParamsFromLaunch;
exports.classifyLaunchScenarioAuthority = classifyLaunchScenarioAuthority;
exports.classifyRouteDiscoveryEligibility = classifyRouteDiscoveryEligibility;
exports.partitionLaunchScenarios = partitionLaunchScenarios;
exports.extractLaunchScenarioCaseId = extractLaunchScenarioCaseId;
exports.aggregateLaunchCaseIds = aggregateLaunchCaseIds;
exports.buildCanonicalPublishedCases = buildCanonicalPublishedCases;
exports.resolveExistingCaseExecutionPlan = resolveExistingCaseExecutionPlan;
exports.buildLaunchSelectionPlan = buildLaunchSelectionPlan;
exports.launchExecution = launchExecution;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const automation_index_1 = require("../../automations/automation-index");
const app_profile_1 = require("../../automations/app-profile");
const env_1 = require("../../config/env");
const testrail_client_1 = require("../../clients/testrail.client");
const testrail_case_publisher_1 = require("../services/testrail-case-publisher");
const testrail_sync_types_1 = require("../services/testrail-sync-types");
const defect_checklist_store_1 = require("../services/defect-checklist-store");
const job_store_1 = require("./job-store");
const discovery_batch_runner_1 = require("./discovery-batch-runner");
const case_contract_evaluator_1 = require("../../automations/case-contract-evaluator");
const testrail_normalizer_1 = require("../../testrail/testrail-normalizer");
const ROOT = path_1.default.resolve(__dirname, "..", "..", "..");
const LAUNCH_ARTIFACTS_DIR = path_1.default.join(ROOT, ".artifacts", "scenario-launch-runs");
function buildRediscoveryCreateHandoffLine(input) {
    const describe = (prefix, present, value) => `${prefix}Present=${present} ${prefix}Value=${value === undefined ? "undefined" : String(value)} ${prefix}Type=${value === undefined ? "undefined" : typeof value}`;
    return [
        "[rediscovery-provenance] boundary=create_handoff producer=launch_execution",
        `launchId=${input.launchId}`,
        `jobId=${input.jobId}`,
        describe("pre", input.prePresent, input.preValue),
        describe("stored", input.storedPresent, input.storedValue),
    ].join(" ");
}
function buildDiscoveryBatchParamsFromLaunch(input) {
    const launchRecord = input.launch;
    const params = {
        caseIds: input.executionCaseIds,
        appSlug: input.launch.appSlug,
        sectionSlug: input.launch.sectionSlug,
        sectionName: input.launch.sectionName,
        executePromotedSpecs: true,
        ...(input.launch.projectId !== undefined ? { testRailProjectId: input.launch.projectId } : {}),
        ...(input.launch.suiteId !== undefined ? { testRailSuiteId: input.launch.suiteId } : {}),
        ...((input.launch.testrailSectionId ?? input.launch.sectionId) !== undefined
            ? { testRailSectionId: Number(input.launch.testrailSectionId ?? input.launch.sectionId) }
            : {}),
        overwrite: input.launch.overwrite === true,
        rerunActive: false,
        launchId: input.launchId,
        testRunId: input.testRunId,
        jiraKey: input.launch.jiraKey,
        publishedCases: input.publishedCases,
        ...(input.launch.contextOnly === true ? { contextOnly: true } : {}),
        ...(input.launch.runtimeEntriesByCase ? { runtimeEntriesByCase: input.launch.runtimeEntriesByCase } : {}),
        ...(input.routeProfile ? { routeProfile: input.routeProfile } : {}),
    };
    // Preserve explicit presence semantics: absent stays absent, false stays false,
    // and only true can authorize Full Discovery downstream.
    if (Object.prototype.hasOwnProperty.call(launchRecord, "forceRediscovery")) {
        params.forceRediscovery = input.launch.forceRediscovery === true;
    }
    return params;
}
function classifyLaunchScenarioAuthority(scenario) {
    if (scenario.launchClassification === "nonAutomatable")
        return "nonAutomatable";
    return scenario.mcpExecutable !== true || scenario.executionReadiness === "requires_route_discovery"
        ? "adaptive"
        : "standard";
}
function classifyRouteDiscoveryEligibility(scenario) {
    if (scenario.launchClassification === "nonAutomatable" || scenario.nonAutomatable === true) {
        return { allowed: false, reasonCode: "non_automatable" };
    }
    if (scenario.executionReadiness !== "requires_route_discovery") {
        return { allowed: false, reasonCode: "readiness_not_requires_route_discovery" };
    }
    if (scenario.validation?.valid === false || !["valid", "validated"].includes(scenario.semanticValidity ?? "")) {
        return { allowed: false, reasonCode: "semantic_scenario_invalid" };
    }
    const hasStructuredLineage = Boolean(scenario.branchId
        || scenario.functionalBranch?.branchId
        || scenario.branchAssociation?.branchId
        || (scenario.requirementDependencies?.length ?? 0) > 0
        || (scenario.stepRequirementRefs?.length ?? 0) > 0);
    if (!hasStructuredLineage)
        return { allowed: false, reasonCode: "missing_structured_lineage" };
    return { allowed: true, reasonCode: "requires_route_discovery" };
}
function hasCompleteStructuredAdaptiveMetadata(scenario) {
    const branchId = [scenario.branchId, scenario.functionalBranch?.branchId, scenario.branchAssociation?.branchId]
        .find((value) => Boolean(value && value !== "none"));
    const requirementRefs = Array.isArray(scenario.stepRequirementRefs) ? scenario.stepRequirementRefs : [];
    return Boolean(branchId && scenario.functionalBranch && requirementRefs.length > 0);
}
function partitionLaunchScenarios(scenarios) {
    const routeDiscovery = [];
    const standard = [];
    const adaptiveFunctional = [];
    const nonAutomatable = [];
    for (const scenario of scenarios) {
        if (classifyRouteDiscoveryEligibility(scenario).allowed)
            routeDiscovery.push(scenario);
        else if (classifyLaunchScenarioAuthority(scenario) === "nonAutomatable")
            nonAutomatable.push(scenario);
        else if (classifyLaunchScenarioAuthority(scenario) === "standard")
            standard.push(scenario);
        else
            adaptiveFunctional.push(scenario);
    }
    return { standard, adaptiveFunctional, routeDiscovery, nonAutomatable };
}
function buildLaunchRunName(jiraKey, sprintName) {
    const parts = [];
    if (jiraKey)
        parts.push(jiraKey);
    if (sprintName)
        parts.push(sprintName);
    parts.push("QA Lab Automation Run");
    parts.push(new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
    return parts.join(" - ");
}
function scenarioToMcpFormat(scenario, index, appSlug) {
    return {
        sourceIssueKey: scenario.sourceIssueKey ?? `launch-${index + 1}`,
        title: scenario.title,
        steps: scenario.steps,
        preconditions: scenario.preconditions ?? [],
        expectedResult: scenario.expectedResult ?? "",
        type: "Functional",
        database: "QA",
        isConverted: 0,
        automationType: scenario.automationType ?? "ui_with_auth_gate",
        setupStrategy: "auth_gate",
        appSlug,
        routeProfile: scenario.routeProfile?.name ?? "",
        dataRequirements: "",
        nonExecutableCriteria: "",
        mcpExecutable: scenario.mcpExecutable ?? false,
        executionReadiness: scenario.executionReadiness,
        semanticValidity: scenario.semanticValidity,
        launchClassification: scenario.launchClassification,
        publicationClassification: scenario.publicationClassification === "executable"
            || scenario.publicationClassification === "documentation"
            || scenario.publicationClassification === "blocked"
            ? scenario.publicationClassification
            : undefined,
        launchScenarioId: scenario.scenarioId, // Pass through for unique TestRail ID generation
    };
}
function toPositiveCaseId(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!/^\d+$/.test(trimmed))
            return undefined;
        const parsed = Number(trimmed);
        if (Number.isInteger(parsed) && parsed > 0)
            return parsed;
    }
    return undefined;
}
function extractLaunchScenarioCaseId(scenario) {
    const asAny = scenario;
    const metadata = (asAny.metadata && typeof asAny.metadata === "object") ? asAny.metadata : undefined;
    const candidates = [
        scenario.testRailCaseId,
        asAny.testRailCaseId,
        asAny.caseId,
        metadata?.testRailCaseId,
        metadata?.caseId,
    ];
    for (const value of candidates) {
        const parsed = toPositiveCaseId(value);
        if (parsed)
            return parsed;
    }
    return undefined;
}
function extractPublishedCaseId(value) {
    if (typeof value === "number" && Number.isInteger(value) && value > 0)
        return value;
    if (typeof value === "string" && /^\d+$/.test(value.trim())) {
        const parsed = Number(value.trim());
        return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
    }
    if (!value || typeof value !== "object")
        return undefined;
    const record = value;
    return extractPublishedCaseId(record.caseId)
        ?? extractPublishedCaseId(record.testRailCaseId)
        ?? extractPublishedCaseId(record.testrailCaseId)
        ?? extractPublishedCaseId(record.id);
}
function aggregateLaunchCaseIds(...sources) {
    const ids = new Set();
    for (const source of sources) {
        for (const value of source ?? []) {
            const caseId = extractPublishedCaseId(value);
            if (caseId !== undefined)
                ids.add(caseId);
        }
    }
    return Array.from(ids);
}
function buildCanonicalPublishedCases(sources) {
    const byCaseId = new Map();
    const excluded = [];
    for (const source of sources) {
        for (let index = 0; index < source.entries.length; index++) {
            const value = source.entries[index];
            const record = value && typeof value === "object" ? value : {};
            const caseId = extractPublishedCaseId(value);
            if (!caseId) {
                excluded.push({ source: source.source, index, reason: "invalid_case_id" });
                continue;
            }
            const readIdentity = (key) => {
                const candidate = record[key];
                return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
            };
            const testrailCustomScenarioId = readIdentity("testrailCustomScenarioId");
            const executionScenarioId = readIdentity("executionScenarioId");
            const launchScenarioId = readIdentity("launchScenarioId");
            const scenarioId = readIdentity("scenarioId")
                ?? testrailCustomScenarioId
                ?? executionScenarioId
                ?? launchScenarioId;
            if (!scenarioId) {
                excluded.push({ source: source.source, index, reason: "missing_mapping_identity" });
                continue;
            }
            const title = readIdentity("title") ?? `TestRail Case ${caseId}`;
            const sourceIssueKey = readIdentity("sourceIssueKey");
            const executionSource = record.executionSource === "existing_spec" || record.executionSource === "mcp_required"
                ? record.executionSource
                : undefined;
            const reasonCode = readIdentity("reasonCode");
            const automationId = readIdentity("automationId");
            const specPath = readIdentity("specPath");
            const appSlug = readIdentity("appSlug");
            const sourceType = record.sourceType === "jira_preview" || record.sourceType === "testrail_case"
                ? record.sourceType
                : undefined;
            const candidate = {
                scenarioId,
                caseId,
                title,
                ...(sourceType ? { sourceType } : {}),
                ...(sourceIssueKey ? { sourceIssueKey } : {}),
                ...(launchScenarioId ? { launchScenarioId } : {}),
                ...(executionScenarioId ? { executionScenarioId } : {}),
                ...(testrailCustomScenarioId ? { testrailCustomScenarioId } : {}),
                ...(executionSource ? { executionSource } : {}),
                ...(reasonCode ? { reasonCode } : {}),
                ...(automationId ? { automationId } : {}),
                ...(specPath ? { specPath } : {}),
                ...(appSlug ? { appSlug } : {}),
            };
            const existing = byCaseId.get(caseId);
            byCaseId.set(caseId, existing ? {
                ...candidate,
                ...existing,
                sourceType: existing.sourceType ?? candidate.sourceType,
                sourceIssueKey: existing.sourceIssueKey ?? candidate.sourceIssueKey,
                launchScenarioId: existing.launchScenarioId ?? candidate.launchScenarioId,
                executionScenarioId: existing.executionScenarioId ?? candidate.executionScenarioId,
                testrailCustomScenarioId: existing.testrailCustomScenarioId ?? candidate.testrailCustomScenarioId,
                executionSource: existing.executionSource ?? candidate.executionSource,
                reasonCode: existing.reasonCode ?? candidate.reasonCode,
                automationId: existing.automationId ?? candidate.automationId,
                specPath: existing.specPath ?? candidate.specPath,
                appSlug: existing.appSlug ?? candidate.appSlug,
            } : candidate);
        }
    }
    return { publishedCases: Array.from(byCaseId.values()), excluded };
}
function normalizeOwnedAppSlug(value) {
    if (!value?.trim())
        return undefined;
    return (0, app_profile_1.normalizeAppSlug)(value);
}
function resolveExistingCaseExecutionPlan(input) {
    const requestedApp = normalizeOwnedAppSlug(input.appSlug);
    const existingSpec = [];
    const mcpRequired = [];
    const blocked = [];
    const caseIds = aggregateLaunchCaseIds(input.caseIds);
    for (const caseId of caseIds) {
        const allCandidates = input.entries.filter((entry) => entry.caseId === caseId && entry.id?.trim());
        if (allCandidates.length === 0) {
            const contract = input.caseContracts?.get(caseId);
            const discoveryAllowed = contract?.recommendedRoute === "targeted_discovery"
                || contract?.recommendedRoute === "full_discovery";
            if (contract?.usable || discoveryAllowed) {
                mcpRequired.push({ caseId, executionSource: "mcp_required", reasonCode: contract.reasonCode, mcpRequired: true });
            }
            else {
                blocked.push({ caseId, executionSource: "blocked", reasonCode: contract?.reasonCode ?? (input.caseContracts ? "case_not_found" : "automation_mapping_not_found"), mcpRequired: false });
            }
            continue;
        }
        const ownedCandidates = allCandidates.filter((entry) => {
            const ownedApp = normalizeOwnedAppSlug(entry.appSlug ?? entry.appProfile);
            return requestedApp !== undefined && ownedApp === requestedApp;
        });
        if (ownedCandidates.length === 0) {
            blocked.push({ caseId, executionSource: "blocked", reasonCode: "app_ownership_mismatch", mcpRequired: false });
            continue;
        }
        const uniqueCandidateMap = new Map();
        for (const entry of ownedCandidates) {
            const identity = `${entry.id.trim()}\u0000${normalizeOwnedAppSlug(entry.appSlug ?? entry.appProfile)}`;
            if (!uniqueCandidateMap.has(identity))
                uniqueCandidateMap.set(identity, entry);
        }
        const uniqueCandidates = Array.from(uniqueCandidateMap.values());
        if (uniqueCandidates.length !== 1) {
            blocked.push({ caseId, executionSource: "blocked", reasonCode: "ambiguous_automation_mapping", mcpRequired: false });
            continue;
        }
        const entry = uniqueCandidates[0];
        const validation = input.validateSpec
            ? input.validateSpec(entry)
            : (0, discovery_batch_runner_1.validatePromotedEntryForExecution)({
                caseId,
                appSlug: input.appSlug,
                sectionSlug: input.sectionSlug,
                entry,
            });
        const promotionValid = entry.status === "active"
            && entry.pomStatus === "promoted"
            && entry.specVerificationStatus === "passed";
        const base = {
            caseId,
            automationId: entry.id,
            scenarioId: entry.id,
            appSlug: normalizeOwnedAppSlug(entry.appSlug ?? entry.appProfile),
            title: entry.title,
        };
        if (validation.reusable && promotionValid && validation.specPath) {
            existingSpec.push({
                ...base,
                executionSource: "existing_spec",
                reasonCode: "promoted_spec_valid",
                mcpRequired: false,
                specPath: validation.specPath,
            });
            continue;
        }
        const reasonCode = !promotionValid
            ? entry.status !== "active"
                ? `status_${entry.status}`
                : entry.pomStatus !== "promoted"
                    ? "pom_not_promoted"
                    : "spec_not_verified"
            : validation.reason;
        mcpRequired.push({
            ...base,
            executionSource: "mcp_required",
            reasonCode,
            mcpRequired: true,
            ...(validation.specPath ? { specPath: validation.specPath } : {}),
        });
    }
    const admitted = [...existingSpec, ...mcpRequired];
    return { existingSpec, mcpRequired, blocked, admitted, launchAccepted: admitted.length > 0 };
}
async function loadExistingCaseAutomationEntries(appSlug) {
    const entries = [];
    const normalizedApp = normalizeOwnedAppSlug(appSlug);
    const indexPaths = [
        ...(normalizedApp ? [path_1.default.join("automations", "apps", normalizedApp, "index.json")] : []),
        path_1.default.join("automations", "index.json"),
    ];
    for (const indexPath of indexPaths) {
        try {
            const index = await (0, automation_index_1.loadAutomationIndex)(indexPath);
            entries.push(...index.automations);
        }
        catch (error) {
            console.error(`[launch-execution] automation index unavailable path=${indexPath} reason=${error?.message ?? String(error)}`);
        }
    }
    return entries;
}
function buildLaunchSelectionPlan(input) {
    const normalizedScenarios = [];
    const invalidScenarioTitles = [];
    const selected = input.selectedScenarios ?? [];
    for (let i = 0; i < selected.length; i++) {
        const scenario = selected[i];
        const resolvedCaseId = extractLaunchScenarioCaseId(scenario);
        const scenarioId = typeof scenario.scenarioId === "string" ? scenario.scenarioId.trim() : "";
        const resolvedScenarioId = scenarioId || (resolvedCaseId ? `TR-CASE-${resolvedCaseId}` : "");
        if (!resolvedScenarioId) {
            invalidScenarioTitles.push(scenario.title || `scenario_index_${i}`);
            continue;
        }
        normalizedScenarios.push({
            ...scenario,
            scenarioId: resolvedScenarioId,
            originalIndex: i,
            resolvedCaseId,
        });
    }
    const existingCaseIdSet = new Set();
    for (const caseId of input.existingTestRailCaseIds ?? []) {
        const parsed = toPositiveCaseId(caseId);
        if (parsed)
            existingCaseIdSet.add(parsed);
    }
    const existingScenarios = [];
    const scenariosToPublish = [];
    for (const scenario of normalizedScenarios) {
        if (scenario.resolvedCaseId) {
            existingCaseIdSet.add(scenario.resolvedCaseId);
            existingScenarios.push(scenario);
            continue;
        }
        scenariosToPublish.push(scenario);
    }
    return {
        normalizedScenarios,
        scenariosToPublish,
        existingScenarios,
        existingTestRailCaseIds: Array.from(existingCaseIdSet),
        invalidScenarioTitles,
    };
}
async function launchExecution(input) {
    // ── 1. Validate payload ──
    console.log(`[launch-execution] validating payload`);
    if (!input.projectId || input.projectId <= 0) {
        return { ok: false, error: "missing_project_id", message: "TestRail projectId is required." };
    }
    if (!input.testrailSectionId && !input.sectionId) {
        return { ok: false, error: "missing_section_id", message: "TestRail sectionId is required." };
    }
    const selectedScenarios = input.selectedScenarios ?? [];
    const scenarioGroups = partitionLaunchScenarios(selectedScenarios);
    const routeDiscoveryScenarios = [...scenarioGroups.routeDiscovery];
    const routeDiscoverySet = new Set(routeDiscoveryScenarios);
    const adaptiveFromSelected = scenarioGroups.adaptiveFunctional;
    const nonAutomatableFromSelected = scenarioGroups.nonAutomatable;
    const adaptiveFromInput = (input.adaptiveScenarios ?? []).filter((scenario) => classifyLaunchScenarioAuthority(scenario) !== "nonAutomatable");
    const adaptiveScenarios = Array.from(new Map([...adaptiveFromInput, ...adaptiveFromSelected]
        .map((scenario, index) => [scenario.scenarioId || `adaptive-${index}`, scenario])).values());
    const executableSelectedScenarios = selectedScenarios.filter((scenario) => !routeDiscoverySet.has(scenario) && !adaptiveFromSelected.includes(scenario) && !nonAutomatableFromSelected.includes(scenario));
    const selectionPlan = buildLaunchSelectionPlan({
        selectedScenarios: executableSelectedScenarios,
        existingTestRailCaseIds: input.existingTestRailCaseIds ?? [],
    });
    if (selectionPlan.invalidScenarioTitles.length > 0) {
        return {
            ok: false,
            error: "missing_scenario_id",
            message: `Scenario "${selectionPlan.invalidScenarioTitles[0]}" has no scenarioId.`,
        };
    }
    const standardCount = selectionPlan.normalizedScenarios.length;
    const existingCaseCount = selectionPlan.existingTestRailCaseIds.length;
    const adaptiveCount = adaptiveScenarios.length;
    let routeDiscoveryCount = routeDiscoveryScenarios.length;
    console.log(`[runs:launch] standard=${standardCount} publishable=${selectionPlan.scenariosToPublish.length} existingCases=${existingCaseCount} adaptive=${adaptiveCount} routeDiscovery=${routeDiscoveryScenarios.length} mode=${adaptiveCount > 0 || routeDiscoveryScenarios.length > 0 ? "automatic_mixed_execution" : "standard"}`);
    // Validate adaptive scenarios have required metadata
    const validAdaptive = [];
    const blockedAdaptive = [];
    for (const sc of adaptiveScenarios) {
        const asAny = sc;
        const hasLegacyMetadata = Boolean(asAny.targetScreen && asAny.actualChain && asAny.requiredChain);
        if (!hasLegacyMetadata && !hasCompleteStructuredAdaptiveMetadata(sc)) {
            blockedAdaptive.push({
                sourceIssueKey: asAny.sourceIssueKey ?? "",
                title: asAny.title ?? "",
                reasonCode: "adaptive_metadata_incomplete",
                reason: `Missing structured adaptive authority: ${!asAny.branchId && !asAny.functionalBranch?.branchId ? "branchId " : ""}${!asAny.stepRequirementRefs?.length ? "stepRequirementRefs " : ""}`,
            });
        }
        else {
            validAdaptive.push(sc);
        }
    }
    if (blockedAdaptive.length > 0) {
        console.log(`[runs:launch] blockedAdaptive count=${blockedAdaptive.length} reason=adaptive_metadata_incomplete`);
    }
    const routeDiscoveryIds = new Set(routeDiscoveryScenarios.map((scenario) => scenario.scenarioId));
    for (const scenario of validAdaptive) {
        if (routeDiscoveryIds.has(scenario.scenarioId))
            continue;
        routeDiscoveryScenarios.push(scenario);
        routeDiscoveryIds.add(scenario.scenarioId);
    }
    routeDiscoveryCount = routeDiscoveryScenarios.length;
    const existingCaseEntries = await loadExistingCaseAutomationEntries(input.appSlug);
    const caseContracts = new Map();
    if (selectionPlan.existingTestRailCaseIds.length > 0) {
        try {
            const trClient = new testrail_client_1.TestRailClient((0, env_1.requireTestRailConfig)(env_1.config));
            for (const caseId of selectionPlan.existingTestRailCaseIds) {
                try {
                    const rawCase = await trClient.getCase(caseId);
                    const normalizedCase = (0, testrail_normalizer_1.normalizeTestRailCase)(rawCase);
                    const metadata = (0, case_contract_evaluator_1.extractCaseContractMetadata)(rawCase);
                    const contract = (0, case_contract_evaluator_1.buildMcpScenarioContractFromTestRailCase)({ scenario: normalizedCase, appSlug: input.appSlug, metadata });
                    const evaluation = (0, case_contract_evaluator_1.evaluateCaseContractSufficiency)({
                        scenario: contract,
                        appSlug: input.appSlug,
                        sectionSlug: input.sectionSlug,
                        metadata,
                        hasRouteProfileConfig: true,
                    });
                    caseContracts.set(caseId, {
                        usable: evaluation.sufficient,
                        reasonCode: evaluation.reasonCode,
                        recommendedRoute: evaluation.recommendedRoute,
                    });
                }
                catch {
                    caseContracts.set(caseId, { usable: false, reasonCode: "case_not_found" });
                }
            }
        }
        catch {
            for (const caseId of selectionPlan.existingTestRailCaseIds) {
                caseContracts.set(caseId, { usable: false, reasonCode: "case_contract_fetch_unavailable" });
            }
        }
    }
    const existingCasePlan = resolveExistingCaseExecutionPlan({
        caseIds: selectionPlan.existingTestRailCaseIds,
        appSlug: input.appSlug,
        sectionSlug: input.sectionSlug,
        entries: existingCaseEntries,
        caseContracts,
    });
    console.log(`[launch-existing-cases] existingSpec=${existingCasePlan.existingSpec.length} mcpRequired=${existingCasePlan.mcpRequired.length} blocked=${existingCasePlan.blocked.length}`);
    for (const blocked of existingCasePlan.blocked) {
        console.error(`[launch-existing-cases] caseId=${blocked.caseId} executionSource=blocked reason=${blocked.reasonCode}`);
    }
    if (selectionPlan.scenariosToPublish.length === 0
        && !existingCasePlan.launchAccepted
        && validAdaptive.length === 0
        && routeDiscoveryScenarios.length === 0) {
        return {
            ok: false,
            error: "no_launchable_scenarios",
            message: "No scenarios remain launchable after authority and adaptive metadata validation.",
            existingCasePlan,
        };
    }
    // Validate unique scenarioIds
    const seenIds = new Set();
    for (const sc of selectionPlan.normalizedScenarios) {
        if (seenIds.has(sc.scenarioId)) {
            return { ok: false, error: "duplicate_scenario_ids", message: `Duplicate scenarioId: "${sc.scenarioId}". Each scenario must have a unique execution ID.` };
        }
        seenIds.add(sc.scenarioId);
    }
    const launchId = (0, crypto_1.randomUUID)();
    const artifactDir = path_1.default.join(LAUNCH_ARTIFACTS_DIR, launchId);
    fs_1.default.mkdirSync(artifactDir, { recursive: true });
    const effectiveSectionId = Number(input.testrailSectionId ?? input.sectionId);
    const scenarioIds = selectionPlan.normalizedScenarios.map((_, i) => `PREVIEW-${String(i + 1).padStart(3, "0")}`).join(",");
    console.log(`[launch-execution] starting launchId=${launchId} appSlug=${input.appSlug} scenarios=${selectionPlan.normalizedScenarios.length} ids=${scenarioIds}`);
    let publishMappings = [];
    let routeDiscoveryPublishedCases = [];
    if (selectionPlan.scenariosToPublish.length > 0) {
        try {
            const trConfig = (0, env_1.requireTestRailConfig)(env_1.config);
            const trClient = new testrail_client_1.TestRailClient(trConfig);
            const mcpScenarios = selectionPlan.scenariosToPublish.map((s, i) => scenarioToMcpFormat(s, i, input.appSlug));
            const publishResult = await (0, testrail_case_publisher_1.publishScenariosToTestRail)(trClient, {
                projectId: input.projectId,
                suiteId: input.suiteId,
                sectionId: effectiveSectionId,
                scenarios: mcpScenarios,
                appSlug: input.appSlug,
                cacheKey: `launch-${launchId}`,
                publishStrategy: input.publishStrategy ?? "always_create",
                launchId, // Pass launchId for unique ID generation
            });
            publishMappings = publishResult.mappings.map((m, mi) => {
                const inputSc = selectionPlan.scenariosToPublish[mi];
                // executionScenarioId: what discovery will emit (PREVIEW-001)
                const executionScenarioId = (0, testrail_sync_types_1.buildScenarioPreviewScenarioId)(scenarioToMcpFormat(inputSc, inputSc.originalIndex, input.appSlug), inputSc.originalIndex);
                // testrailCustomScenarioId: globally unique ID stored in TestRail (L-abe094d6-001)
                const testrailCustomScenarioId = m.scenarioId;
                // launchScenarioId: frontend-provided ID (LAUNCH-001) - visual only, NOT globally unique
                const launchScenarioId = inputSc.scenarioId;
                const mapping = {
                    scenarioId: testrailCustomScenarioId, // TestRail custom_scenario_id
                    testRailCaseId: m.testRailCaseId,
                    title: m.title ?? inputSc.title,
                    sourceIssueKey: inputSc.sourceIssueKey,
                    launchScenarioId,
                    executionScenarioId,
                    testrailCustomScenarioId,
                };
                console.log(`[launch-execution] id mapping source=${inputSc.sourceIssueKey ?? "?"} launch=${launchScenarioId ?? "—"} testrailCustom=${testrailCustomScenarioId} execution=${executionScenarioId} caseId=${m.testRailCaseId}`);
                return mapping;
            });
            console.log(`[launch-execution] published cases count=${publishResult.caseIds.length} created=${publishResult.created} updated=${publishResult.updated} reused=${publishResult.reused}`);
            // Validate count match
            if (publishResult.caseIds.length !== selectionPlan.scenariosToPublish.length) {
                const msg = `Publish count mismatch: expected ${selectionPlan.scenariosToPublish.length} but got ${publishResult.caseIds.length}. Aborting TestRun creation.`;
                console.error(`[launch-execution] ${msg}`);
                return { ok: false, error: "publish_count_mismatch", message: msg };
            }
        }
        catch (err) {
            const message = `Failed to publish scenarios to TestRail: ${err.message ?? String(err)}`;
            console.error(`[launch-execution] ${message}`);
            return { ok: false, error: "publish_failed", message };
        }
    }
    if (routeDiscoveryScenarios.length > 0) {
        try {
            const trConfig = (0, env_1.requireTestRailConfig)(env_1.config);
            const trClient = new testrail_client_1.TestRailClient(trConfig);
            const discoveryPublishResult = await (0, testrail_case_publisher_1.publishScenariosToTestRail)(trClient, {
                projectId: input.projectId,
                suiteId: input.suiteId,
                sectionId: effectiveSectionId,
                scenarios: routeDiscoveryScenarios.map((scenario, index) => scenarioToMcpFormat(scenario, index, input.appSlug)),
                appSlug: input.appSlug,
                cacheKey: `launch-${launchId}-route-discovery`,
                publishStrategy: input.publishStrategy ?? "always_create",
                launchId,
            });
            routeDiscoveryPublishedCases = discoveryPublishResult.mappings.map((mapping, index) => {
                const scenario = routeDiscoveryScenarios[index];
                const executionScenarioId = scenario
                    ? (0, testrail_sync_types_1.buildScenarioPreviewScenarioId)(scenarioToMcpFormat(scenario, index, input.appSlug), index)
                    : undefined;
                return {
                    scenarioId: mapping.scenarioId,
                    caseId: mapping.testRailCaseId,
                    title: mapping.scenarioTitle ?? scenario?.title ?? "unknown",
                    sourceType: "jira_preview",
                    sourceIssueKey: scenario?.sourceIssueKey,
                    launchScenarioId: scenario?.scenarioId,
                    executionScenarioId,
                    testrailCustomScenarioId: mapping.scenarioId,
                };
            });
            const routeDiscoveryMapping = buildCanonicalPublishedCases([
                { source: "route_discovery_publication", entries: routeDiscoveryPublishedCases },
            ]);
            routeDiscoveryPublishedCases = routeDiscoveryMapping.publishedCases;
            for (const exclusion of routeDiscoveryMapping.excluded) {
                console.error(`[route-discovery] publishedCase excluded index=${exclusion.index} reason=${exclusion.reason}`);
            }
            console.log(`[route-discovery] publishedForDiscovery=${routeDiscoveryPublishedCases.length} created=${discoveryPublishResult.created} updated=${discoveryPublishResult.updated} reused=${discoveryPublishResult.reused}`);
        }
        catch (err) {
            console.error(`[route-discovery] publication failed reason=${err?.message ?? String(err)}`);
        }
    }
    const standardPublishedCases = publishMappings.map((mapping) => ({
        scenarioId: mapping.scenarioId,
        caseId: mapping.testRailCaseId,
        title: mapping.title ?? "unknown",
        sourceType: "jira_preview",
        sourceIssueKey: mapping.sourceIssueKey,
        launchScenarioId: mapping.launchScenarioId,
        executionScenarioId: mapping.executionScenarioId,
        testrailCustomScenarioId: mapping.testrailCustomScenarioId,
    }));
    const existingScenarioByCaseId = new Map(selectionPlan.existingScenarios.map((scenario) => [scenario.resolvedCaseId, scenario]));
    const existingPublishedCases = existingCasePlan.admitted
        .filter((unit) => unit.executionSource !== "blocked")
        .map((unit) => {
        const selectedScenario = existingScenarioByCaseId.get(unit.caseId);
        return {
            // Cases admitted for MCP do not have an automation identity yet.
            scenarioId: unit.scenarioId ?? `TR-CASE-${unit.caseId}`,
            caseId: unit.caseId,
            title: unit.title ?? unit.automationId,
            sourceType: "testrail_case",
            sourceIssueKey: selectedScenario?.sourceIssueKey,
            launchScenarioId: selectedScenario?.scenarioId,
            executionSource: unit.executionSource,
            reasonCode: unit.reasonCode,
            automationId: unit.automationId,
            specPath: unit.specPath,
            appSlug: unit.appSlug,
        };
    });
    const canonicalMapping = buildCanonicalPublishedCases([
        { source: "standard_publication", entries: standardPublishedCases },
        { source: "existing_cases", entries: existingPublishedCases },
        { source: "route_discovery_publication", entries: routeDiscoveryPublishedCases },
    ]);
    const publishedCases = canonicalMapping.publishedCases;
    const selectedExistingCaseIdSet = new Set(selectionPlan.existingTestRailCaseIds);
    for (const exclusion of canonicalMapping.excluded) {
        console.error(`[launch-execution] publishedCase excluded source=${exclusion.source} index=${exclusion.index} reason=${exclusion.reason}`);
    }
    const caseIdsForRun = publishedCases.map((entry) => entry.caseId);
    if (caseIdsForRun.length === 0) {
        return { ok: false, error: "publish_failed", message: "No case IDs were selected or returned after publishing. Cannot create TestRun." };
    }
    // ── 3. Create TestRun ──
    let testRunId;
    const runRefs = (input.jiraKey || "").trim();
    try {
        const trConfig = (0, env_1.requireTestRailConfig)(env_1.config);
        const trClient = new testrail_client_1.TestRailClient(trConfig);
        const runName = buildLaunchRunName(input.jiraKey, input.sprintName);
        console.log(`[launch-execution] creating TestRail run include_all=false caseIds=${caseIdsForRun.length} ids=${JSON.stringify(caseIdsForRun)} refs=${runRefs || "(none)"}`);
        const run = await trClient.addRun({
            projectId: String(input.projectId),
            suiteId: input.suiteId ? String(input.suiteId) : undefined,
            name: runName,
            description: `QA Lab launch for ${input.appSlug} | section=${effectiveSectionId} | ${selectionPlan.normalizedScenarios.length} scenarios | launchId=${launchId}`,
            caseIds: caseIdsForRun,
            refs: runRefs || undefined,
        });
        testRunId = run.id;
        console.log(`[launch-execution] testRun created runId=${run.id}`);
    }
    catch (err) {
        const message = `Failed to create TestRun: ${err.message ?? String(err)}`;
        console.error(`[launch-execution] ${message}`);
        return { ok: false, error: "test_run_create_failed", message };
    }
    // Log mapping validation
    console.log(`[launch-execution] publishedCases count=${publishedCases.length}`);
    for (const pc of publishedCases) {
        const executionId = pc.executionScenarioId ?? "MISSING";
        const launchId = pc.launchScenarioId ?? "—";
        const testrailCustomId = pc.testrailCustomScenarioId ?? "MISSING";
        console.log(`[launch-execution] publishedCase execution=${executionId} launch=${launchId} testrailCustom=${testrailCustomId} caseId=${pc.caseId}`);
    }
    const manifest = {
        launchId,
        createdAt: new Date().toISOString(),
        appSlug: input.appSlug,
        sectionSlug: input.sectionSlug ?? "default-section",
        sectionName: input.sectionName,
        sectionId: effectiveSectionId,
        testRail: {
            projectId: input.projectId,
            suiteId: input.suiteId,
            sectionId: effectiveSectionId,
            runId: testRunId,
            refs: runRefs || undefined,
        },
        jira: input.jiraKey ? { key: input.jiraKey, ...(input.jiraTitle ? { title: input.jiraTitle } : {}) } : undefined,
        sprintName: input.sprintName,
        publishStrategy: input.publishStrategy ?? "always_create",
        selectedScenarioCount: publishedCases.filter((entry) => !selectedExistingCaseIdSet.has(entry.caseId)).length,
        selectedExistingTestRailCaseCount: publishedCases.filter((entry) => selectedExistingCaseIdSet.has(entry.caseId)).length,
        adaptiveScenarioCount: adaptiveScenarios.length,
        executionMode: adaptiveScenarios.length > 0 || routeDiscoveryCount > 0 ? "automatic_mixed_execution" : "standard",
        publishedCases,
        status: "test_run_created",
        executionPlan: {
            standardScenarios: selectionPlan.normalizedScenarios.map(({ originalIndex: _originalIndex, resolvedCaseId: _resolvedCaseId, ...scenario }) => scenario),
            adaptiveScenarios,
            routeDiscoveryScenarios,
            routeDiscoveryPublishedCases,
            existingCases: existingCasePlan,
        },
    };
    const manifestPath = path_1.default.join(artifactDir, "launch-manifest.json");
    fs_1.default.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(`[launch-execution] manifest written path=${manifestPath}`);
    const canonicalCaseIdSet = new Set(publishedCases.map((publishedCase) => publishedCase.caseId));
    const executionCaseIds = aggregateLaunchCaseIds(routeDiscoveryPublishedCases, existingPublishedCases)
        .filter((caseId) => canonicalCaseIdSet.has(caseId));
    let discoveryJobId;
    if (executionCaseIds.length > 0) {
        const childPublishedCases = publishedCases.filter((publishedCase) => executionCaseIds.includes(publishedCase.caseId));
        const routeProfile = [...routeDiscoveryScenarios, ...selectionPlan.normalizedScenarios]
            .find((scenario) => scenario.routeProfile)?.routeProfile;
        const inputRecord = input;
        const hasForceRediscovery = Object.prototype.hasOwnProperty.call(inputRecord, "forceRediscovery");
        const forceRediscovery = inputRecord.forceRediscovery;
        console.log((0, discovery_batch_runner_1.buildRediscoveryProvenanceLine)({
            boundary: "pre_job_store",
            sourceEndpoint: "/api/runs/launch-execution",
            jobType: "discovery-batch",
            correlationField: "launchId",
            correlationValue: launchId,
            value: hasForceRediscovery ? forceRediscovery : undefined,
            valueSource: hasForceRediscovery ? "input.forceRediscovery" : "absent",
        }));
        const discoveryJobParams = buildDiscoveryBatchParamsFromLaunch({
            launch: input,
            executionCaseIds,
            publishedCases: childPublishedCases,
            routeProfile,
            launchId,
            testRunId,
        });
        const createPrePresent = Object.prototype.hasOwnProperty.call(discoveryJobParams, "forceRediscovery");
        const createPreValue = discoveryJobParams.forceRediscovery;
        const discoveryJob = job_store_1.jobStore.create("discovery-batch", discoveryJobParams);
        const storedParams = discoveryJob.params;
        job_store_1.jobStore.appendLog(discoveryJob.id, buildRediscoveryCreateHandoffLine({
            launchId,
            jobId: discoveryJob.id,
            prePresent: createPrePresent,
            preValue: createPreValue,
            storedPresent: Object.prototype.hasOwnProperty.call(storedParams, "forceRediscovery"),
            storedValue: storedParams.forceRediscovery,
        }));
        discoveryJobId = discoveryJob.id;
        job_store_1.jobStore.appendLog(discoveryJobId, `[launch-execution-plan] existingSpec=${existingCasePlan.existingSpec.length} mcpRequired=${existingCasePlan.mcpRequired.length} routeDiscovery=${routeDiscoveryScenarios.length}`);
        (0, discovery_batch_runner_1.startDiscoveryBatchRun)(discoveryJobId);
    }
    else if (routeDiscoveryCount > 0) {
        console.log(`[route-discovery] pending scenarios=${routeDiscoveryCount} reason=publication_failed_or_no_case_id`);
    }
    const issueKey = input.jiraKey || selectionPlan.normalizedScenarios[0]?.sourceIssueKey || "";
    let checklistUrl;
    if (issueKey) {
        const list = defect_checklist_store_1.defectChecklistStore.getOrCreate(issueKey);
        checklistUrl = `/checklist/${list.urlSlug}${discoveryJobId ? `?jobId=${encodeURIComponent(discoveryJobId)}` : ""}`;
    }
    if (issueKey) {
        const list = defect_checklist_store_1.defectChecklistStore.getOrCreate(issueKey);
        checklistUrl = `/checklist/${list.urlSlug}${discoveryJobId ? `?jobId=${encodeURIComponent(discoveryJobId)}` : ""}`;
    }
    return {
        ok: true,
        launchId,
        status: "test_run_created",
        issueKey: issueKey || undefined,
        checklistUrl,
        publishedCases,
        routeDiscoveryScenarios,
        routeDiscoveryPublishedCases,
        existingCasePlan,
        discoveryJobId,
        testRunId,
        manifestPath,
    };
}
