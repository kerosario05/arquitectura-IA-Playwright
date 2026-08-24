import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { RunEvidenceRecorder } from "../../evidence/run-evidence-recorder";
import { buildEvidenceRunPaths } from "../../evidence/evidence-paths";
import { loadAutomationIndex } from "../../automations/automation-index";
import {
  buildMcpScenarioContractFromTestRailCase,
  buildVirtualCaseFromContract,
  evaluateCaseContractSufficiency,
  extractCaseContractMetadata,
  type CaseContractSufficiencyResult,
} from "../../automations/case-contract-evaluator";
import { loadAppConfig } from "../../automations/scenario-normalizer";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { normalizeTestRailCase } from "../../testrail/testrail-normalizer";
import type { PromotedAutomationIndexEntry, PromotedAutomationStatus } from "../../types/automation-promotion.types";
import type { RawTestRailCase } from "../../types/testrail.types";
import type { PublishedCaseEntry } from "./launch-orchestrator";
import { jobStore } from "./job-store";
import {
  finalizeLaunchManifest,
  syncDiscoveryResultToTestRail,
  updateLaunchManifestJobId,
  updateLaunchManifestWithResult,
} from "./testrail-result-sync";
import { defectChecklistStore } from "../services/defect-checklist-store";
import type { Checklist, Defect } from "../services/defect-checklist-store";
import {
  buildDefectTitle,
  buildStructuredDefectDescription,
  inferDefectSeverity,
} from "../services/defect-content-builder";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const APPS_ROOT = path.join(ROOT, "automations", "apps");
const DISCOVERY_CASE_FINISHED_RE = /\[discovery:batch\] Case C(\d+)\s+finished:\s+([a-z_]+)(?:\s+\((\d+)ms\))?/i;
const RUNTIME_MODULE_MODE = (() => {
  try {
    return (new Function("return typeof module !== 'undefined' && module.exports ? 'cjs' : 'esm';"))() as string;
  } catch {
    return "unknown";
  }
})();

type DiscoveryBatchParams = {
  caseIds: number[];
  appSlug?: string;
  sectionName?: string;
  sectionSlug?: string;
  overwrite?: boolean;
  autoPromote?: boolean;
  autoPom?: boolean;
  rerunActive?: boolean;
  headed?: boolean;
  forceRediscovery?: boolean;
  executePromotedSpecs?: boolean;
  launchId?: string;
  testRunId?: number;
  jiraKey?: string;
  publishedCases?: PublishedCaseEntry[];
};

export type RediscoveryIntentSource = "user_request" | "job_default" | "legacy_default" | "none";

export type RediscoveryIntent = {
  explicit: boolean;
  source: RediscoveryIntentSource;
  overwrite: boolean;
  rerunActive: boolean;
};

type ExecutionRoute =
  | "promoted_reuse"
  | "automation_from_case_contract"
  | "targeted_discovery"
  | "full_discovery"
  | "blocked";

type RouteDecision = {
  caseId: number;
  appSlug: string;
  route: ExecutionRoute;
  reason: string;
  specPath?: string;
};

type CommandResult = {
  exitCode: number;
  lines: string[];
};

type ConsolidationResult = {
  attempted: boolean;
  generated: boolean;
  documentPathPresent: boolean;
  documentPath?: string;
  scenarioEvidenceCount: number;
  error?: string;
};

type CaseExecutionStatus = "passed" | "failed";

type CaseExecutionResult = {
  caseId: number;
  status: CaseExecutionStatus;
  completedAt: string;
  durationMs: number;
  reason?: string;
  scenarioId?: string;
  scenarioTitle?: string;
  sourceType?: ExecutionSourceGroup;
  appSlug?: string;
  sectionSlug?: string;
  launchId?: string;
  failedStep?: number;
  failedTarget?: string;
  failureReason?: string;
  errorMessage?: string;
  screenshotPath?: string;
  evidencePath?: string;
};

export type FunctionalExecutionSnapshot = {
  requested: number;
  completed: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
  progressPercent: number;
  passRate: number | null;
};

export type DiscoveryBatchExecutionPlan = {
  requestedCaseIds: number[];
  alreadyPromotedCaseIds: number[];
  executableCaseIds: number[];
  notExecutableCaseIds: number[];
  requiresDiscoveryCaseIds: number[];
};

export type ExecutionSourceGroup = "jira_preview" | "testrail_case";
export type ExecutionBatchMode = "jira_only" | "testrail_only" | "mixed";

export type PlannedCase = {
  caseId: number;
  sourceGroup: ExecutionSourceGroup;
  originalIndex: number;
};

export type MixedExecutionPlan = {
  mode: ExecutionBatchMode;
  jiraPreviewCases: PlannedCase[];
  testRailCases: PlannedCase[];
  orderedCases: PlannedCase[];
};

export type ScheduledCase = PlannedCase & {
  groupIndex: number;
  overallIndex: number;
};

export type PromotedFunctionalFailureDetails = {
  failedAtStep?: number;
  failedTarget?: string;
  failureReason?: string;
  errorMessage?: string;
  currentUrl?: string;
  matchedLocatorStrategy?: string;
};

const PROMOTED_ACTION_FAILURE_RE = /Promoted\s+([a-z_]+)\s+failed\s+at\s+step\s+(\d+)(?:\s+target="([^"]*)")?/i;
const PROMOTED_CURRENT_URL_RE = /currentUrl="([^"]+)"/i;
const PROMOTED_MATCHED_LOCATOR_RE = /matchedLocatorStrategy="([^"]+)"/i;

export function buildDiscoveryBatchChecklistIdentity(input: { jobId: string; launchId?: string }): string {
  const launchId = nonEmptyString(input.launchId);
  if (launchId) return `launch:${launchId}`;
  const jobId = nonEmptyString(input.jobId);
  return jobId ? `job:${jobId}` : "job:unknown";
}

export function resolveDiscoveryBatchIssueKeyMetadata(
  input: { jiraKey?: string; publishedCases?: Array<{ sourceIssueKey?: string }> },
): string | undefined {
  const explicit = nonEmptyString(input.jiraKey);
  if (explicit) return explicit;
  const sourceIssueKeys = new Set<string>();
  for (const entry of input.publishedCases ?? []) {
    const sourceIssueKey = nonEmptyString(entry.sourceIssueKey);
    if (sourceIssueKey) sourceIssueKeys.add(sourceIssueKey);
  }
  if (sourceIssueKeys.size !== 1) return undefined;
  const [resolved] = Array.from(sourceIssueKeys);
  return resolved;
}

export function buildDiscoveryBatchDefectDedupeKey(input: {
  jobId: string;
  caseId: number;
  scenarioId?: string;
}): string {
  const scenarioId = nonEmptyString(input.scenarioId) ?? `C${input.caseId}`;
  return `${input.jobId}::${input.caseId}::${scenarioId}`;
}

export function parsePromotedFunctionalFailure(lines: string[]): PromotedFunctionalFailureDetails {
  let failedAtStep: number | undefined;
  let failedTarget: string | undefined;
  let failureReason: string | undefined;
  let errorMessage: string | undefined;
  let currentUrl: string | undefined;
  let matchedLocatorStrategy: string | undefined;

  for (const line of lines) {
    const actionMatch = PROMOTED_ACTION_FAILURE_RE.exec(line);
    if (actionMatch) {
      const action = actionMatch[1]?.trim().toLowerCase();
      const parsedStep = Number(actionMatch[2]);
      failedAtStep = Number.isFinite(parsedStep) ? parsedStep : failedAtStep;
      failedTarget = nonEmptyString(actionMatch[3]) ?? failedTarget;
      failureReason = action ? `promoted_${action}_failed` : "promoted_action_failed";
      errorMessage ??= line;
    }
    const currentUrlMatch = PROMOTED_CURRENT_URL_RE.exec(line);
    if (currentUrlMatch) {
      currentUrl = nonEmptyString(currentUrlMatch[1]) ?? currentUrl;
    }
    const locatorMatch = PROMOTED_MATCHED_LOCATOR_RE.exec(line);
    if (locatorMatch) {
      matchedLocatorStrategy = nonEmptyString(locatorMatch[1]) ?? matchedLocatorStrategy;
    }
    if (!errorMessage && /error|failed|exception/i.test(line)) {
      errorMessage = line;
    }
  }

  return {
    failedAtStep,
    failedTarget,
    failureReason,
    errorMessage,
    currentUrl,
    matchedLocatorStrategy,
  };
}

function isPositiveCaseId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function normalizeSectionSlug(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "default-section";
}

function nonEmptyString(value: string | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

const REUSABLE_PROMOTED_STATUSES = new Set<PromotedAutomationStatus>([
  "active",
  "draft",
  "inline_debug_only",
]);

const BLOCKED_PROMOTED_STATUSES = new Set<PromotedAutomationStatus>([
  "disabled",
  "needs_page_object",
  "needs_page_method",
  "needs_component_object",
  "needs_flow",
  "blocked_missing_pom",
]);

function normalizeAppSlug(value: string | undefined): string {
  const normalized = (value ?? "").trim().toLowerCase();
  return normalized || "default";
}

function toAbsoluteFromRoot(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const normalized = value.replace(/[\\/]+/g, path.sep);
  return path.isAbsolute(normalized) ? normalized : path.resolve(ROOT, normalized);
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const rel = path.relative(rootPath, targetPath);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizePathForMatch(value: string): string {
  return value.replace(/\\/g, "/").toLowerCase();
}

function extractSectionSlugFromSpecPath(specPath: string): string | undefined {
  const normalized = normalizePathForMatch(specPath);
  const match = normalized.match(/\/sections\/([^/]+)\//);
  return match?.[1];
}

async function loadPromotedEntriesForRouting(appSlug?: string): Promise<PromotedAutomationIndexEntry[]> {
  const entries: PromotedAutomationIndexEntry[] = [];
  const globalIndex = await loadAutomationIndex();
  entries.push(...globalIndex.automations);
  const normalizedApp = nonEmptyString(appSlug);
  if (!normalizedApp) return entries;
  const appIndexPath = path.join("automations", "apps", normalizedApp, "index.json");
  const appIndex = await loadAutomationIndex(appIndexPath);
  entries.push(...appIndex.automations);
  return entries;
}

function selectCandidateEntryForCase(
  caseId: number,
  entries: PromotedAutomationIndexEntry[],
  appSlug?: string,
): PromotedAutomationIndexEntry | undefined {
  const normalizedApp = nonEmptyString(appSlug) ? normalizeAppSlug(appSlug) : undefined;
  const candidates = entries.filter((entry) => entry.caseId === caseId);
  if (candidates.length === 0) return undefined;
  if (!normalizedApp) return candidates[0];
  return candidates.find((entry) => normalizeAppSlug(entry.appSlug ?? entry.appProfile) === normalizedApp)
    ?? candidates[0];
}

export function validatePromotedEntryForExecution(input: {
  caseId: number;
  appSlug?: string;
  sectionSlug?: string;
  entry?: PromotedAutomationIndexEntry;
}): {
  reusable: boolean;
  blocked: boolean;
  reason: string;
  specPath?: string;
} {
  const entry = input.entry;
  if (!entry) {
    return { reusable: false, blocked: false, reason: "no_promoted_entry" };
  }
  if (entry.caseId !== input.caseId) {
    return { reusable: false, blocked: false, reason: "case_id_mismatch" };
  }

  const normalizedApp = nonEmptyString(input.appSlug) ? normalizeAppSlug(input.appSlug) : undefined;
  const entryApp = normalizeAppSlug(entry.appSlug ?? entry.appProfile);
  if (normalizedApp && entryApp !== normalizedApp) {
    return { reusable: false, blocked: false, reason: "app_slug_mismatch" };
  }

  if (BLOCKED_PROMOTED_STATUSES.has(entry.status)) {
    return { reusable: false, blocked: true, reason: `blocked_status_${entry.status}` };
  }
  if (!REUSABLE_PROMOTED_STATUSES.has(entry.status)) {
    return { reusable: false, blocked: false, reason: `status_${entry.status}` };
  }
  if (entry.specVerificationStatus === "failed") {
    return { reusable: false, blocked: false, reason: "spec_verification_failed" };
  }

  const specPath = toAbsoluteFromRoot(entry.specPath);
  const planPath = toAbsoluteFromRoot(entry.planPath);
  if (!specPath || !fs.existsSync(specPath)) {
    return { reusable: false, blocked: false, reason: "missing_spec_file" };
  }
  if (!planPath || !fs.existsSync(planPath)) {
    return { reusable: false, blocked: false, reason: "missing_plan_file" };
  }

  const appRoot = normalizedApp ? path.join(APPS_ROOT, normalizedApp) : undefined;
  if (appRoot && !isPathInside(appRoot, specPath)) {
    return { reusable: false, blocked: false, reason: "spec_outside_app_scope" };
  }

  const expectedSection = nonEmptyString(input.sectionSlug) ? normalizeSectionSlug(input.sectionSlug) : undefined;
  if (expectedSection) {
    const discoveredSection = extractSectionSlugFromSpecPath(specPath);
    if (discoveredSection && discoveredSection !== expectedSection) {
      return { reusable: false, blocked: false, reason: "section_slug_mismatch" };
    }
  }

  if (!/(\\|\/)c\d+/.test(specPath.toLowerCase())) {
    return { reusable: false, blocked: false, reason: "spec_not_in_case_tree" };
  }

  const appConfigPath = toAbsoluteFromRoot(entry.appConfigPath);
  if (appConfigPath && !fs.existsSync(appConfigPath)) {
    return { reusable: false, blocked: false, reason: "missing_app_config" };
  }

  return { reusable: true, blocked: false, reason: "promoted_spec_valid", specPath };
}

export function resolveRouteFromValidation(input: {
  caseId: number;
  appSlug: string;
  forceRediscovery: boolean;
  targetedDiscoverySupported?: boolean;
  contractEvaluation?: CaseContractSufficiencyResult;
  validation: {
    reusable: boolean;
    blocked: boolean;
    reason: string;
    specPath?: string;
  };
}): RouteDecision {
  if (input.forceRediscovery) {
    return {
      caseId: input.caseId,
      appSlug: input.appSlug,
      route: "full_discovery",
      reason: "explicit_rediscovery_requested",
      specPath: input.validation.specPath,
    };
  }
  if (input.validation.reusable) {
    return {
      caseId: input.caseId,
      appSlug: input.appSlug,
      route: "promoted_reuse",
      reason: input.validation.reason,
      specPath: input.validation.specPath,
    };
  }
  if (input.validation.blocked) {
    return {
      caseId: input.caseId,
      appSlug: input.appSlug,
      route: "blocked",
      reason: input.validation.reason,
      specPath: input.validation.specPath,
    };
  }
  if (input.contractEvaluation) {
    const recommendedRoute = input.contractEvaluation.recommendedRoute;
    if (recommendedRoute === "targeted_discovery" && input.targetedDiscoverySupported !== true) {
      return {
        caseId: input.caseId,
        appSlug: input.appSlug,
        route: "full_discovery",
        reason: "targeted_discovery_not_supported",
        specPath: input.validation.specPath,
      };
    }
    return {
      caseId: input.caseId,
      appSlug: input.appSlug,
      route: recommendedRoute,
      reason: input.contractEvaluation.reasonCode,
      specPath: input.validation.specPath,
    };
  }
  return {
    caseId: input.caseId,
    appSlug: input.appSlug,
    route: "full_discovery",
    reason: input.validation.reason,
    specPath: input.validation.specPath,
  };
}

function hasConfiguredRouteProfile(appConfig: Record<string, unknown> | null): boolean {
  if (!appConfig) return false;
  const profile = appConfig.routeProfile;
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) return false;
  const asRecord = profile as Record<string, unknown>;
  const entry = Array.isArray(asRecord.entry) ? asRecord.entry : [];
  const entrySteps = Array.isArray(asRecord.entrySteps) ? asRecord.entrySteps : [];
  const aliases = asRecord.aliases && typeof asRecord.aliases === "object"
    ? Object.keys(asRecord.aliases as Record<string, unknown>)
    : [];
  const domainTerms = asRecord.domainTerms && typeof asRecord.domainTerms === "object"
    ? Object.keys(asRecord.domainTerms as Record<string, unknown>)
    : [];
  return entry.length > 0 || entrySteps.length > 0 || aliases.length > 0 || domainTerms.length > 0;
}

const TARGETED_DISCOVERY_SUPPORTED = false;

export function supportsTargetedDiscoveryPreview(): boolean {
  return TARGETED_DISCOVERY_SUPPORTED;
}

export function resolveRediscoveryIntent(input: {
  forceRediscovery?: boolean;
  overwrite?: boolean;
  rerunActive?: boolean;
  executePromotedSpecs?: boolean;
}): RediscoveryIntent {
  const overwrite = input.overwrite === true;
  const rerunActive = input.rerunActive === true;
  const explicit = input.forceRediscovery === true;
  const source: RediscoveryIntentSource = explicit
    ? "user_request"
    : (overwrite || rerunActive)
      ? (input.executePromotedSpecs === true ? "legacy_default" : "job_default")
      : "none";
  return {
    explicit,
    source,
    overwrite,
    rerunActive,
  };
}

export function buildDiscoveryPreviewArgs(input: {
  previewPath: string;
  appSlug: string;
  autoPromote?: boolean;
  autoPom?: boolean;
  headed?: boolean;
  deferEvidenceConsolidation?: boolean;
}): string[] {
  const args = [
    "run",
    "discovery:preview",
    "--",
    "--input",
    input.previewPath,
    "--app",
    input.appSlug,
  ];
  if (input.autoPromote !== false) args.push("--auto-promote");
  if (input.autoPom !== false) args.push("--auto-pom");
  if (input.headed === true) args.push("--headed");
  if (input.deferEvidenceConsolidation === true) args.push("--defer-evidence-consolidation");
  return args;
}

export function computeFunctionalExecutionSnapshot(input: {
  requested: number;
  completed: number;
  executed: number;
  passed: number;
  failed: number;
  skipped: number;
}): FunctionalExecutionSnapshot {
  const requested = Math.max(0, Math.floor(input.requested));
  const completed = Math.max(0, Math.floor(input.completed));
  const executed = Math.max(0, Math.floor(input.executed));
  const passed = Math.max(0, Math.floor(input.passed));
  const failed = Math.max(0, Math.floor(input.failed));
  const skipped = Math.max(0, Math.floor(input.skipped));
  const processed = passed + failed;
  const progressPercent = requested > 0
    ? roundToTwoDecimals((completed / requested) * 100)
    : 0;
  const passRate = processed > 0
    ? roundToTwoDecimals((passed / processed) * 100)
    : null;
  return {
    requested,
    completed,
    executed,
    passed,
    failed,
    skipped,
    progressPercent,
    passRate,
  };
}

export function parseEvidenceInitializationResult(lines: string[]): {
  initialized: boolean;
  reason: string;
} {
  const initialized = lines.some((line) => /\[evidence\]\s+initialized\b/i.test(line));
  if (initialized) {
    return { initialized: true, reason: "none" };
  }
  const initFailed = lines.find((line) => /\[evidence\]\s+init failed:/i.test(line));
  if (initFailed && /outside a module|failed to load the es module/i.test(initFailed)) {
    return { initialized: false, reason: "esm_cjs_boundary_violation" };
  }
  if (lines.some((line) => /Failed to load the ES module/i.test(line))) {
    return { initialized: false, reason: "esm_cjs_boundary_violation" };
  }
  if (initFailed) {
    return { initialized: false, reason: "evidence_initialization_failed" };
  }
  if (lines.some((line) => /\[evidence\]\s+disabled\b/i.test(line))) {
    return { initialized: false, reason: "evidence_disabled" };
  }
  return { initialized: false, reason: "evidence_initialization_unknown" };
}

function resolvePublishedCaseSourceGroup(entry: PublishedCaseEntry | undefined): ExecutionSourceGroup {
  if (!entry) return "testrail_case";
  const explicitSource = (entry as { sourceType?: string }).sourceType;
  if (explicitSource === "jira_preview" || explicitSource === "testrail_case") {
    return explicitSource;
  }
  const hasPreviewOrigin = Boolean(
    nonEmptyString(entry.executionScenarioId)
    || nonEmptyString(entry.launchScenarioId)
    || nonEmptyString(entry.sourceIssueKey),
  );
  return hasPreviewOrigin ? "jira_preview" : "testrail_case";
}

export function buildMixedExecutionPlan(params: Pick<DiscoveryBatchParams, "caseIds" | "publishedCases">): MixedExecutionPlan {
  const sourceByCaseId = new Map<number, PublishedCaseEntry>();
  for (const entry of params.publishedCases ?? []) {
    if (!isPositiveCaseId(entry.caseId)) continue;
    if (!sourceByCaseId.has(entry.caseId)) {
      sourceByCaseId.set(entry.caseId, entry);
    }
  }

  const seen = new Set<number>();
  const planned: PlannedCase[] = [];
  const appendCase = (caseId: number): void => {
    if (!isPositiveCaseId(caseId) || seen.has(caseId)) return;
    seen.add(caseId);
    planned.push({
      caseId,
      sourceGroup: resolvePublishedCaseSourceGroup(sourceByCaseId.get(caseId)),
      originalIndex: planned.length,
    });
  };

  for (const caseId of params.caseIds ?? []) {
    appendCase(caseId);
  }
  for (const entry of params.publishedCases ?? []) {
    appendCase(entry.caseId);
  }

  const jiraPreviewCases = planned.filter((entry) => entry.sourceGroup === "jira_preview");
  const testRailCases = planned.filter((entry) => entry.sourceGroup === "testrail_case");
  const mode: ExecutionBatchMode = jiraPreviewCases.length > 0 && testRailCases.length > 0
    ? "mixed"
    : jiraPreviewCases.length > 0
      ? "jira_only"
      : "testrail_only";
  return {
    mode,
    jiraPreviewCases,
    testRailCases,
    orderedCases: [...jiraPreviewCases, ...testRailCases],
  };
}

export function buildCaseSchedule(plan: MixedExecutionPlan): ScheduledCase[] {
  let jiraIndex = 0;
  let trIndex = 0;
  return plan.orderedCases.map((entry, index) => {
    const groupIndex = entry.sourceGroup === "jira_preview"
      ? (jiraIndex += 1)
      : (trIndex += 1);
    return {
      ...entry,
      groupIndex,
      overallIndex: index + 1,
    };
  });
}

export function buildDiscoveryBatchArgs(params: DiscoveryBatchParams, caseIds: number[]): string[] {
  const caseIdsStr = caseIds.join(",");
  const args: string[] = [
    "run",
    "discovery:batch",
    "--",
    "--case-ids",
    caseIdsStr,
  ];

  if (params.appSlug) args.push("--app", params.appSlug);
  if (params.overwrite === true) args.push("--overwrite");
  if (params.autoPromote !== false) args.push("--auto-promote");
  if (params.autoPom !== false) args.push("--auto-pom");
  if (params.rerunActive === true) args.push("--rerun-active");
  if (params.headed) args.push("--headed");

  return args;
}

function buildContractPreviewArtifactPath(jobId: string, caseId: number): string {
  return path.join(ROOT, ".artifacts", "tmp", "case-contract-preview", jobId, `c${caseId}`, "preview-scenarios.json");
}

function buildContractPreviewEnv(params: DiscoveryBatchParams, jobId: string): NodeJS.ProcessEnv {
  const resolvedAppSlug = nonEmptyString(params.appSlug);
  const resolvedSectionSlug = nonEmptyString(params.sectionSlug);
  const resolvedSectionName = nonEmptyString(params.sectionName);
  return {
    ...(process.env as NodeJS.ProcessEnv),
    EVIDENCE_RUN_ID: jobId,
    ...(resolvedAppSlug ? { APP_SLUG: resolvedAppSlug } : {}),
    ...(resolvedSectionSlug ? { SECTION_SLUG: resolvedSectionSlug } : {}),
    ...(resolvedSectionName ? { SECTION_NAME: resolvedSectionName } : {}),
    ...(resolvedAppSlug ? { EVIDENCE_APP_SLUG: resolvedAppSlug } : {}),
    ...(resolvedSectionSlug ? { EVIDENCE_SECTION_SLUG: resolvedSectionSlug } : {}),
  };
}

export function buildTestPromotedArgs(params: DiscoveryBatchParams, caseId: number): string[] {
  const args: string[] = [
    "run",
    "test:promoted",
    "--",
    "--case-id",
    String(caseId),
    "--workers",
    "1",
  ];
  if (params.appSlug) args.push("--app", params.appSlug);
  if (params.sectionSlug) args.push("--section", params.sectionSlug);
  if (params.headed) args.push("--headed");
  return args;
}

export function buildPromotedExecutionEnv(
  params: DiscoveryBatchParams,
  jobId: string,
  baseEnv: NodeJS.ProcessEnv = process.env as NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const resolvedAppSlug = nonEmptyString(params.appSlug);
  const resolvedSectionSlug = nonEmptyString(params.sectionSlug);
  const resolvedSectionName = nonEmptyString(params.sectionName);
  const forceHeadlessForAutomation = params.headed !== true;
  return {
    ...(baseEnv as NodeJS.ProcessEnv),
    EVIDENCE_RUN_ID: jobId,
    ...(resolvedAppSlug ? { APP_SLUG: resolvedAppSlug } : {}),
    ...(resolvedSectionSlug ? { SECTION_SLUG: resolvedSectionSlug } : {}),
    ...(resolvedSectionName ? { SECTION_NAME: resolvedSectionName } : {}),
    ...(resolvedAppSlug ? { EVIDENCE_APP_SLUG: resolvedAppSlug } : {}),
    ...(resolvedSectionSlug ? { EVIDENCE_SECTION_SLUG: resolvedSectionSlug } : {}),
    ...(forceHeadlessForAutomation
      ? {
          AUTOMATION_HEADLESS: "true",
          AUTOMATION_SOURCE: "qa_lab_automatic",
        }
      : {}),
  };
}

function log(jobId: string, line: string): void {
  jobStore.appendLog(jobId, line);
}

async function runCommand(
  jobId: string,
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  onLine?: (line: string) => void,
): Promise<CommandResult> {
  const lines: string[] = [];
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(cmd, args, {
      shell: true,
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    jobStore.update(jobId, { process: child });

    const attachStream = (stream: NodeJS.ReadableStream | null | undefined): void => {
      if (!stream) return;
      let pending = "";
      stream.on("data", (chunk: Buffer) => {
        pending += chunk.toString();
        const segments = pending.split(/\r?\n/);
        pending = segments.pop() ?? "";
        for (const segment of segments) {
          const line = segment.trimEnd();
          if (!line.trim()) continue;
          lines.push(line);
          log(jobId, line);
          onLine?.(line);
        }
      });
      stream.on("end", () => {
        const line = pending.trimEnd();
        if (!line.trim()) return;
        lines.push(line);
        log(jobId, line);
        onLine?.(line);
      });
    };

    attachStream(child.stdout);
    attachStream(child.stderr);

    child.on("error", (err) => {
      jobStore.update(jobId, { process: undefined });
      reject(err);
    });
    child.on("close", (code) => {
      jobStore.update(jobId, { process: undefined });
      resolve({ exitCode: typeof code === "number" ? code : 1, lines });
    });
  });
}

function listEvidenceJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const files: string[] = [];
  const stack = [dir];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (entry.name === "evidence.json") files.push(full);
    }
  }

  return files;
}

function collectPromotedCaseIds(caseIds: number[], appSlug?: string): Set<number> {
  const targets = new Set(caseIds);
  const found = new Set<number>();
  if (targets.size === 0 || !fs.existsSync(APPS_ROOT)) return found;

  const roots = appSlug
    ? [path.join(APPS_ROOT, appSlug)]
    : fs.readdirSync(APPS_ROOT, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(APPS_ROOT, entry.name));

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    const stack = [root];
    while (stack.length > 0 && found.size < targets.size) {
      const current = stack.pop();
      if (!current) continue;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".artifacts") continue;
        const full = path.join(current, entry.name);
        const prefixedMatch = /^c(\d+)(?:$|-)/i.exec(entry.name);
        const numericMatch = /^(\d+)$/.exec(entry.name);
        const matchedId = Number(prefixedMatch?.[1] ?? numericMatch?.[1] ?? 0);
        if (targets.has(matchedId)) {
          const hasSpec = fs.existsSync(path.join(full, "case.spec.ts")) || fs.existsSync(path.join(full, "spec.ts"));
          if (hasSpec) found.add(matchedId);
        }
        stack.push(full);
      }
    }
  }

  return found;
}

function publishedEntryByCaseId(caseId: number, publishedCases: PublishedCaseEntry[] | undefined): PublishedCaseEntry | undefined {
  return (publishedCases ?? []).find((entry) => entry.caseId === caseId);
}

type EvidenceStepSnapshot = {
  stepIndex?: number;
  action?: string;
  target?: string;
  status?: string;
  errorMessage?: string;
  screenshotPath?: string;
  evidencePath?: string;
};

type CaseEvidenceFailureSnapshot = {
  scenarioId?: string;
  scenarioTitle?: string;
  failedAtStep?: number;
  failedTarget?: string;
  errorMessage?: string;
  screenshotPath?: string;
  evidenceJsonPath?: string;
  lastSuccessfulStep?: {
    stepIndex: number;
    action?: string;
    target?: string;
    evidencePath?: string;
  };
};

function readCaseEvidenceFailureSnapshot(input: {
  runId: string;
  caseId: number;
  appSlug?: string;
  sectionSlug?: string;
  sectionName?: string;
}): CaseEvidenceFailureSnapshot | undefined {
  const safeAppSlug = (input.appSlug ?? "").trim() || "default";
  const safeSectionSlug = normalizeSectionSlug(input.sectionSlug);
  const runPaths = buildEvidenceRunPaths({
    appSlug: safeAppSlug,
    sectionSlug: safeSectionSlug,
    sectionName: input.sectionName,
    runId: input.runId,
  });
  const candidateEvidencePath = path.join(runPaths.scenariosDir, `C${input.caseId}`, "evidence.json");
  if (!fs.existsSync(candidateEvidencePath)) return undefined;
  try {
    const raw = fs.readFileSync(candidateEvidencePath, "utf-8");
    const parsed = JSON.parse(raw) as {
      scenarioId?: string;
      scenarioTitle?: string;
      steps?: EvidenceStepSnapshot[];
    };
    const steps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const failedStep = steps.find((step) => String(step.status ?? "").toLowerCase() === "failed");
    const failedAtStep = typeof failedStep?.stepIndex === "number" ? failedStep.stepIndex : undefined;
    const failedTarget = nonEmptyString(failedStep?.target);
    const errorMessage = nonEmptyString(failedStep?.errorMessage);
    const screenshotPath = nonEmptyString(failedStep?.screenshotPath) ?? nonEmptyString(failedStep?.evidencePath);
    const successfulSteps = steps
      .filter((step) => String(step.status ?? "").toLowerCase() === "passed" && typeof step.stepIndex === "number")
      .sort((a, b) => Number(a.stepIndex ?? 0) - Number(b.stepIndex ?? 0));
    const lastSuccessful = successfulSteps[successfulSteps.length - 1];
    return {
      scenarioId: nonEmptyString(parsed.scenarioId),
      scenarioTitle: nonEmptyString(parsed.scenarioTitle),
      failedAtStep,
      failedTarget,
      errorMessage,
      screenshotPath,
      evidenceJsonPath: candidateEvidencePath,
      lastSuccessfulStep: lastSuccessful && typeof lastSuccessful.stepIndex === "number"
        ? {
            stepIndex: lastSuccessful.stepIndex,
            action: nonEmptyString(lastSuccessful.action),
            target: nonEmptyString(lastSuccessful.target),
            evidencePath: nonEmptyString(lastSuccessful.evidencePath) ?? nonEmptyString(lastSuccessful.screenshotPath),
          }
        : undefined,
    };
  } catch (err: any) {
    console.warn(
      `[defect-checklist] unable to parse evidence snapshot runId=${input.runId} caseId=${input.caseId} error=${err?.message ?? String(err)}`,
    );
    return undefined;
  }
}

function countDefectsForJob(list: Checklist, jobId: string): number {
  return list.defects.filter((defect) => defect.jobId === jobId).length;
}

function parseNumericCaseId(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const normalized = trimmed.startsWith("C") ? trimmed.slice(1) : trimmed;
  const parsed = Number(normalized);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function upsertChecklistDefect(input: {
  list: Checklist;
  checklistIdentity: string;
  jobId: string;
  caseId: number;
  scenarioId: string;
  scenarioTitle: string;
  failureReasonText: string;
  expectedResult?: string;
  technicalContext?: Defect["technicalContext"];
  evidencePath?: string;
}): { action: "created" | "updated"; defectCount: number; dedupeKey: string } {
  const now = new Date().toISOString();
  const dedupeKey = buildDiscoveryBatchDefectDedupeKey({
    jobId: input.jobId,
    caseId: input.caseId,
    scenarioId: input.scenarioId,
  });
  const severity = inferDefectSeverity(input.failureReasonText, input.scenarioId, input.scenarioTitle);
  const description = buildStructuredDefectDescription({
    scenarioId: input.scenarioId,
    scenarioTitle: input.scenarioTitle,
    failureReason: input.failureReasonText,
    technicalContext: input.technicalContext,
    jobId: input.jobId,
  });
  const title = buildDefectTitle({
    scenarioId: input.scenarioId,
    scenarioTitle: input.scenarioTitle,
    severity: severity.severity,
    technicalContext: input.technicalContext,
    failureReason: input.failureReasonText,
    expectedResult: input.expectedResult,
  });
  const existing = input.list.defects.find((defect) => {
    const context = defect.technicalContext;
    if (context?.dedupeKey === dedupeKey) return true;
    const existingCaseId = parseNumericCaseId(context?.testRailCaseId ?? context?.caseId);
    return defect.jobId === input.jobId && existingCaseId === input.caseId;
  });
  if (existing) {
    existing.jobId = input.jobId;
    existing.scenarioId = input.scenarioId;
    existing.scenarioTitle = input.scenarioTitle;
    existing.description = description;
    existing.severity = severity.severity;
    existing.severityReason = severity.severityReason;
    existing.title = title;
    existing.evidenceUrl = input.evidencePath;
    existing.technicalContext = input.technicalContext;
    existing.updatedAt = now;
    input.list.updatedAt = now;
    defectChecklistStore.persist();
    return {
      action: "updated",
      defectCount: countDefectsForJob(input.list, input.jobId),
      dedupeKey,
    };
  }
  defectChecklistStore.addDefect(input.checklistIdentity, {
    description,
    severity: severity.severity,
    severityReason: severity.severityReason,
    jobId: input.jobId,
    scenarioId: input.scenarioId,
    scenarioTitle: input.scenarioTitle,
    title,
    evidenceUrl: input.evidencePath,
    technicalContext: input.technicalContext,
  });
  const refreshed = defectChecklistStore.get(input.checklistIdentity) ?? input.list;
  return {
    action: "created",
    defectCount: countDefectsForJob(refreshed, input.jobId),
    dedupeKey,
  };
}

export async function consolidateRunEvidenceForExecution(
  runId: string,
  appSlug: string | undefined,
  sectionSlug: string | undefined,
  sectionName: string | undefined,
): Promise<ConsolidationResult> {
  const safeAppSlug = (appSlug ?? "").trim() || "default";
  const safeSectionSlug = normalizeSectionSlug(sectionSlug);
  const paths = buildEvidenceRunPaths({
    appSlug: safeAppSlug,
    sectionSlug: safeSectionSlug,
    sectionName,
    runId,
  });
  const evidenceFiles = listEvidenceJsonFiles(paths.scenariosDir);
  if (evidenceFiles.length === 0) {
    return {
      attempted: true,
      generated: false,
      documentPathPresent: false,
      scenarioEvidenceCount: 0,
      error: "no_scenario_evidence_found",
    };
  }

  try {
    const recorder = new RunEvidenceRecorder({
      appSlug: safeAppSlug,
      sectionSlug: safeSectionSlug,
      sectionName,
      runId,
    });
    await recorder.start();
    for (const evidenceJsonPath of evidenceFiles) {
      await recorder.addScenarioFromFile(evidenceJsonPath);
    }
    await recorder.finish();
    const generated = fs.existsSync(paths.docxPath);
    return {
      attempted: true,
      generated,
      documentPathPresent: generated,
      ...(generated ? { documentPath: paths.docxPath } : {}),
      scenarioEvidenceCount: evidenceFiles.length,
      ...(generated ? {} : { error: "consolidated_docx_missing" }),
    };
  } catch (err: any) {
    return {
      attempted: true,
      generated: false,
      documentPathPresent: false,
      scenarioEvidenceCount: evidenceFiles.length,
      error: err?.message ?? String(err),
    };
  }
}

export function buildDiscoveryBatchExecutionPlan(
  requestedCaseIds: number[],
  promotedBefore: Set<number>,
  promotedAfter: Set<number>,
): DiscoveryBatchExecutionPlan {
  const requested = Array.from(new Set(requestedCaseIds.filter(isPositiveCaseId)));
  const alreadyPromotedCaseIds = requested.filter((id) => promotedBefore.has(id));
  const executableCaseIds = requested.filter((id) => promotedAfter.has(id));
  const notExecutableCaseIds = requested.filter((id) => !promotedAfter.has(id));
  const requiresDiscoveryCaseIds = requested.filter((id) => !promotedBefore.has(id));
  return {
    requestedCaseIds: requested,
    alreadyPromotedCaseIds,
    executableCaseIds,
    notExecutableCaseIds,
    requiresDiscoveryCaseIds,
  };
}

function startLegacyDiscoveryBatchRun(jobId: string, params: DiscoveryBatchParams): void {
  const caseIds = Array.from(new Set((params.caseIds ?? []).filter(isPositiveCaseId)));
  if (caseIds.length === 0) {
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
    });
    log(jobId, "[run:discovery-batch] Error: no caseIds provided");
    return;
  }

  const caseIdsStr = caseIds.join(",");
  const args = buildDiscoveryBatchArgs(params, caseIds);
  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";

  log(jobId, `[run:discovery-batch] caseIds=${caseIdsStr} appSlug=${params.appSlug ?? "N/A"}`);
  log(jobId, `[run:discovery-batch] command=${cmd} ${args.join(" ")}`);
  log(jobId, `[run:discovery-batch] jobId=${jobId}`);
  log(jobId, "[run:discovery-batch] started");

  jobStore.update(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
    summary: {
      totalStories: 0,
      synced: 0,
      passed: 0,
      failed: 0,
      caseIds,
      command: `${cmd} ${args.join(" ")}`,
    },
  });

  void runCommand(jobId, cmd, args, process.env as NodeJS.ProcessEnv)
    .then((result) => {
      jobStore.update(jobId, {
        status: result.exitCode === 0 ? "done" : "failed",
        completedAt: new Date().toISOString(),
        exitCode: result.exitCode,
      });
      log(jobId, `[run:discovery-batch] Proceso terminado — código de salida: ${result.exitCode}`);
    })
    .catch((err: any) => {
      jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
      log(jobId, `[run:discovery-batch] Error al iniciar proceso: ${err.message}`);
    });
}

async function startDiscoveryBatchExecutionFlow(jobId: string, params: DiscoveryBatchParams): Promise<void> {
  const mixedPlan = buildMixedExecutionPlan({
    caseIds: params.caseIds ?? [],
    publishedCases: params.publishedCases,
  });
  const scheduledCases = buildCaseSchedule(mixedPlan);
  const executionCaseIds = scheduledCases.map((entry) => entry.caseId);
  if (executionCaseIds.length === 0) {
    jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
    log(jobId, "[run:discovery-batch] Error: no caseIds provided");
    return;
  }

  const planOrder = mixedPlan.mode === "mixed"
    ? "jira_preview_then_testrail"
    : mixedPlan.mode === "jira_only"
      ? "jira_only"
      : "testrail_only";
  log(
    jobId,
    `[execution-plan] jobId=${jobId} mode=${mixedPlan.mode} jiraPreviewCount=${mixedPlan.jiraPreviewCases.length} testRailCount=${mixedPlan.testRailCases.length} total=${scheduledCases.length} order=${planOrder}`,
  );

  const cmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const requestedAppSlug = nonEmptyString(params.appSlug);
  const effectiveAppSlug = requestedAppSlug ?? "default";
  const rediscoveryIntent = resolveRediscoveryIntent({
    forceRediscovery: params.forceRediscovery,
    overwrite: params.overwrite,
    rerunActive: params.rerunActive,
    executePromotedSpecs: params.executePromotedSpecs,
  });
  const forceRediscovery = rediscoveryIntent.explicit;
  const targetedDiscoverySupported = supportsTargetedDiscoveryPreview();
  const routeDecisions = new Map<number, RouteDecision>();
  const fullDiscoveryCommandParams: DiscoveryBatchParams = {
    ...params,
    overwrite: forceRediscovery ? params.overwrite : false,
    rerunActive: forceRediscovery ? params.rerunActive : false,
  };
  const promotedEntriesBefore = await loadPromotedEntriesForRouting(effectiveAppSlug);
  const appConfig = await loadAppConfig(effectiveAppSlug);
  const routeProfileConfigured = hasConfiguredRouteProfile(appConfig);
  let testRailClient: TestRailClient | null = null;
  let testRailClientError: string | undefined;
  if (!forceRediscovery) {
    try {
      testRailClient = new TestRailClient(requireTestRailConfig(config));
    } catch (err: any) {
      testRailClientError = err?.message ?? String(err);
    }
  }

  const initialSnapshot = computeFunctionalExecutionSnapshot({
    requested: executionCaseIds.length,
    completed: 0,
    executed: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
  });
  const baseSummary = {
    totalStories: initialSnapshot.requested,
    total: initialSnapshot.requested,
    synced: 0,
    passed: initialSnapshot.passed,
    failed: initialSnapshot.failed,
    completed: initialSnapshot.completed,
    requested: initialSnapshot.requested,
    executed: initialSnapshot.executed,
    skipped: initialSnapshot.skipped,
    progressPercent: initialSnapshot.progressPercent,
    progress: initialSnapshot.progressPercent,
    passRate: initialSnapshot.passRate,
    caseIds: executionCaseIds,
    requestedCases: initialSnapshot.requested,
    executedCases: initialSnapshot.executed,
    notExecutableCases: 0,
    command: `${cmd} run test:promoted -- --workers 1`,
  };
  const checklistIdentity = buildDiscoveryBatchChecklistIdentity({
    jobId,
    launchId: params.launchId,
  });
  const checklistIssueKeyMetadata = resolveDiscoveryBatchIssueKeyMetadata(params);
  const checklistList = defectChecklistStore.getOrCreate(checklistIdentity);
  const checklistUrl = `/checklist/${checklistList.urlSlug}`;
  const initialDefectCount = countDefectsForJob(checklistList, jobId);

  jobStore.update(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
    summary: baseSummary,
    checklistUrl,
    defectCount: initialDefectCount,
    ...(checklistIssueKeyMetadata ? { issueKey: checklistIssueKeyMetadata } : {}),
  });
  log(
    jobId,
    `[defect-checklist] started identity=${checklistIdentity} issueKey=${checklistIssueKeyMetadata ?? "none"} defectCount=${initialDefectCount}`,
  );

  if (params.launchId) {
    updateLaunchManifestJobId(params.launchId, jobId);
  }

  let passed = 0;
  let failed = 0;
  let completed = 0;
  let executed = 0;
  let skipped = 0;
  let nonExecutableFailed = 0;
  let synced = 0;
  let syncFailed = 0;
  let evidenceInitializationFailures = 0;
  const caseResults: CaseExecutionResult[] = [];
  const groupCaseCount: Record<ExecutionSourceGroup, number> = {
    jira_preview: mixedPlan.jiraPreviewCases.length,
    testrail_case: mixedPlan.testRailCases.length,
  };
  const groupStartedAt = new Map<ExecutionSourceGroup, number>();
  const markGroupStart = (sourceGroup: ExecutionSourceGroup): void => {
    groupStartedAt.set(sourceGroup, Date.now());
    log(
      jobId,
      `[source-group] jobId=${jobId} sourceGroup=${sourceGroup} action=start caseCount=${groupCaseCount[sourceGroup]} durationMs=0 reason=none`,
    );
  };
  const markGroupEnd = (sourceGroup: ExecutionSourceGroup, action: "completed" | "skipped", reason: string): void => {
    const startedAt = groupStartedAt.get(sourceGroup);
    const durationMs = startedAt ? Math.max(0, Date.now() - startedAt) : 0;
    log(
      jobId,
      `[source-group] jobId=${jobId} sourceGroup=${sourceGroup} action=${action} caseCount=${groupCaseCount[sourceGroup]} durationMs=${durationMs} reason=${reason}`,
    );
  };
  if (groupCaseCount.jira_preview === 0) {
    markGroupEnd("jira_preview", "skipped", "empty_group");
  }
  if (groupCaseCount.testrail_case === 0) {
    markGroupEnd("testrail_case", "skipped", "empty_group");
  }
  let activeGroup: ExecutionSourceGroup | undefined;

  const updateProgressSummary = (caseId: number): FunctionalExecutionSnapshot => {
    const snapshot = computeFunctionalExecutionSnapshot({
      requested: executionCaseIds.length,
      completed,
      executed,
      passed,
      failed,
      skipped,
    });
    jobStore.update(jobId, {
      summary: {
        ...(jobStore.get(jobId)?.summary ?? baseSummary),
        completed: snapshot.completed,
        requested: snapshot.requested,
        executed: snapshot.executed,
        passed: snapshot.passed,
        failed: snapshot.failed,
        skipped: snapshot.skipped,
        progressPercent: snapshot.progressPercent,
        progress: snapshot.progressPercent,
        passRate: snapshot.passRate,
        requestedCases: snapshot.requested,
        executedCases: snapshot.executed,
        notExecutableCases: nonExecutableFailed,
        caseResults: [...caseResults],
        evidenceInitializationFailures,
        synced,
        syncFailed,
      },
    });
    log(
      jobId,
      `[functional-case-result] jobId=${jobId} caseId=${caseId} completed=${snapshot.completed} requested=${snapshot.requested} executed=${snapshot.executed} passed=${snapshot.passed} failed=${snapshot.failed} skipped=${snapshot.skipped} progressPercent=${snapshot.progressPercent} passRate=${snapshot.passRate ?? "null"}`,
    );
    return snapshot;
  };
  const syncChecklistMetadata = (): number => {
    const list = defectChecklistStore.get(checklistIdentity) ?? checklistList;
    const defectCount = countDefectsForJob(list, jobId);
    jobStore.update(jobId, {
      checklistUrl,
      defectCount,
      ...(checklistIssueKeyMetadata ? { issueKey: checklistIssueKeyMetadata } : {}),
    });
    return defectCount;
  };

  const recordPreFunctionalFailure = async (input: {
    caseId: number;
    sourceGroup: ExecutionSourceGroup;
    scenarioId: string;
    scenarioTitle: string;
    reasonCode: string;
    errorMessage: string;
    durationMs: number;
    completedAt: string;
    caseLifecycleStartedAt: number;
    groupIndex: number;
    overallIndex: number;
  }): Promise<void> => {
    completed += 1;
    failed += 1;
    nonExecutableFailed += 1;
    caseResults.push({
      caseId: input.caseId,
      status: "failed",
      completedAt: input.completedAt,
      durationMs: input.durationMs,
      reason: input.reasonCode,
      scenarioId: input.scenarioId,
      scenarioTitle: input.scenarioTitle,
      sourceType: input.sourceGroup,
      appSlug: nonEmptyString(params.appSlug),
      sectionSlug: nonEmptyString(params.sectionSlug),
      launchId: nonEmptyString(params.launchId),
      failureReason: input.reasonCode,
      errorMessage: input.errorMessage,
    });

    const checklist = defectChecklistStore.getOrCreate(checklistIdentity);
    const upsertResult = upsertChecklistDefect({
      list: checklist,
      checklistIdentity,
      jobId,
      caseId: input.caseId,
      scenarioId: input.scenarioId,
      scenarioTitle: input.scenarioTitle,
      failureReasonText: input.errorMessage,
      technicalContext: {
        dedupeKey: buildDiscoveryBatchDefectDedupeKey({ jobId, caseId: input.caseId, scenarioId: input.scenarioId }),
        reasonCode: input.reasonCode,
        discoveryStatus: "failed",
        rawError: input.errorMessage,
        testRailCaseId: input.caseId,
        testRailRunId: params.testRunId,
        caseId: input.caseId,
        scenarioId: input.scenarioId,
        sourceType: input.sourceGroup,
        appSlug: nonEmptyString(params.appSlug),
        sectionSlug: nonEmptyString(params.sectionSlug),
        status: "failed",
        failureReason: input.reasonCode,
        errorMessage: input.errorMessage,
        launchId: nonEmptyString(params.launchId),
      },
    });
    const defectCount = syncChecklistMetadata();
    log(
      jobId,
      `[defect-checklist] upsert key=${upsertResult.dedupeKey} identity=${checklistIdentity} caseId=${input.caseId} scenarioId=${input.scenarioId} action=${upsertResult.action} defectCount=${defectCount} sourceType=${input.sourceGroup}`,
    );

    log(
      jobId,
      `[execution-phase] jobId=${jobId} caseId=${input.caseId} phase=functional durationMs=${input.durationMs} result=failed reason=${input.reasonCode}`,
    );
    log(
      jobId,
      `[case-lifecycle] jobId=${jobId} caseId=${input.caseId} sourceGroup=${input.sourceGroup} phase=functional result=failed durationMs=${input.durationMs} reason=${input.reasonCode}`,
    );

    if (params.testRunId && isPositiveCaseId(params.testRunId)) {
      const syncResult = await syncDiscoveryResultToTestRail({
        runId: params.testRunId,
        caseId: input.caseId,
        scenarioId: input.scenarioId,
        discoveryStatus: "failed",
        title: input.scenarioTitle,
        errorMessage: input.errorMessage,
        durationMs: input.durationMs,
        launchId: params.launchId,
        appSlug: params.appSlug,
        sectionSlug: params.sectionSlug,
      });
      if (syncResult.syncStatus === "synced") synced += 1;
      if (syncResult.syncStatus === "failed") syncFailed += 1;

      if (params.launchId) {
        updateLaunchManifestWithResult(
          params.launchId,
          {
            scenarioId: input.scenarioId,
            caseId: input.caseId,
            discoveryStatus: "failed",
            testRailStatusId: syncResult.statusId,
            syncStatus: syncResult.syncStatus,
            syncedAt: syncResult.syncedAt,
            error: syncResult.error,
          },
          scheduledCases.length,
        );
      }
    }

    log(
      jobId,
      `[case-lifecycle] jobId=${jobId} caseId=${input.caseId} sourceGroup=${input.sourceGroup} phase=result result=failed durationMs=${Math.max(0, Date.now() - input.caseLifecycleStartedAt)} reason=${input.reasonCode}`,
    );
    log(
      jobId,
      `[case-schedule] jobId=${jobId} caseId=${input.caseId} sourceGroup=${input.sourceGroup} groupIndex=${input.groupIndex} overallIndex=${input.overallIndex} action=failed`,
    );
    updateProgressSummary(input.caseId);
  };

  for (const scheduledCase of scheduledCases) {
    const caseId = scheduledCase.caseId;
    const sourceGroup = scheduledCase.sourceGroup;
    if (activeGroup !== sourceGroup) {
      if (activeGroup) {
        markGroupEnd(activeGroup, "completed", "group_cases_processed");
      }
      markGroupStart(sourceGroup);
      activeGroup = sourceGroup;
    }
    const caseLifecycleStartedAt = Date.now();
    log(
      jobId,
      `[case-schedule] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} groupIndex=${scheduledCase.groupIndex} overallIndex=${scheduledCase.overallIndex} action=start`,
    );

    jobStore.update(jobId, {
      currentCase: `C${caseId}`,
      summary: {
        ...(jobStore.get(jobId)?.summary ?? baseSummary),
        currentCaseIndex: scheduledCase.overallIndex,
        totalCases: executionCaseIds.length,
      },
    });

    const resolveStartedAt = Date.now();
    const candidate = selectCandidateEntryForCase(caseId, promotedEntriesBefore, effectiveAppSlug);
    const validation = validatePromotedEntryForExecution({
      caseId,
      appSlug: effectiveAppSlug,
      sectionSlug: params.sectionSlug,
      entry: candidate,
    });
    let contractEvaluation: CaseContractSufficiencyResult | undefined;
    let contractScenario: ReturnType<typeof buildMcpScenarioContractFromTestRailCase> | undefined;
    let contractMetadata: ReturnType<typeof extractCaseContractMetadata> | undefined;
    let contractSectionId: number | string | undefined;
    let contractValidationResult: "completed" | "skipped" | "failed" = "skipped";
    let contractValidationReason = validation.reason;
    const contractValidationStartedAt = Date.now();

    log(
      jobId,
      `[rediscovery-intent] jobId=${jobId} caseId=${caseId} explicit=${rediscoveryIntent.explicit} source=${rediscoveryIntent.source} overwrite=${rediscoveryIntent.overwrite} rerunActive=${rediscoveryIntent.rerunActive}`,
    );

    if (!validation.reusable && !validation.blocked && !forceRediscovery) {
      if (!testRailClient) {
        contractValidationResult = "failed";
        contractValidationReason = "case_contract_fetch_unavailable";
        log(
          jobId,
          `[case-contract-evaluation] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} sufficient=false recommendedRoute=full_discovery gapCount=0 reason=${testRailClientError ?? contractValidationReason}`,
        );
      } else {
        try {
          const rawCase: RawTestRailCase = await testRailClient.getCase(caseId);
          const normalizedCase = normalizeTestRailCase(rawCase);
          contractMetadata = extractCaseContractMetadata(rawCase);
          contractScenario = buildMcpScenarioContractFromTestRailCase({
            scenario: normalizedCase,
            appSlug: effectiveAppSlug,
            metadata: contractMetadata,
          });
          contractSectionId = normalizedCase.sectionId;
          contractEvaluation = evaluateCaseContractSufficiency({
            scenario: contractScenario,
            appSlug: effectiveAppSlug,
            sectionSlug: params.sectionSlug,
            metadata: contractMetadata,
            hasRouteProfileConfig: routeProfileConfigured,
          });
          contractValidationReason = contractEvaluation.reasonCode;
          contractValidationResult = contractEvaluation.recommendedRoute === "blocked"
            ? "failed"
            : "completed";
          log(
            jobId,
            `[case-contract-evaluation] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} sufficient=${contractEvaluation.sufficient} recommendedRoute=${contractEvaluation.recommendedRoute} gapCount=${contractEvaluation.gaps.length} reason=${contractEvaluation.reasonCode}`,
          );
        } catch (err: any) {
          contractValidationResult = "failed";
          contractValidationReason = "case_contract_fetch_failed";
          log(
            jobId,
            `[case-contract-evaluation] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} sufficient=false recommendedRoute=full_discovery gapCount=0 reason=${contractValidationReason}:${err?.message ?? String(err)}`,
          );
        }
      }
    } else if (forceRediscovery) {
      contractValidationReason = "explicit_rediscovery_requested";
    } else if (validation.blocked) {
      contractValidationResult = "failed";
      contractValidationReason = validation.reason;
    } else if (validation.reusable) {
      contractValidationReason = "promoted_spec_valid";
    }

    let route = resolveRouteFromValidation({
      caseId,
      appSlug: effectiveAppSlug,
      forceRediscovery,
      targetedDiscoverySupported,
      contractEvaluation,
      validation,
    });
    if (route.reason === "targeted_discovery_not_supported" && contractValidationResult === "completed") {
      contractValidationReason = "targeted_discovery_not_supported";
    }
    routeDecisions.set(caseId, route);
    log(
      jobId,
      `[execution-route] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} route=${route.route} reason=${route.reason} specPath=${route.specPath ?? "none"}`,
    );
    const resolveDurationMs = Math.max(0, Date.now() - resolveStartedAt);
    log(
      jobId,
      `[execution-phase] jobId=${jobId} caseId=${caseId} phase=resolve durationMs=${resolveDurationMs} result=completed reason=${route.reason}`,
    );
    log(
      jobId,
      `[execution-phase] jobId=${jobId} caseId=${caseId} phase=contract_validation durationMs=${Math.max(0, Date.now() - contractValidationStartedAt)} result=${contractValidationResult} reason=${contractValidationReason}`,
    );
    log(
      jobId,
      `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=contract_validation result=${contractValidationResult} durationMs=${Math.max(0, Date.now() - contractValidationStartedAt)} reason=${contractValidationReason}`,
    );
    log(
      jobId,
      `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=resolve result=completed durationMs=${resolveDurationMs} reason=${route.reason}`,
    );

    const prepareStartedAt = Date.now();
    let prepareResult: "completed" | "skipped" | "failed" = "skipped";
    let prepareReason = route.reason;
    let promotionResult: "completed" | "skipped" | "failed" = route.route === "promoted_reuse" ? "skipped" : "completed";
    let promotionReason = route.route === "promoted_reuse" ? "promoted_reuse" : route.reason;
    let promotionDurationMs = 0;

    const runFullDiscoveryForCase = async (currentRoute: RouteDecision): Promise<RouteDecision> => {
      const fullDiscoveryArgs = buildDiscoveryBatchArgs(fullDiscoveryCommandParams, [caseId]);
      let discoveredState: string | undefined;
      let discoveryDurationMs = 0;
      log(jobId, `[run:discovery-batch] caseIds=${caseId} appSlug=${params.appSlug ?? "N/A"}`);
      log(jobId, `[run:discovery-batch] command=${cmd} ${fullDiscoveryArgs.join(" ")}`);
      const discoveryResult = await runCommand(
        jobId,
        cmd,
        fullDiscoveryArgs,
        process.env as NodeJS.ProcessEnv,
        (line) => {
          const match = DISCOVERY_CASE_FINISHED_RE.exec(line);
          if (!match) return;
          const parsedCaseId = Number(match[1]);
          if (parsedCaseId !== caseId) return;
          discoveredState = match[2].toLowerCase();
          const parsedDuration = Number(match[3] ?? 0);
          if (Number.isFinite(parsedDuration) && parsedDuration >= 0) {
            discoveryDurationMs = parsedDuration;
          }
        },
      );

      if (discoveryResult.exitCode !== 0) {
        const blockedRoute: RouteDecision = {
          caseId,
          appSlug: effectiveAppSlug,
          route: "blocked",
          reason: "full_discovery_failed",
          specPath: currentRoute.specPath,
        };
        prepareResult = "failed";
        prepareReason = "full_discovery_failed";
        promotionResult = "failed";
        promotionReason = "full_discovery_failed";
        log(
          jobId,
          `[execution-phase] jobId=${jobId} caseId=${caseId} phase=full_discovery durationMs=${discoveryDurationMs} result=failed reason=full_discovery_failed`,
        );
        return blockedRoute;
      }

      const promotedEntriesAfter = await loadPromotedEntriesForRouting(effectiveAppSlug);
      const promotedCandidate = selectCandidateEntryForCase(caseId, promotedEntriesAfter, effectiveAppSlug);
      const promotedValidation = validatePromotedEntryForExecution({
        caseId,
        appSlug: effectiveAppSlug,
        sectionSlug: params.sectionSlug,
        entry: promotedCandidate,
      });
      if (promotedValidation.reusable) {
        const discoveredRoute: RouteDecision = {
          caseId,
          appSlug: effectiveAppSlug,
          route: "full_discovery",
          reason: discoveredState === "promoted" ? "full_discovery_promoted" : "promoted_spec_valid_after_full_discovery",
          specPath: promotedValidation.specPath,
        };
        prepareResult = "completed";
        prepareReason = discoveredRoute.reason;
        promotionResult = "completed";
        promotionReason = "handled_inside_discovery_batch";
        log(
          jobId,
          `[execution-phase] jobId=${jobId} caseId=${caseId} phase=full_discovery durationMs=${discoveryDurationMs} result=completed reason=${discoveredState ?? "completed"}`,
        );
        log(
          jobId,
          `[execution-phase] jobId=${jobId} caseId=${caseId} phase=pom durationMs=0 result=completed reason=handled_inside_discovery_batch`,
        );
        log(
          jobId,
          `[execution-phase] jobId=${jobId} caseId=${caseId} phase=promotion durationMs=0 result=completed reason=handled_inside_discovery_batch`,
        );
        return discoveredRoute;
      }

      const blockedReason = discoveredState
        ? `full_discovery_${discoveredState}`
        : promotedValidation.blocked
          ? promotedValidation.reason
          : `full_discovery_${promotedValidation.reason}`;
      prepareResult = "failed";
      prepareReason = blockedReason;
      promotionResult = "failed";
      promotionReason = blockedReason;
      log(
        jobId,
        `[execution-phase] jobId=${jobId} caseId=${caseId} phase=full_discovery durationMs=${discoveryDurationMs} result=failed reason=${blockedReason}`,
      );
      log(
        jobId,
        `[execution-phase] jobId=${jobId} caseId=${caseId} phase=pom durationMs=0 result=failed reason=${blockedReason}`,
      );
      log(
        jobId,
        `[execution-phase] jobId=${jobId} caseId=${caseId} phase=promotion durationMs=0 result=failed reason=${blockedReason}`,
      );
      return {
        caseId,
        appSlug: effectiveAppSlug,
        route: "blocked",
        reason: blockedReason,
        specPath: promotedValidation.specPath,
      };
    };

    if (route.route === "automation_from_case_contract" || route.route === "targeted_discovery") {
      if (!contractScenario || !contractMetadata) {
        route = {
          caseId,
          appSlug: effectiveAppSlug,
          route: "full_discovery",
          reason: "case_contract_missing_for_fast_path",
          specPath: route.specPath,
        };
        log(
          jobId,
          `[execution-route] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} route=full_discovery reason=case_contract_missing_for_fast_path specPath=${route.specPath ?? "none"}`,
        );
      } else {
        const previewPreparationStartedAt = Date.now();
        const previewPath = buildContractPreviewArtifactPath(jobId, caseId);
        fs.mkdirSync(path.dirname(previewPath), { recursive: true });
        const virtualCase = buildVirtualCaseFromContract({
          scenario: contractScenario,
          index: 0,
          sectionSlug: params.sectionSlug,
          sectionName: params.sectionName,
          sectionId: contractSectionId,
          testRailCaseId: caseId,
          metadata: contractMetadata,
        });
        fs.writeFileSync(previewPath, JSON.stringify([virtualCase], null, 2), "utf-8");
        const previewArgs = buildDiscoveryPreviewArgs({
          previewPath,
          appSlug: effectiveAppSlug,
          autoPromote: params.autoPromote,
          autoPom: params.autoPom,
          headed: params.headed,
          deferEvidenceConsolidation: true,
        });
        const previewPreparationDurationMs = Math.max(0, Date.now() - previewPreparationStartedAt);
        log(
          jobId,
          `[execution-phase] jobId=${jobId} caseId=${caseId} phase=preview_preparation durationMs=${previewPreparationDurationMs} result=completed reason=${route.reason}`,
        );
        log(jobId, `[run:discovery-preview] caseId=${caseId} appSlug=${effectiveAppSlug}`);
        log(jobId, `[run:discovery-preview] command=${cmd} ${previewArgs.join(" ")}`);
        const previewStartedAt = Date.now();
        const previewResult = await runCommand(jobId, cmd, previewArgs, buildContractPreviewEnv(params, jobId));
        const previewDurationMs = Math.max(0, Date.now() - previewStartedAt);
        if (route.route === "targeted_discovery") {
          log(
            jobId,
            `[execution-phase] jobId=${jobId} caseId=${caseId} phase=targeted_discovery durationMs=${previewDurationMs} result=${previewResult.exitCode === 0 ? "completed" : "failed"} reason=${route.reason}`,
          );
        }

        if (previewResult.exitCode !== 0) {
          route = {
            caseId,
            appSlug: effectiveAppSlug,
            route: "full_discovery",
            reason: `${route.route}_pipeline_failed`,
            specPath: route.specPath,
          };
          log(
            jobId,
            `[execution-route] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} route=full_discovery reason=${route.reason} specPath=${route.specPath ?? "none"}`,
          );
        } else {
          const promotedEntriesAfterPreview = await loadPromotedEntriesForRouting(effectiveAppSlug);
          const promotedCandidate = selectCandidateEntryForCase(caseId, promotedEntriesAfterPreview, effectiveAppSlug);
          const promotedValidation = validatePromotedEntryForExecution({
            caseId,
            appSlug: effectiveAppSlug,
            sectionSlug: params.sectionSlug,
            entry: promotedCandidate,
          });
          if (promotedValidation.reusable) {
            route = {
              caseId,
              appSlug: effectiveAppSlug,
              route: route.route,
              reason: `${route.route}_promoted`,
              specPath: promotedValidation.specPath,
            };
            prepareResult = "completed";
            prepareReason = route.reason;
            promotionResult = "completed";
            promotionReason = "handled_inside_discovery_preview";
            promotionDurationMs = previewDurationMs;
            log(
              jobId,
              `[execution-phase] jobId=${jobId} caseId=${caseId} phase=pom durationMs=${previewDurationMs} result=completed reason=handled_inside_discovery_preview`,
            );
            log(
              jobId,
              `[execution-phase] jobId=${jobId} caseId=${caseId} phase=promotion durationMs=0 result=completed reason=handled_inside_discovery_preview`,
            );
          } else {
            route = {
              caseId,
              appSlug: effectiveAppSlug,
              route: "full_discovery",
              reason: `${route.route}_promotion_incomplete`,
              specPath: promotedValidation.specPath,
            };
            log(
              jobId,
              `[execution-route] jobId=${jobId} caseId=${caseId} appSlug=${effectiveAppSlug} route=full_discovery reason=${route.reason} specPath=${route.specPath ?? "none"}`,
            );
          }
        }
      }
    }

    if (route.route === "full_discovery") {
      route = await runFullDiscoveryForCase(route);
    } else if (route.route === "promoted_reuse") {
      prepareResult = "skipped";
      prepareReason = "promoted_reuse";
      promotionResult = "skipped";
      promotionReason = "promoted_reuse";
    } else if (route.route === "blocked") {
      prepareResult = "failed";
      prepareReason = route.reason;
      promotionResult = "failed";
      promotionReason = route.reason;
    }

    routeDecisions.set(caseId, route);
    const prepareDurationMs = (prepareResult === "skipped" && promotionResult === "skipped")
      ? 0
      : Math.max(0, Date.now() - prepareStartedAt);
    log(
      jobId,
      `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=prepare result=${prepareResult} durationMs=${prepareDurationMs} reason=${prepareReason}`,
    );
    log(
      jobId,
      `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=promotion result=${promotionResult} durationMs=${promotionDurationMs} reason=${promotionReason}`,
    );

    const scenarioRef = publishedEntryByCaseId(caseId, params.publishedCases);
    const scenarioId = scenarioRef?.executionScenarioId ?? scenarioRef?.scenarioId ?? `TR-CASE-${caseId}`;
    const scenarioTitle = nonEmptyString(scenarioRef?.title) ?? `C${caseId}`;

    if (route.route === "blocked") {
      const blockedReason = route.reason;
      await recordPreFunctionalFailure({
        caseId,
        sourceGroup,
        scenarioId,
        scenarioTitle,
        reasonCode: blockedReason,
        errorMessage: `Case cannot continue before functional execution: ${blockedReason}`,
        durationMs: 0,
        completedAt: new Date().toISOString(),
        caseLifecycleStartedAt,
        groupIndex: scheduledCase.groupIndex,
        overallIndex: scheduledCase.overallIndex,
      });
      continue;
    }

    const testArgs = buildTestPromotedArgs(params, caseId);
    log(jobId, `[run:functional-execution] caseId=${caseId} command=${cmd} ${testArgs.join(" ")}`);
    const functionalStartedAt = Date.now();
    const promotedExecutionEnv = buildPromotedExecutionEnv(params, jobId);
    const testResult = await runCommand(jobId, cmd, testArgs, promotedExecutionEnv);
    const caseCompletedAt = new Date().toISOString();
    const functionalDurationMs = Math.max(0, Date.now() - functionalStartedAt);
    const noTestsFound = testResult.lines.some((line) => /No tests found/i.test(line));
    if (noTestsFound) {
      log(
        jobId,
        `[evidence-initialization] caseId=${caseId} initialized=false moduleMode=${RUNTIME_MODULE_MODE} reason=no_tests_found`,
      );
      await recordPreFunctionalFailure({
        caseId,
        sourceGroup,
        scenarioId,
        scenarioTitle,
        reasonCode: "no_promoted_spec_found",
        errorMessage: "No promoted spec found for functional execution.",
        durationMs: functionalDurationMs,
        completedAt: caseCompletedAt,
        caseLifecycleStartedAt,
        groupIndex: scheduledCase.groupIndex,
        overallIndex: scheduledCase.overallIndex,
      });
      continue;
    }

    const evidenceInit = parseEvidenceInitializationResult(testResult.lines);
    if (!evidenceInit.initialized) {
      evidenceInitializationFailures += 1;
    }
    log(
      jobId,
      `[evidence-initialization] caseId=${caseId} initialized=${evidenceInit.initialized} moduleMode=${RUNTIME_MODULE_MODE} reason=${evidenceInit.reason}`,
    );

    const discoveryStatus = testResult.exitCode === 0 ? "passed" : "failed";
    const failureDetails = discoveryStatus === "failed"
      ? parsePromotedFunctionalFailure(testResult.lines)
      : {};
    const evidenceFailure = discoveryStatus === "failed"
      ? readCaseEvidenceFailureSnapshot({
        runId: jobId,
        caseId,
        appSlug: params.appSlug,
        sectionSlug: params.sectionSlug,
        sectionName: params.sectionName,
      })
      : undefined;
    const failedStep = failureDetails.failedAtStep ?? evidenceFailure?.failedAtStep;
    const failedTarget = failureDetails.failedTarget ?? evidenceFailure?.failedTarget;
    const screenshotPath = nonEmptyString(evidenceFailure?.screenshotPath);
    const evidencePath = screenshotPath ?? nonEmptyString(evidenceFailure?.evidenceJsonPath);
    const failureReasonCode = nonEmptyString(failureDetails.failureReason)
      ?? (typeof failedStep === "number" ? "promoted_step_failed" : "functional_execution_failed");
    const failureMessage = nonEmptyString(failureDetails.errorMessage)
      ?? nonEmptyString(evidenceFailure?.errorMessage)
      ?? nonEmptyString(testResult.lines[testResult.lines.length - 1])
      ?? "Functional execution failed";
    completed += 1;
    if (discoveryStatus === "passed") passed += 1;
    else failed += 1;
    executed += 1;
    caseResults.push({
      caseId,
      status: discoveryStatus,
      completedAt: caseCompletedAt,
      durationMs: functionalDurationMs,
      reason: discoveryStatus === "failed" ? failureReasonCode : discoveryStatus,
      scenarioId,
      scenarioTitle,
      sourceType: sourceGroup,
      appSlug: nonEmptyString(params.appSlug),
      sectionSlug: nonEmptyString(params.sectionSlug),
      launchId: nonEmptyString(params.launchId),
      failedStep,
      failedTarget,
      failureReason: discoveryStatus === "failed" ? failureReasonCode : undefined,
      errorMessage: discoveryStatus === "failed" ? failureMessage : undefined,
      screenshotPath,
      evidencePath,
    });
    if (discoveryStatus === "failed") {
      const technicalContext: NonNullable<Defect["technicalContext"]> = {
        dedupeKey: buildDiscoveryBatchDefectDedupeKey({ jobId, caseId, scenarioId }),
        reasonCode: failureReasonCode,
        discoveryStatus,
        failedAtStep: failedStep,
        failedTarget,
        rawError: failureMessage,
        evidenceDir: evidenceFailure?.evidenceJsonPath ? path.dirname(evidenceFailure.evidenceJsonPath) : undefined,
        evidencePath,
        lastSuccessfulStep: evidenceFailure?.lastSuccessfulStep,
        testRailCaseId: caseId,
        testRailRunId: params.testRunId,
        caseId,
        scenarioId,
        sourceType: sourceGroup,
        appSlug: nonEmptyString(params.appSlug),
        sectionSlug: nonEmptyString(params.sectionSlug),
        status: discoveryStatus,
        failureReason: failureReasonCode,
        errorMessage: failureMessage,
        screenshotPath,
        evidenceJsonPath: nonEmptyString(evidenceFailure?.evidenceJsonPath),
        launchId: nonEmptyString(params.launchId),
        currentUrl: nonEmptyString(failureDetails.currentUrl),
        matchedLocatorStrategy: nonEmptyString(failureDetails.matchedLocatorStrategy),
      };
      const technicalContextRecord = technicalContext as Record<string, unknown>;
      Object.keys(technicalContextRecord).forEach((key) => {
        if (technicalContextRecord[key] === undefined) {
          delete technicalContextRecord[key];
        }
      });
      if (technicalContext.lastSuccessfulStep) {
        const lastSuccessfulStep = technicalContext.lastSuccessfulStep;
        Object.keys(lastSuccessfulStep).forEach((key) => {
          const typedKey = key as keyof typeof lastSuccessfulStep;
          if (lastSuccessfulStep[typedKey] === undefined) {
            delete lastSuccessfulStep[typedKey];
          }
        });
        if (Object.keys(lastSuccessfulStep).length === 0) {
          delete technicalContext.lastSuccessfulStep;
        }
      }
      const checklist = defectChecklistStore.getOrCreate(checklistIdentity);
      const upsertResult = upsertChecklistDefect({
        list: checklist,
        checklistIdentity,
        jobId,
        caseId,
        scenarioId,
        scenarioTitle,
        failureReasonText: failureMessage,
        technicalContext: Object.keys(technicalContext).length > 0 ? technicalContext : undefined,
        evidencePath,
      });
      const defectCount = syncChecklistMetadata();
      log(
        jobId,
        `[defect-checklist] upsert key=${upsertResult.dedupeKey} identity=${checklistIdentity} caseId=${caseId} scenarioId=${scenarioId} action=${upsertResult.action} defectCount=${defectCount} sourceType=${sourceGroup}`,
      );
    }
    log(
      jobId,
      `[execution-phase] jobId=${jobId} caseId=${caseId} phase=functional durationMs=${functionalDurationMs} result=${discoveryStatus === "passed" ? "completed" : "failed"} reason=${discoveryStatus}`,
    );
    log(
      jobId,
      `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=functional result=${discoveryStatus === "passed" ? "completed" : "failed"} durationMs=${functionalDurationMs} reason=${discoveryStatus}`,
    );

    if (params.testRunId && isPositiveCaseId(params.testRunId)) {
      const syncResult = await syncDiscoveryResultToTestRail({
        runId: params.testRunId,
        caseId,
        scenarioId,
        discoveryStatus,
        title: scenarioRef?.title,
        launchId: params.launchId,
        appSlug: params.appSlug,
        sectionSlug: params.sectionSlug,
      });
      if (syncResult.syncStatus === "synced") synced += 1;
      if (syncResult.syncStatus === "failed") syncFailed += 1;

      if (params.launchId) {
        updateLaunchManifestWithResult(
          params.launchId,
          {
            scenarioId,
            caseId,
            discoveryStatus,
            testRailStatusId: syncResult.statusId,
            syncStatus: syncResult.syncStatus,
            syncedAt: syncResult.syncedAt,
            error: syncResult.error,
          },
          scheduledCases.length,
        );
      }
    }

    log(
      jobId,
      `[case-lifecycle] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} phase=result result=${discoveryStatus === "passed" ? "completed" : "failed"} durationMs=${Math.max(0, Date.now() - caseLifecycleStartedAt)} reason=${discoveryStatus}`,
    );
    log(
      jobId,
      `[case-schedule] jobId=${jobId} caseId=${caseId} sourceGroup=${sourceGroup} groupIndex=${scheduledCase.groupIndex} overallIndex=${scheduledCase.overallIndex} action=${discoveryStatus === "passed" ? "completed" : "failed"}`,
    );
    updateProgressSummary(caseId);
  }

  if (activeGroup) {
    markGroupEnd(activeGroup, "completed", "group_cases_processed");
  }

  jobStore.update(jobId, { currentCase: null });
  log(jobId, `[functional-execution] requested=${executionCaseIds.length} executed=${executed} passed=${passed} failed=${failed} skipped=${skipped}`);

  const finalSnapshot = computeFunctionalExecutionSnapshot({
    requested: executionCaseIds.length,
    completed,
    executed,
    passed,
    failed,
    skipped,
  });

  const consolidationStartedAt = Date.now();
  const documentResult = finalSnapshot.executed > 0
    ? await consolidateRunEvidenceForExecution(
      jobId,
      params.appSlug,
      params.sectionSlug,
      params.sectionName,
    )
    : {
      attempted: false,
      generated: false,
      documentPathPresent: false,
      scenarioEvidenceCount: 0,
    };
  const consolidationDurationMs = Math.max(0, Date.now() - consolidationStartedAt);
  const consolidationResult = finalSnapshot.executed === 0
    ? "skipped"
    : (documentResult.generated ? "completed" : "failed");
  log(
    jobId,
    `[evidence-consolidation] jobId=${jobId} trigger=job_completed scenarioCount=${documentResult.scenarioEvidenceCount} generationCount=1 result=${consolidationResult} durationMs=${consolidationDurationMs}`,
  );

  const effectiveReasonCode = finalSnapshot.executed === 0
    ? "cases_not_executable"
    : undefined;
  const reasonCode = effectiveReasonCode
    ?? (
      !documentResult.generated
        ? (evidenceInitializationFailures > 0 ? "evidence_initialization_failed" : "document_generation_failed")
        : undefined
    );

  log(
    jobId,
    `[document-generation] jobId=${jobId} executedResults=${finalSnapshot.executed} evidenceResults=${documentResult.scenarioEvidenceCount} attempted=${documentResult.attempted} generated=${documentResult.generated} documentPathPresent=${documentResult.documentPathPresent} reason=${reasonCode ?? "ready"}`,
  );

  if (params.launchId) {
    const finalStatus = failed > 0 || syncFailed > 0 ? "completed_with_failures" : "completed";
    finalizeLaunchManifest(params.launchId, finalStatus, syncFailed, finalSnapshot.completed);
  }
  const finalChecklist = defectChecklistStore.get(checklistIdentity) ?? checklistList;
  const finalDefectCount = countDefectsForJob(finalChecklist, jobId);

  const summary = {
    ...baseSummary,
    synced,
    syncFailed,
    requested: finalSnapshot.requested,
    completed: finalSnapshot.completed,
    executed: finalSnapshot.executed,
    passed: finalSnapshot.passed,
    failed: finalSnapshot.failed,
    skipped: finalSnapshot.skipped,
    progressPercent: finalSnapshot.progressPercent,
    progress: finalSnapshot.progressPercent,
    passRate: finalSnapshot.passRate,
    requestedCases: finalSnapshot.requested,
    executedCases: finalSnapshot.executed,
    notExecutableCases: nonExecutableFailed,
    caseResults: [...caseResults],
    reasonCode,
    documentAttempted: documentResult.attempted,
    documentGenerated: documentResult.generated,
    documentPathPresent: documentResult.documentPathPresent,
    ...(documentResult.documentPath ? { documentPath: documentResult.documentPath } : {}),
    scenarioEvidenceCount: documentResult.scenarioEvidenceCount,
    evidenceResults: documentResult.scenarioEvidenceCount,
    evidenceInitializationFailures,
    checklistIdentity,
    checklistUrl,
    defectCount: finalDefectCount,
    ...(documentResult.error ? { documentError: documentResult.error } : {}),
  };

  jobStore.update(jobId, {
    status: "done",
    completedAt: new Date().toISOString(),
    exitCode: 0,
    summary,
    checklistUrl,
    defectCount: finalDefectCount,
    ...(checklistIssueKeyMetadata ? { issueKey: checklistIssueKeyMetadata } : {}),
  });
}

export function startDiscoveryBatchRun(jobId: string): void {
  const job = jobStore.getInternal(jobId);
  if (!job) return;
  const params = job.params as DiscoveryBatchParams;
  if (params.executePromotedSpecs === true) {
    void startDiscoveryBatchExecutionFlow(jobId, params).catch((err: any) => {
      jobStore.update(jobId, { status: "failed", completedAt: new Date().toISOString() });
      log(jobId, `[run:discovery-batch] Error al ejecutar flujo de ejecución: ${err?.message ?? String(err)}`);
    });
    return;
  }
  startLegacyDiscoveryBatchRun(jobId, params);
}
