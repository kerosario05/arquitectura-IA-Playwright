import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { loadAutomationIndex } from "../../automations/automation-index";
import { normalizeAppSlug } from "../../automations/app-profile";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { publishScenariosToTestRail } from "../services/testrail-case-publisher";
import { buildScenarioPreviewScenarioId } from "../services/testrail-sync-types";
import type { McpRouteProfile, McpScenario } from "../../scenarios/scenario-types";
import type { PromotedAutomationIndexEntry } from "../../types/automation-promotion.types";
import { defectChecklistStore } from "../services/defect-checklist-store";
import { jobStore } from "./job-store";
import { startDiscoveryBatchRun, validatePromotedEntryForExecution } from "./discovery-batch-runner";
import { buildMcpScenarioContractFromTestRailCase, evaluateCaseContractSufficiency, extractCaseContractMetadata } from "../../automations/case-contract-evaluator";
import { normalizeTestRailCase } from "../../testrail/testrail-normalizer";
import type { RawTestRailCase } from "../../types/testrail.types";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const LAUNCH_ARTIFACTS_DIR = path.join(ROOT, ".artifacts", "scenario-launch-runs");

export type LaunchScenario = {
  scenarioId: string;
  title: string;
  steps: string[];
  expectedResult: string;
  preconditions: string[];
  routeProfile?: McpRouteProfile;
  sourceIssueKey?: string;
  testRailCaseId?: number;
  metadata?: Record<string, unknown>;
  mcpExecutable?: boolean;
  executionReadiness?: string;
  semanticValidity?: string;
  automationType?: string;
  launchClassification?: "standard" | "adaptive" | "nonAutomatable";
  publicationClassification?: string;
  nonAutomatable?: boolean;
  targetScreen?: string;
  actualChain?: unknown;
  requiredChain?: unknown;
  validation?: { valid?: boolean };
  functionalBranch?: { branchId?: string; actionIntent?: string; expectedDestination?: string; destination?: { semanticDeclaration?: string } };
  branchAssociation?: { branchId?: string };
  branchId?: string;
  requirementDependencies?: unknown[];
  stepRequirementRefs?: unknown[];
};

export type LaunchExecutionInput = {
  appSlug: string;
  sectionSlug?: string;
  sectionName?: string;
  sectionId?: string | number;
  projectId?: number;
  suiteId?: number;
  testrailSectionId?: number;
  jiraKey?: string;
  jiraTitle?: string;
  sprintName?: string;
  selectedScenarios: LaunchScenario[];
  existingTestRailCaseIds?: number[];
  adaptiveScenarios?: LaunchScenario[];
  publishStrategy?: "always_create" | "use_existing";
};

export type PublishedCaseEntry = {
  scenarioId: string; // TestRail custom_scenario_id (same as testrailCustomScenarioId)
  caseId: number;
  title: string;
  sourceType?: "jira_preview" | "testrail_case";
  sourceIssueKey?: string;
  launchScenarioId?: string; // Frontend-provided ID (e.g., LAUNCH-001) - NOT globally unique, visual only
  executionScenarioId?: string; // Discovery execution ID (e.g., PREVIEW-001) - what case_finished emits
  testrailCustomScenarioId?: string; // Globally unique ID for TestRail (e.g., L-abe094d6-001)
  executionSource?: "existing_spec" | "mcp_required";
  reasonCode?: string;
  automationId?: string;
  specPath?: string;
  appSlug?: string;
};

export type ExistingCaseExecutionUnit = {
  caseId: number;
  executionSource: "existing_spec" | "mcp_required" | "blocked";
  reasonCode: string;
  mcpRequired: boolean;
  automationId?: string;
  scenarioId?: string;
  appSlug?: string;
  specPath?: string;
  title?: string;
};

export type ExistingCaseExecutionPlan = {
  existingSpec: ExistingCaseExecutionUnit[];
  mcpRequired: ExistingCaseExecutionUnit[];
  blocked: ExistingCaseExecutionUnit[];
  admitted: ExistingCaseExecutionUnit[];
  launchAccepted: boolean;
};

export type LaunchExecutionResult = {
  ok: true;
  launchId: string;
  status: string;
  publishedCases: PublishedCaseEntry[];
  routeDiscoveryScenarios?: LaunchScenario[];
  routeDiscoveryPublishedCases?: PublishedCaseEntry[];
  existingCasePlan?: ExistingCaseExecutionPlan;
  discoveryJobId?: string;
  testRunId?: number;
  manifestPath: string;
} | {
  ok: false;
  error: string;
  message: string;
  existingCasePlan?: ExistingCaseExecutionPlan;
};

export function classifyLaunchScenarioAuthority(scenario: Pick<LaunchScenario, "mcpExecutable" | "executionReadiness" | "launchClassification">): "standard" | "adaptive" | "nonAutomatable" {
  if (scenario.launchClassification === "nonAutomatable") return "nonAutomatable";
  return scenario.mcpExecutable !== true || scenario.executionReadiness === "requires_route_discovery"
    ? "adaptive"
    : "standard";
}

export function classifyRouteDiscoveryEligibility(scenario: Pick<LaunchScenario, "executionReadiness" | "semanticValidity" | "launchClassification" | "nonAutomatable" | "validation" | "functionalBranch" | "branchAssociation" | "requirementDependencies" | "stepRequirementRefs">): { allowed: boolean; reasonCode: string } {
  if (scenario.launchClassification === "nonAutomatable" || scenario.nonAutomatable === true) {
    return { allowed: false, reasonCode: "non_automatable" };
  }
  if (scenario.executionReadiness !== "requires_route_discovery") {
    return { allowed: false, reasonCode: "readiness_not_requires_route_discovery" };
  }
  if (scenario.validation?.valid === false || !["valid", "validated"].includes(scenario.semanticValidity ?? "")) {
    return { allowed: false, reasonCode: "semantic_scenario_invalid" };
  }
  const hasStructuredLineage = Boolean(
    (scenario as LaunchScenario).branchId
      || scenario.functionalBranch?.branchId
      || scenario.branchAssociation?.branchId
      || (scenario.requirementDependencies?.length ?? 0) > 0
      || (scenario.stepRequirementRefs?.length ?? 0) > 0,
  );
  if (!hasStructuredLineage) return { allowed: false, reasonCode: "missing_structured_lineage" };
  return { allowed: true, reasonCode: "requires_route_discovery" };
}

function hasCompleteStructuredAdaptiveMetadata(scenario: LaunchScenario): boolean {
  const branchId = [scenario.branchId, scenario.functionalBranch?.branchId, scenario.branchAssociation?.branchId]
    .find((value) => Boolean(value && value !== "none"));
  const requirementRefs = Array.isArray(scenario.stepRequirementRefs) ? scenario.stepRequirementRefs : [];
  return Boolean(branchId && scenario.functionalBranch && requirementRefs.length > 0);
}

export function partitionLaunchScenarios(scenarios: LaunchScenario[]): {
  standard: LaunchScenario[];
  adaptiveFunctional: LaunchScenario[];
  routeDiscovery: LaunchScenario[];
  nonAutomatable: LaunchScenario[];
} {
  const routeDiscovery: LaunchScenario[] = [];
  const standard: LaunchScenario[] = [];
  const adaptiveFunctional: LaunchScenario[] = [];
  const nonAutomatable: LaunchScenario[] = [];
  for (const scenario of scenarios) {
    if (classifyRouteDiscoveryEligibility(scenario).allowed) routeDiscovery.push(scenario);
    else if (classifyLaunchScenarioAuthority(scenario) === "nonAutomatable") nonAutomatable.push(scenario);
    else if (classifyLaunchScenarioAuthority(scenario) === "standard") standard.push(scenario);
    else adaptiveFunctional.push(scenario);
  }
  return { standard, adaptiveFunctional, routeDiscovery, nonAutomatable };
}

function buildLaunchRunName(jiraKey?: string, sprintName?: string): string {
  const parts: string[] = [];
  if (jiraKey) parts.push(jiraKey);
  if (sprintName) parts.push(sprintName);
  parts.push("QA Lab Automation Run");
  parts.push(new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  return parts.join(" - ");
}

function scenarioToMcpFormat(scenario: LaunchScenario, index: number, appSlug: string): McpScenario & { launchScenarioId?: string } {
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

type PlannedLaunchScenario = LaunchScenario & {
  originalIndex: number;
  resolvedCaseId?: number;
};

type LaunchSelectionPlan = {
  normalizedScenarios: PlannedLaunchScenario[];
  scenariosToPublish: PlannedLaunchScenario[];
  existingScenarios: PlannedLaunchScenario[];
  existingTestRailCaseIds: number[];
  invalidScenarioTitles: string[];
};

function toPositiveCaseId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

export function extractLaunchScenarioCaseId(scenario: LaunchScenario): number | undefined {
  const asAny = scenario as any;
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
    if (parsed) return parsed;
  }
  return undefined;
}

function extractPublishedCaseId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return extractPublishedCaseId(record.caseId)
    ?? extractPublishedCaseId(record.testRailCaseId)
    ?? extractPublishedCaseId(record.testrailCaseId)
    ?? extractPublishedCaseId(record.id);
}

export function aggregateLaunchCaseIds(...sources: unknown[][]): number[] {
  const ids = new Set<number>();
  for (const source of sources) {
    for (const value of source ?? []) {
      const caseId = extractPublishedCaseId(value);
      if (caseId !== undefined) ids.add(caseId);
    }
  }
  return Array.from(ids);
}

export type PublishedCaseExclusion = {
  source: string;
  index: number;
  reason: "invalid_case_id" | "missing_mapping_identity";
};

export function buildCanonicalPublishedCases(
  sources: Array<{ source: string; entries: unknown[] }>,
): { publishedCases: PublishedCaseEntry[]; excluded: PublishedCaseExclusion[] } {
  const byCaseId = new Map<number, PublishedCaseEntry>();
  const excluded: PublishedCaseExclusion[] = [];

  for (const source of sources) {
    for (let index = 0; index < source.entries.length; index++) {
      const value = source.entries[index];
      const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
      const caseId = extractPublishedCaseId(value);
      if (!caseId) {
        excluded.push({ source: source.source, index, reason: "invalid_case_id" });
        continue;
      }

      const readIdentity = (key: string): string | undefined => {
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
      const candidate: PublishedCaseEntry = {
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

type ExistingSpecValidation = {
  reusable: boolean;
  reason: string;
  specPath?: string;
};

function normalizeOwnedAppSlug(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  return normalizeAppSlug(value);
}

export function resolveExistingCaseExecutionPlan(input: {
  caseIds: number[];
  appSlug: string;
  sectionSlug?: string;
  entries: PromotedAutomationIndexEntry[];
  validateSpec?: (entry: PromotedAutomationIndexEntry) => ExistingSpecValidation;
  caseContracts?: Map<number, { usable: boolean; reasonCode: string }>;
}): ExistingCaseExecutionPlan {
  const requestedApp = normalizeOwnedAppSlug(input.appSlug);
  const existingSpec: ExistingCaseExecutionUnit[] = [];
  const mcpRequired: ExistingCaseExecutionUnit[] = [];
  const blocked: ExistingCaseExecutionUnit[] = [];
  const caseIds = aggregateLaunchCaseIds(input.caseIds);

  for (const caseId of caseIds) {
    const allCandidates = input.entries.filter((entry) => entry.caseId === caseId && entry.id?.trim());
    if (allCandidates.length === 0) {
      const contract = input.caseContracts?.get(caseId);
      if (contract?.usable) {
        mcpRequired.push({ caseId, executionSource: "mcp_required", reasonCode: contract.reasonCode, mcpRequired: true });
      } else {
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

    const uniqueCandidateMap = new Map<string, PromotedAutomationIndexEntry>();
    for (const entry of ownedCandidates) {
      const identity = `${entry.id.trim()}\u0000${normalizeOwnedAppSlug(entry.appSlug ?? entry.appProfile)}`;
      if (!uniqueCandidateMap.has(identity)) uniqueCandidateMap.set(identity, entry);
    }
    const uniqueCandidates = Array.from(uniqueCandidateMap.values());
    if (uniqueCandidates.length !== 1) {
      blocked.push({ caseId, executionSource: "blocked", reasonCode: "ambiguous_automation_mapping", mcpRequired: false });
      continue;
    }

    const entry = uniqueCandidates[0];
    const validation = input.validateSpec
      ? input.validateSpec(entry)
      : validatePromotedEntryForExecution({
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

async function loadExistingCaseAutomationEntries(appSlug: string): Promise<PromotedAutomationIndexEntry[]> {
  const entries: PromotedAutomationIndexEntry[] = [];
  const normalizedApp = normalizeOwnedAppSlug(appSlug);
  const indexPaths = [
    ...(normalizedApp ? [path.join("automations", "apps", normalizedApp, "index.json")] : []),
    path.join("automations", "index.json"),
  ];
  for (const indexPath of indexPaths) {
    try {
      const index = await loadAutomationIndex(indexPath);
      entries.push(...index.automations);
    } catch (error: any) {
      console.error(`[launch-execution] automation index unavailable path=${indexPath} reason=${error?.message ?? String(error)}`);
    }
  }
  return entries;
}

export function buildLaunchSelectionPlan(input: Pick<LaunchExecutionInput, "selectedScenarios" | "existingTestRailCaseIds">): LaunchSelectionPlan {
  const normalizedScenarios: PlannedLaunchScenario[] = [];
  const invalidScenarioTitles: string[] = [];
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

  const existingCaseIdSet = new Set<number>();
  for (const caseId of input.existingTestRailCaseIds ?? []) {
    const parsed = toPositiveCaseId(caseId);
    if (parsed) existingCaseIdSet.add(parsed);
  }

  const existingScenarios: PlannedLaunchScenario[] = [];
  const scenariosToPublish: PlannedLaunchScenario[] = [];

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

export async function launchExecution(input: LaunchExecutionInput): Promise<LaunchExecutionResult> {
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
  const adaptiveFromInput = (input.adaptiveScenarios ?? []).filter(
    (scenario) => classifyLaunchScenarioAuthority(scenario) !== "nonAutomatable",
  );
  const adaptiveScenarios = Array.from(new Map(
    [...adaptiveFromInput, ...adaptiveFromSelected]
      .map((scenario, index) => [scenario.scenarioId || `adaptive-${index}`, scenario] as const),
  ).values());
  const executableSelectedScenarios = selectedScenarios.filter((scenario) =>
    !routeDiscoverySet.has(scenario) && !adaptiveFromSelected.includes(scenario) && !nonAutomatableFromSelected.includes(scenario),
  );
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
  console.log(
    `[runs:launch] standard=${standardCount} publishable=${selectionPlan.scenariosToPublish.length} existingCases=${existingCaseCount} adaptive=${adaptiveCount} routeDiscovery=${routeDiscoveryScenarios.length} mode=${adaptiveCount > 0 || routeDiscoveryScenarios.length > 0 ? "automatic_mixed_execution" : "standard"}`,
  );

  // Validate adaptive scenarios have required metadata
  const validAdaptive: LaunchScenario[] = [];
  const blockedAdaptive: Array<{ sourceIssueKey?: string; title?: string; reasonCode: string; reason: string }> = [];
  for (const sc of adaptiveScenarios) {
    const asAny = sc as any;
    const hasLegacyMetadata = Boolean(asAny.targetScreen && asAny.actualChain && asAny.requiredChain);
    if (!hasLegacyMetadata && !hasCompleteStructuredAdaptiveMetadata(sc)) {
      blockedAdaptive.push({
        sourceIssueKey: asAny.sourceIssueKey ?? "",
        title: asAny.title ?? "",
        reasonCode: "adaptive_metadata_incomplete",
        reason: `Missing structured adaptive authority: ${!asAny.branchId && !asAny.functionalBranch?.branchId ? "branchId " : ""}${!asAny.stepRequirementRefs?.length ? "stepRequirementRefs " : ""}`,
      });
    } else {
      validAdaptive.push(sc);
    }
  }
  if (blockedAdaptive.length > 0) {
    console.log(`[runs:launch] blockedAdaptive count=${blockedAdaptive.length} reason=adaptive_metadata_incomplete`);
  }
  const routeDiscoveryIds = new Set(routeDiscoveryScenarios.map((scenario) => scenario.scenarioId));
  for (const scenario of validAdaptive) {
    if (routeDiscoveryIds.has(scenario.scenarioId)) continue;
    routeDiscoveryScenarios.push(scenario);
    routeDiscoveryIds.add(scenario.scenarioId);
  }
  routeDiscoveryCount = routeDiscoveryScenarios.length;
  const existingCaseEntries = await loadExistingCaseAutomationEntries(input.appSlug);
  const caseContracts = new Map<number, { usable: boolean; reasonCode: string }>();
  if (selectionPlan.existingTestRailCaseIds.length > 0) {
    try {
      const trClient = new TestRailClient(requireTestRailConfig(config));
      for (const caseId of selectionPlan.existingTestRailCaseIds) {
        try {
          const rawCase: RawTestRailCase = await trClient.getCase(caseId);
          const normalizedCase = normalizeTestRailCase(rawCase);
          const metadata = extractCaseContractMetadata(rawCase);
          const contract = buildMcpScenarioContractFromTestRailCase({ scenario: normalizedCase, appSlug: input.appSlug, metadata });
          const evaluation = evaluateCaseContractSufficiency({
            scenario: contract,
            appSlug: input.appSlug,
            sectionSlug: input.sectionSlug,
            metadata,
            hasRouteProfileConfig: true,
          });
          caseContracts.set(caseId, { usable: evaluation.sufficient, reasonCode: evaluation.reasonCode });
        } catch {
          caseContracts.set(caseId, { usable: false, reasonCode: "case_not_found" });
        }
      }
    } catch {
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
  console.log(
    `[launch-existing-cases] existingSpec=${existingCasePlan.existingSpec.length} mcpRequired=${existingCasePlan.mcpRequired.length} blocked=${existingCasePlan.blocked.length}`,
  );
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
  const seenIds = new Set<string>();
  for (const sc of selectionPlan.normalizedScenarios) {
    if (seenIds.has(sc.scenarioId)) {
      return { ok: false, error: "duplicate_scenario_ids", message: `Duplicate scenarioId: "${sc.scenarioId}". Each scenario must have a unique execution ID.` };
    }
    seenIds.add(sc.scenarioId);
  }

  const launchId = randomUUID();
  const artifactDir = path.join(LAUNCH_ARTIFACTS_DIR, launchId);
  fs.mkdirSync(artifactDir, { recursive: true });

  const effectiveSectionId = Number(input.testrailSectionId ?? input.sectionId);

  const scenarioIds = selectionPlan.normalizedScenarios.map((_, i) => `PREVIEW-${String(i + 1).padStart(3, "0")}`).join(",");
  console.log(`[launch-execution] starting launchId=${launchId} appSlug=${input.appSlug} scenarios=${selectionPlan.normalizedScenarios.length} ids=${scenarioIds}`);

  // ── 2. Publish scenarios to TestRail ──
  type PublishMapping = {
    scenarioId: string; // TestRail custom_scenario_id
    testRailCaseId: number;
    title?: string;
    sourceIssueKey?: string;
    launchScenarioId?: string; // Frontend ID (LAUNCH-001) - visual only
    executionScenarioId?: string; // Discovery execution ID (PREVIEW-001)
    testrailCustomScenarioId?: string; // Globally unique TestRail ID (L-xxx-001)
  };
  let publishMappings: PublishMapping[] = [];
  let routeDiscoveryPublishedCases: PublishedCaseEntry[] = [];

  if (selectionPlan.scenariosToPublish.length > 0) {
    try {
      const trConfig = requireTestRailConfig(config);
      const trClient = new TestRailClient(trConfig);

      const mcpScenarios = selectionPlan.scenariosToPublish.map((s, i) => scenarioToMcpFormat(s, i, input.appSlug));
      const publishResult = await publishScenariosToTestRail(trClient, {
        projectId: input.projectId,
        suiteId: input.suiteId,
        sectionId: effectiveSectionId,
        scenarios: mcpScenarios,
        appSlug: input.appSlug,
        cacheKey: `launch-${launchId}`,
        publishStrategy: input.publishStrategy ?? "always_create",
        launchId, // Pass launchId for unique ID generation
      } as any);

      publishMappings = publishResult.mappings.map((m: any, mi: number) => {
        const inputSc = selectionPlan.scenariosToPublish[mi];

        // executionScenarioId: what discovery will emit (PREVIEW-001)
        const executionScenarioId = buildScenarioPreviewScenarioId(
          scenarioToMcpFormat(inputSc, inputSc.originalIndex, input.appSlug),
          inputSc.originalIndex,
        );

        // testrailCustomScenarioId: globally unique ID stored in TestRail (L-abe094d6-001)
        const testrailCustomScenarioId = m.scenarioId;

        // launchScenarioId: frontend-provided ID (LAUNCH-001) - visual only, NOT globally unique
        const launchScenarioId = inputSc.scenarioId;

        const mapping: PublishMapping = {
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
    } catch (err: any) {
      const message = `Failed to publish scenarios to TestRail: ${err.message ?? String(err)}`;
      console.error(`[launch-execution] ${message}`);
      return { ok: false, error: "publish_failed", message };
    }
  }

  if (routeDiscoveryScenarios.length > 0) {
    try {
      const trConfig = requireTestRailConfig(config);
      const trClient = new TestRailClient(trConfig);
      const discoveryPublishResult = await publishScenariosToTestRail(trClient, {
        projectId: input.projectId,
        suiteId: input.suiteId,
        sectionId: effectiveSectionId,
        scenarios: routeDiscoveryScenarios.map((scenario, index) => scenarioToMcpFormat(scenario, index, input.appSlug)),
        appSlug: input.appSlug,
        cacheKey: `launch-${launchId}-route-discovery`,
        publishStrategy: input.publishStrategy ?? "always_create",
        launchId,
      } as any);
      routeDiscoveryPublishedCases = discoveryPublishResult.mappings.map((mapping, index) => {
        const scenario = routeDiscoveryScenarios[index];
        const executionScenarioId = scenario
          ? buildScenarioPreviewScenarioId(scenarioToMcpFormat(scenario, index, input.appSlug), index)
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
    } catch (err: any) {
      console.error(`[route-discovery] publication failed reason=${err?.message ?? String(err)}`);
    }
  }

  const standardPublishedCases: PublishedCaseEntry[] = publishMappings.map((mapping) => ({
    scenarioId: mapping.scenarioId,
    caseId: mapping.testRailCaseId,
    title: mapping.title ?? "unknown",
    sourceType: "jira_preview",
    sourceIssueKey: mapping.sourceIssueKey,
    launchScenarioId: mapping.launchScenarioId,
    executionScenarioId: mapping.executionScenarioId,
    testrailCustomScenarioId: mapping.testrailCustomScenarioId,
  }));
  const existingScenarioByCaseId = new Map(
    selectionPlan.existingScenarios.map((scenario) => [scenario.resolvedCaseId, scenario]),
  );
  const existingPublishedCases: PublishedCaseEntry[] = existingCasePlan.admitted
    .filter((unit): unit is ExistingCaseExecutionUnit & { executionSource: "existing_spec" | "mcp_required" } => unit.executionSource !== "blocked")
    .map((unit) => {
      const selectedScenario = existingScenarioByCaseId.get(unit.caseId);
      return {
      // Cases admitted for MCP do not have an automation identity yet.
      scenarioId: unit.scenarioId ?? `TR-CASE-${unit.caseId}`,
      caseId: unit.caseId,
      title: unit.title ?? unit.automationId!,
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
  let testRunId: number | undefined;
  const runRefs = (input.jiraKey || "").trim();

  try {
    const trConfig = requireTestRailConfig(config);
    const trClient = new TestRailClient(trConfig);

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
  } catch (err: any) {
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

  const manifestPath = path.join(artifactDir, "launch-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
  console.log(`[launch-execution] manifest written path=${manifestPath}`);

  const canonicalCaseIdSet = new Set(publishedCases.map((publishedCase) => publishedCase.caseId));
  const executionCaseIds = aggregateLaunchCaseIds(routeDiscoveryPublishedCases, existingPublishedCases)
    .filter((caseId) => canonicalCaseIdSet.has(caseId));
  let discoveryJobId: string | undefined;
  if (executionCaseIds.length > 0) {
    const childPublishedCases = publishedCases.filter((publishedCase) => executionCaseIds.includes(publishedCase.caseId));
    const routeProfile = [...routeDiscoveryScenarios, ...selectionPlan.normalizedScenarios]
      .find((scenario) => scenario.routeProfile)?.routeProfile;
    const discoveryJob = jobStore.create("discovery-batch", {
      caseIds: executionCaseIds,
      appSlug: input.appSlug,
      sectionSlug: input.sectionSlug,
      sectionName: input.sectionName,
      executePromotedSpecs: true,
      overwrite: false,
      rerunActive: false,
      launchId,
      testRunId,
      jiraKey: input.jiraKey,
      publishedCases: childPublishedCases,
      ...(routeProfile ? { routeProfile } : {}),
    });
    discoveryJobId = discoveryJob.id;
    jobStore.appendLog(discoveryJobId, `[launch-execution-plan] existingSpec=${existingCasePlan.existingSpec.length} mcpRequired=${existingCasePlan.mcpRequired.length} routeDiscovery=${routeDiscoveryScenarios.length}`);
    startDiscoveryBatchRun(discoveryJobId);
  } else if (routeDiscoveryCount > 0) {
    console.log(`[route-discovery] pending scenarios=${routeDiscoveryCount} reason=publication_failed_or_no_case_id`);
  }

  const issueKey = input.jiraKey || (selectionPlan.normalizedScenarios[0] as any)?.sourceIssueKey || "";

  let checklistUrl: string | undefined;
  if (issueKey) {
    const list = defectChecklistStore.getOrCreate(issueKey);
    checklistUrl = `/checklist/${list.urlSlug}${discoveryJobId ? `?jobId=${encodeURIComponent(discoveryJobId)}` : ""}`;
  }
  if (issueKey) {
    const list = defectChecklistStore.getOrCreate(issueKey);
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
