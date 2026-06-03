import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { jobStore, type JobSummary } from "./job-store";
import { toVirtualCase, type ScenarioPreviewRequest, type VirtualCase } from "../../types/scenario-preview.types";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import {
  normalizeScenario,
  normalizeVirtualCase,
  validateVirtualCases,
  canonicalizeText,
  buildCanonicalLabelMap,
  buildCanonicalLabelRegistry,
  loadAppConfig,
  normalizeForComparison,
  buildCanonicalEntrySteps,
} from "../../automations/scenario-normalizer";
import { normalizeSectionSlug } from "../../automations/app-profile";
import type { McpRouteProfile } from "../../scenarios/scenario-types";
import {
  buildTestRailRunName,
  reportScenarioPreviewResultsToTestRail,
} from "../services/testrail-run-reporter";
import { publishScenariosToTestRail, readPersistedScenarioMappings } from "../services/testrail-case-publisher";
import { buildScenarioPreviewScenarioId, type ScenarioPreviewTestRailResult } from "../services/testrail-sync-types";

const TECHNICAL_SLUGS = new Set([
  "tests",
  "test",
  "api-tests",
  "api tests",
  "qa-tests",
  "qa tests",
  "default",
  "unknown",
  "undefined",
  "null",
]);

function isTechnicalSlug(slug: string): boolean {
  const normalized = slug.trim().toLowerCase();
  return TECHNICAL_SLUGS.has(normalized);
}

function hasNonDefaultRouteProfile(routeProfile: McpRouteProfile | null): boolean {
  if (!routeProfile) return false;
  const hasDomainTerms = Object.keys(routeProfile.domainTerms ?? {}).length > 0;
  const hasEntry = (routeProfile.entry ?? []).length > 0;
  const hasVisibleControls = (routeProfile.visibleControls ?? []).length > 0;
  return hasDomainTerms || hasEntry || hasVisibleControls;
}

const ROOT = path.resolve(__dirname, "..", "..", "..");
const ARTIFACTS_DIR = path.join(ROOT, ".artifacts", "scenario-preview-runs");

type ScenarioPreviewParams = ScenarioPreviewRequest;
type ScenarioPreviewTargetInference = {
  effectiveTargetAppSlug?: string;
  requestTargetAppSlug?: string;
  requestAppSlug?: string;
  scenarioTargetAppSlugs: string[];
  sectionName?: string;
  sectionSlug?: string;
  titlesSample: string[];
  source: "scenario_target" | "section_name" | "title_keyword" | "request_target" | "fallback";
  diagnostics?: string;
};
type ScenarioPreviewSummaryPatch = Partial<JobSummary> & {
  failureGroups?: Record<string, number>;
  promotionStatus?: string;
  promotionReason?: string;
};
type ScenarioPreviewResultsFile = {
  ok?: boolean;
  total?: number;
  passed?: number;
  failed?: number;
  completed?: number;
  status?: string;
  message?: string;
  error?: string;
  promotionStatus?: string;
  promotionReason?: string;
  summary?: Record<string, unknown>;
  cases?: Array<{ status?: string }>;
  results?: Array<{ status?: string }>;
};

type ScenarioPreviewOutcome = "passed" | "completed_with_failures" | "technical_failure";

const DISCOVERY_PREVIEW_RESULTS_REGEX = /\[discovery:preview\]\s+Results:\s+(\d+)\s+passed,\s+(\d+)\s+failed\s+out of\s+(\d+)/i;
const PROMOTION_GATE_STATUS_REGEX = /\[discovery:workflow\]\s+Promotion gate:\s+allowed=(true|false),\s+status=([a-z_]+)/i;
const PROMOTION_GATE_REASON_REGEX = /\[discovery:workflow\]\s+Promotion gate reason[s]?:\s*(.+)$/i;

function hasUsableResultsSummary(results: ScenarioPreviewResultsFile): boolean {
  const summary = (results.summary ?? {}) as Record<string, unknown>;
  const total = typeof results.total === "number" ? results.total : typeof summary.total === "number" ? summary.total : undefined;
  const completed = typeof results.completed === "number" ? results.completed : typeof summary.completed === "number" ? summary.completed : undefined;
  const passed = typeof results.passed === "number" ? results.passed : typeof summary.passed === "number" ? summary.passed : undefined;
  const failed = typeof results.failed === "number" ? results.failed : typeof summary.failed === "number" ? summary.failed : undefined;
  return Boolean(
    (typeof total === "number" && total > 0) ||
    (typeof completed === "number" && completed > 0) ||
    (typeof passed === "number" && typeof failed === "number")
  );
}

function getCaseCountFromResults(results: ScenarioPreviewResultsFile): number {
  if (Array.isArray(results.results)) return results.results.length;
  if (Array.isArray(results.cases)) return results.cases.length;
  return 0;
}

function ensureArtifactDir(jobId: string): string {
  const dir = path.join(ARTIFACTS_DIR, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function savePreviewScenarios(artifactDir: string, scenarios: VirtualCase[]): string {
  const filePath = path.join(artifactDir, "preview-scenarios.json");
  fs.writeFileSync(filePath, JSON.stringify(scenarios, null, 2), "utf-8");
  return filePath;
}

function saveGeneratedCase(artifactDir: string, virtualCase: VirtualCase): string {
  const casesDir = path.join(artifactDir, "generated-cases");
  fs.mkdirSync(casesDir, { recursive: true });
  const filePath = path.join(casesDir, `${virtualCase.id}.json`);
  fs.writeFileSync(filePath, JSON.stringify(virtualCase, null, 2), "utf-8");
  return filePath;
}

function saveLogFile(artifactDir: string, filename: string, content: string): string {
  const filePath = path.join(artifactDir, filename);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

function buildCacheKey(params: ScenarioPreviewParams, validScenarios: ScenarioPreviewParams["scenarios"], routeProfile: McpRouteProfile | null): string {
  const source = params.source;
  const scenarioIds = validScenarios.map((scenario, index) => buildScenarioPreviewScenarioId(scenario, index)).join(",");
  const routeName = routeProfile?.name ?? "default";
  return [
    params.appSlug,
    params.targetAppSlug ?? "none",
    params.sectionName ?? "none",
    params.testrailProjectId ?? "none",
    params.testrailSuiteId ?? "none",
    params.testrailSectionId ?? "none",
    source?.projectKey ?? "none",
    source?.sprintId ?? "none",
    source?.status ?? "none",
    routeName,
    scenarioIds,
  ].join("|");
}

function buildScenarioPreviewResults(results: Map<string, { status: "passed" | "failed" | "skipped" | "review_needed"; failureReason?: string }>, cases: VirtualCase[]): ScenarioPreviewTestRailResult[] {
  return cases.map((vc) => {
    const outcome = results.get(vc.displayId) ?? { status: "review_needed" as const };
    return {
      scenarioId: vc.displayId,
      title: vc.title,
      status: outcome.status,
      failureReason: outcome.failureReason,
    };
  });
}

export function getScenarioPreviewOutcome(input: {
  exitCode: number | null;
  results?: ScenarioPreviewResultsFile | null;
  completedCount: number;
  sawCaseStarted: boolean;
  firstCaseStarted: boolean;
}): ScenarioPreviewOutcome {
  const results = input.results;
  const hasResults = Boolean(results);
  const resultsCompleted = typeof results?.completed === "number"
    ? results.completed
    : typeof results?.summary?.completed === "number"
      ? Number(results.summary.completed)
      : undefined;
  const resultsPassed = typeof results?.passed === "number"
    ? results.passed
    : typeof results?.summary?.passed === "number"
      ? Number(results.summary.passed)
      : undefined;
  const resultsFailed = typeof results?.failed === "number"
    ? results.failed
    : typeof results?.summary?.failed === "number"
      ? Number(results.summary.failed)
      : undefined;

  const effectiveCompleted = resultsCompleted ?? input.completedCount;
  const effectivePassed = resultsPassed ?? 0;
  const effectiveFailed = resultsFailed ?? 0;

  if (effectiveCompleted > 0 && (effectivePassed > 0 || effectiveFailed > 0)) {
    if (effectiveFailed > 0 || (input.exitCode !== 0 && input.exitCode !== null)) {
      return "completed_with_failures";
    }
    return "passed";
  }

  if (hasResults && (input.sawCaseStarted || input.firstCaseStarted || effectiveCompleted > 0)) {
    return input.exitCode === 0 ? "passed" : "completed_with_failures";
  }

  return "technical_failure";
}

function normalizeMaybeSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeCandidateName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function isTechnicalAppName(value: string): boolean {
  const normalized = normalizeCandidateName(value);
  return TECHNICAL_SLUGS.has(normalized) || normalized === "" || normalized === "default";
}

function inferTargetAppSlugFromScenarios(
  params: ScenarioPreviewParams,
  validScenarios: ScenarioPreviewParams["scenarios"],
): ScenarioPreviewTargetInference {
  const scenarioTargetAppSlugs = Array.from(
    new Set(
      (validScenarios ?? [])
        .map((sc) => normalizeMaybeSlug(sc.targetAppSlug))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  );

  const titlesSample = (validScenarios ?? [])
    .map((sc) => sc.title)
    .filter((title): title is string => typeof title === "string" && title.trim().length > 0)
    .slice(0, 3);

  const requestTargetAppSlug = normalizeMaybeSlug(params.targetAppSlug);
  const requestAppSlug = normalizeMaybeSlug(params.appSlug);
  const sectionName = normalizeMaybeSlug(params.sectionName);
  const sectionSlug = sectionName ? normalizeSectionSlug(sectionName) : undefined;

  const scenarioTarget = scenarioTargetAppSlugs.find((slug) => !isTechnicalSlug(slug) && !isTechnicalAppName(slug) && !isTestRailSectionDerivedSlug(slug, sectionName, sectionSlug));
  if (scenarioTarget) {
    return {
      effectiveTargetAppSlug: scenarioTarget,
      requestAppSlug,
      requestTargetAppSlug,
      scenarioTargetAppSlugs,
      sectionName,
      sectionSlug,
      titlesSample,
      source: "scenario_target",
    };
  }

  if (requestTargetAppSlug && !isTechnicalSlug(requestTargetAppSlug) && !isTechnicalAppName(requestTargetAppSlug) && !isTestRailSectionDerivedSlug(requestTargetAppSlug, sectionName, sectionSlug)) {
    return {
      effectiveTargetAppSlug: requestTargetAppSlug,
      requestAppSlug,
      requestTargetAppSlug,
      scenarioTargetAppSlugs,
      sectionName,
      sectionSlug,
      titlesSample,
      source: "request_target",
    };
  }

  return {
    requestAppSlug,
    requestTargetAppSlug,
    scenarioTargetAppSlugs,
    sectionName,
    sectionSlug,
    titlesSample,
    diagnostics: `requested app "${params.appSlug}" is technical/non-executable and no valid functional target app with routeProfile was found.`,
    source: "fallback",
  };
}

function isTestRailSectionDerivedSlug(candidate: string, sectionName?: string | null, sectionSlug?: string): boolean {
  if (!candidate) return false;
  const normalizedCandidate = normalizeMaybeSlug(candidate)?.toLowerCase();
  if (!normalizedCandidate) return false;
  const derivedSlug = sectionSlug ?? (sectionName ? normalizeSectionSlug(sectionName) : undefined);
  if (derivedSlug && normalizedCandidate === derivedSlug.toLowerCase()) return true;
  if (sectionName) {
    const normalizedSectionName = normalizeSectionSlug(sectionName).toLowerCase();
    return normalizedCandidate === normalizedSectionName;
  }
  return false;
}

function isExecutableAppSlug(candidate: string, routeProfile: McpRouteProfile | null): boolean {
  if (!candidate) return false;
  if (isTechnicalSlug(candidate) || isTechnicalAppName(candidate)) return false;
  if (!loadAppConfigSync(candidate)) return false;
  if (!hasNonDefaultRouteProfile(routeProfile)) return false;
  return true;
}

export function mergeScenarioPreviewSummary(
  current: JobSummary | undefined,
  patch: ScenarioPreviewSummaryPatch,
): JobSummary {
  const next: JobSummary = {
    totalStories: patch.totalStories ?? patch.scenarioCount ?? current?.totalStories ?? 0,
    synced: patch.synced ?? current?.synced ?? 0,
    passed: patch.passed ?? current?.passed ?? 0,
    failed: patch.failed ?? current?.failed ?? 0,
    completed: patch.completed ?? current?.completed ?? 0,
    scenarioCount: patch.scenarioCount ?? current?.scenarioCount,
    currentCaseIndex: patch.currentCaseIndex ?? current?.currentCaseIndex,
    totalCases: patch.totalCases ?? current?.totalCases,
    command: patch.command ?? current?.command,
    artifactsDir: patch.artifactsDir ?? current?.artifactsDir,
    errorMessage: patch.errorMessage ?? current?.errorMessage,
  };

  if (patch.promotionStatus !== undefined) {
    (next as any).promotionStatus = patch.promotionStatus;
  } else if ((current as any)?.promotionStatus !== undefined) {
    (next as any).promotionStatus = (current as any).promotionStatus;
  }

  if (patch.promotionReason !== undefined) {
    (next as any).promotionReason = patch.promotionReason;
  } else if ((current as any)?.promotionReason !== undefined) {
    (next as any).promotionReason = (current as any).promotionReason;
  }

  if (patch.failureGroups !== undefined) {
    (next as any).failureGroups = patch.failureGroups;
  } else if ((current as any)?.failureGroups !== undefined) {
    (next as any).failureGroups = (current as any).failureGroups;
  }

  return next;
}

function updateScenarioPreviewSummary(jobId: string, patch: ScenarioPreviewSummaryPatch): void {
  const currentSummary = jobStore.get(jobId)?.summary;
  jobStore.update(jobId, {
    summary: mergeScenarioPreviewSummary(currentSummary, patch),
  });
}

export function parseScenarioPreviewResultsLine(line: string): ScenarioPreviewSummaryPatch | null {
  const match = line.match(DISCOVERY_PREVIEW_RESULTS_REGEX);
  if (!match) return null;
  const passed = Number(match[1]);
  const failed = Number(match[2]);
  const total = Number(match[3]);
  return {
    completed: total,
    passed,
    failed,
    scenarioCount: total,
    totalStories: total,
  };
}

function parsePromotionGateStatusLine(line: string): ScenarioPreviewSummaryPatch | null {
  const match = line.match(PROMOTION_GATE_STATUS_REGEX);
  if (!match) return null;
  return {
    promotionStatus: match[2],
  };
}

function parsePromotionGateReasonLine(line: string): ScenarioPreviewSummaryPatch | null {
  const match = line.match(PROMOTION_GATE_REASON_REGEX);
  if (!match) return null;
  return {
    promotionReason: match[1].trim(),
  };
}

export function parseScenarioPreviewResultsFile(results: ScenarioPreviewResultsFile): ScenarioPreviewSummaryPatch {
  const directTotal = typeof results.total === "number" ? results.total : undefined;
  const summary = (results.summary ?? {}) as Record<string, unknown>;
  const summaryTotal = typeof summary.total === "number" ? summary.total : undefined;
  const passed = typeof results.passed === "number"
    ? results.passed
    : typeof summary.passed === "number"
      ? summary.passed
      : undefined;
  const failed = typeof results.failed === "number"
    ? results.failed
    : typeof summary.failed === "number"
      ? summary.failed
      : undefined;
  const total = directTotal ?? summaryTotal ?? (passed !== undefined && failed !== undefined ? passed + failed : undefined);
  const completed = typeof results.completed === "number"
    ? results.completed
    : total ?? getCaseCountFromResults(results);

  return {
    completed,
    passed,
    failed,
    scenarioCount: total,
    totalStories: total,
    failureGroups: typeof summary.failureGroups === "object" && summary.failureGroups
      ? summary.failureGroups as Record<string, number>
      : undefined,
    promotionStatus: typeof results.promotionStatus === "string" ? results.promotionStatus : undefined,
    promotionReason: typeof results.promotionReason === "string" ? results.promotionReason : undefined,
  };
}

export function applyCaseFinishedSummaryPatch(
  summary: JobSummary | undefined,
  status: "passed" | "failed",
): ScenarioPreviewSummaryPatch {
  return {
    passed: (summary?.passed ?? 0) + (status === "passed" ? 1 : 0),
    failed: (summary?.failed ?? 0) + (status === "failed" ? 1 : 0),
    completed: (summary?.completed ?? 0) + 1,
  };
}

export function shouldReportFailedBeforeFirstCase(input: {
  exitCode: number | null;
  firstCaseStarted: boolean;
  finishedCaseIds: Set<string>;
  completedCount: number;
  hasResultsSummary: boolean;
  sawResultsLine: boolean;
}): boolean {
  if (input.exitCode === 0 || input.exitCode === null) return false;
  if (input.firstCaseStarted) return false;
  if (input.finishedCaseIds.size > 0) return false;
  if (input.completedCount > 0) return false;
  if (input.hasResultsSummary) return false;
  if (input.sawResultsLine) return false;
  return true;
}

function validatePreviewArtifacts(
  cases: VirtualCase[],
  routeProfile: McpRouteProfile | null,
  appConfig: Record<string, unknown> | null,
): { valid: boolean; error?: string; message?: string; scenarioId?: string; details?: string[]; field?: string } {
  const labelMap = buildCanonicalLabelMap(routeProfile, appConfig, { visualOnly: true, includeDomainTerms: false });
  const labelRegistry = buildCanonicalLabelRegistry(routeProfile, appConfig, { visualOnly: true, includeDomainTerms: false });
  const canonicalEntrySteps = buildCanonicalEntrySteps(routeProfile);

  for (const vc of cases) {
    // Check for duplicate entry steps
    const entryStepCounts = new Map<string, number>();
    for (const step of vc.steps) {
      for (const ce of canonicalEntrySteps) {
        if (normalizeForComparison(step) === normalizeForComparison(ce)) {
          entryStepCounts.set(ce, (entryStepCounts.get(ce) ?? 0) + 1);
        }
      }
    }
    for (const [ce, count] of entryStepCounts) {
      if (count > 1) {
        return {
          valid: false,
          error: "invalid_preview_artifacts",
          message: `Preview artifact contains duplicated entry steps: "${ce}" appears ${count} times`,
          scenarioId: vc.displayId,
          details: vc.steps.slice(0, 5),
        };
      }
    }

    if (labelMap.size > 0) {
      const fields = [
        { name: "title", value: vc.title },
        ...vc.steps.map((value, index) => ({ name: `steps[${index}]`, value })),
        { name: "expectedResult", value: vc.expectedResult },
        ...vc.preconditions.map((value, index) => ({ name: `preconditions[${index}]`, value })),
      ];

      for (const field of fields) {
        const canonicalized = canonicalizeText(field.value, labelMap);
        if (canonicalized === field.value) continue;

        const normalizedText = normalizeForComparison(field.value);
        const matchedEntry = Array.from(labelRegistry.entries())
          .sort((a, b) => {
            if (a[1].priority !== b[1].priority) return a[1].priority - b[1].priority;
            return b[0].length - a[0].length;
          })
          .find(([normalizedForm, entry]) =>
            normalizedForm.length >= 3 &&
            normalizedText.includes(normalizedForm) &&
            !field.value.includes(entry.canonical),
          );

        const expectedCanonical = matchedEntry?.[1].canonical ?? canonicalized;
        const source = matchedEntry?.[1].source ?? "unknown";
        return {
          valid: false,
          error: "invalid_preview_artifacts",
          message: `Preview artifact contains damaged label that should be canonicalized to "${expectedCanonical}"`,
          scenarioId: vc.displayId,
          field: field.name,
          details: [
            `damagedLabel: ${field.value}`,
            `expectedCanonical: ${expectedCanonical}`,
            `source: ${source}`,
            `routeProfile: ${routeProfile?.name ?? "none"}`,
          ],
        };
      }
    }
  }

  return { valid: true };
}

export async function startScenarioPreviewRun(jobId: string): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  const p = job.params as ScenarioPreviewParams;

  if (!p.scenarios || p.scenarios.length === 0) {
    const artifactDir = ensureArtifactDir(jobId);
    saveLogFile(artifactDir, "stdout.log", "");
    saveLogFile(artifactDir, "stderr.log", "");
    const resultsPath = path.join(artifactDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({ ok: false, error: "no_scenarios", message: "No scenarios provided" }, null, 2),
      "utf-8",
    );
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "No scenarios provided",
      summary: {
        totalStories: 0,
        synced: 0,
        passed: 0,
        failed: 0,
        errorMessage: "No scenarios provided",
      },
    });
    jobStore.appendLog(jobId, "[run:scenario-preview] Error: no scenarios provided");
    return;
  }

  const validScenarios = p.scenarios.filter(
    (s) => s.mcpExecutable === true && s.validation?.valid !== false
  );

  if (validScenarios.length === 0) {
    const artifactDir = ensureArtifactDir(jobId);
    saveLogFile(artifactDir, "stdout.log", "");
    saveLogFile(artifactDir, "stderr.log", "");
    const resultsPath = path.join(artifactDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({ ok: false, error: "no_valid_scenarios", message: "No valid mcpExecutable scenarios" }, null, 2),
      "utf-8",
    );
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "No valid mcpExecutable scenarios",
      summary: {
        totalStories: p.scenarios.length,
        synced: 0,
        passed: 0,
        failed: 0,
        errorMessage: "No valid mcpExecutable scenarios",
      },
    });
    jobStore.appendLog(jobId, "[run:scenario-preview] Error: no valid mcpExecutable scenarios");
    return;
  }

  const artifactDir = ensureArtifactDir(jobId);

  // ── FASE 1: Resolve effective appSlug with inference chain ──
  let resolved: ResolvedApp;
  try {
    resolved = resolveEffectiveAppSlug(p, validScenarios);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobStore.appendLog(jobId, `[run:scenario-preview] ${message}`);
    saveLogFile(artifactDir, "stdout.log", "");
    saveLogFile(artifactDir, "stderr.log", "");
    const resultsPath = path.join(artifactDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify(
        {
          ok: false,
          error: "invalid_target_app_slug",
          message,
          diagnostics: {
            requestedAppSlug: p.appSlug,
            requestTargetAppSlug: normalizeMaybeSlug(p.targetAppSlug) ?? null,
            scenarioTargetAppSlugs: inferTargetAppSlugFromScenarios(p, validScenarios).scenarioTargetAppSlugs,
            sectionName: normalizeMaybeSlug(p.sectionName) ?? null,
            sectionSlug: p.sectionName ? normalizeSectionSlug(p.sectionName) : null,
            titlesSample: inferTargetAppSlugFromScenarios(p, validScenarios).titlesSample,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: message,
      summary: { totalStories: validScenarios.length, synced: 0, passed: 0, failed: 0, errorMessage: message },
    });
    return;
  }
  const { appSlug, routeProfile, appConfig, inference } = resolved;
  const sectionSlug = p.sectionName ? normalizeSectionSlug(p.sectionName) : undefined;

  jobStore.appendLog(
    jobId,
    `[scenario-preview] requestedAppSlug=${p.appSlug} functionalAppSlug=${(p as { functionalAppSlug?: string }).functionalAppSlug ?? "none"} scenarioTargetAppSlug=${inference.scenarioTargetAppSlugs[0] ?? "none"} effectiveTargetAppSlug=${appSlug}`,
  );
  if (sectionSlug) {
    jobStore.appendLog(jobId, `[scenario-preview] testRailSectionName="${p.sectionName ?? "N/A"}" sectionSlug=${sectionSlug} metadataOnly=true`);
    jobStore.appendLog(jobId, "[scenario-preview] sectionSlug is metadata only, not appSlug");
  }

  jobStore.appendLog(jobId, `[run:scenario-preview] resolved appSlug=${appSlug} routeProfile=${routeProfile?.name ?? "none"} domainTerms=${Object.keys(routeProfile?.domainTerms ?? {}).length} entrySteps=${(routeProfile?.entry ?? []).length}`);

  // ── FASE 2: Block technical slugs without valid routeProfile ──
  if (!hasNonDefaultRouteProfile(routeProfile)) {
    const errorMessage = `Resolved targetAppSlug="${appSlug}" has no valid routeProfile. ` +
      `Cannot execute scenario-preview without routeProfile with domainTerms and entry steps.`;
    jobStore.appendLog(jobId, `[run:scenario-preview] ${errorMessage}`);
    saveLogFile(artifactDir, "stdout.log", "");
    saveLogFile(artifactDir, "stderr.log", "");
    const resultsPath = path.join(artifactDir, "results.json");
    const inference = inferTargetAppSlugFromScenarios(p, validScenarios);
    fs.writeFileSync(
      resultsPath,
      JSON.stringify(
        {
          ok: false,
          error: "invalid_target_app_slug",
          message: errorMessage,
          diagnostics: {
            requestedAppSlug: p.appSlug,
            functionalAppSlug: (p as { functionalAppSlug?: string }).functionalAppSlug ?? null,
            requestTargetAppSlug: inference.requestTargetAppSlug ?? p.targetAppSlug ?? null,
            scenarioTargetAppSlugs: inference.scenarioTargetAppSlugs,
            sectionName: inference.sectionName ?? p.sectionName ?? null,
            sectionSlug: inference.sectionSlug ?? sectionSlug ?? null,
            titlesSample: inference.titlesSample,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage,
      summary: { totalStories: validScenarios.length, synced: 0, passed: 0, failed: 0, errorMessage },
    });
    jobStore.appendLog(jobId, `[run:scenario-preview] failed reason=invalid_target_app_slug appSlug=${appSlug}`);
    return;
  }

  // Normalize scenarios before converting to virtual cases
  const normalizedScenarios = validScenarios.map((s) => {
    const { scenario, stats } = normalizeScenario(s, routeProfile, appConfig);
    jobStore.appendLog(
      jobId,
      `[run:scenario-preview] normalized scenario=${s.sourceIssueKey} beforeSteps=${stats.beforeSteps} afterSteps=${stats.afterSteps} entryDeduped=${stats.entryDeduped} canonicalizedLabels=${stats.canonicalizedLabels}`,
    );
    return scenario;
  });

  // Convert to virtual cases
  const virtualCases = normalizedScenarios.map((s, i) => toVirtualCase(s, i));

  // Normalize virtual cases (second pass for safety)
  const normalizedCases: VirtualCase[] = [];
  for (const vc of virtualCases) {
    const { vc: normalized, stats } = normalizeVirtualCase(vc, routeProfile, appConfig);
    jobStore.appendLog(
      jobId,
      `[run:scenario-preview] normalized ${vc.displayId} beforeSteps=${stats.beforeSteps} afterSteps=${stats.afterSteps} entryDeduped=${stats.entryDeduped} canonicalizedLabels=${stats.canonicalizedLabels}`,
    );
    normalizedCases.push(normalized);
  }

  // Log final steps for verification
  for (const vc of normalizedCases) {
    const firstSteps = vc.steps.slice(0, 3);
    jobStore.appendLog(jobId, `[scenario-preview] finalSteps scenario=${vc.displayId} firstSteps=${JSON.stringify(firstSteps)}`);
  }

  // Validate before writing artifacts
  const { valid, issues } = validateVirtualCases(normalizedCases, routeProfile, appConfig);
  if (!valid) {
    const fixableIssues = issues.filter((i) => i.fixable);
    const nonFixable = issues.filter((i) => !i.fixable);

    if (nonFixable.length > 0) {
      const errorMessage = nonFixable.map((i) => `${i.scenarioId} ${i.type}: ${i.message}`).join("; ");
      saveLogFile(artifactDir, "stdout.log", "");
      saveLogFile(artifactDir, "stderr.log", "");
      const resultsPath = path.join(artifactDir, "results.json");
      fs.writeFileSync(
        resultsPath,
        JSON.stringify({ ok: false, error: "invalid_preview_artifact_encoding_or_labels", message: errorMessage, issues: nonFixable }, null, 2),
        "utf-8",
      );
      jobStore.update(jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage,
        summary: {
          totalStories: normalizedCases.length,
          synced: 0,
          passed: 0,
          failed: 0,
          errorMessage,
        },
      });
      for (const issue of nonFixable) {
        jobStore.appendLog(jobId, `[run:scenario-preview] validation error: ${issue.scenarioId} ${issue.type}: ${issue.message}`);
      }
      jobStore.appendLog(jobId, `[run:scenario-preview] failed: invalid_preview_artifact_encoding_or_labels`);
      return;
    }

    // Fixable issues: auto-fix by re-normalizing
    jobStore.appendLog(jobId, `[run:scenario-preview] auto-fixing ${fixableIssues.length} fixable validation issues`);
  }

  // Validate artifacts before execution (FASE 3)
  for (const vc of normalizedCases) {
    jobStore.appendLog(jobId, `[scenario-preview-runner] beforeWrite scenario=${vc.displayId} steps=${JSON.stringify(vc.steps)}`);
  }

  const previewPath = savePreviewScenarios(artifactDir, normalizedCases);
  const generatedCasePaths = normalizedCases.map((vc) => {
    const casePath = saveGeneratedCase(artifactDir, vc);
    jobStore.appendLog(jobId, `[run:scenario-preview] Generated case ${vc.displayId}: ${vc.title}`);
    jobStore.appendLog(jobId, `[run:scenario-preview]   -> ${casePath}`);
    return casePath;
  });
  jobStore.appendLog(jobId, `[run:scenario-preview] Saved ${normalizedCases.length} scenarios to ${previewPath}`);

  const previewCases = JSON.parse(fs.readFileSync(previewPath, "utf-8")) as VirtualCase[];
  for (const vc of previewCases) {
    jobStore.appendLog(jobId, `[scenario-preview-runner] beforeValidate scenario=${vc.displayId} steps=${JSON.stringify(vc.steps)}`);
  }

  for (const casePath of generatedCasePaths) {
    const generatedCase = JSON.parse(fs.readFileSync(casePath, "utf-8")) as VirtualCase;
    jobStore.appendLog(jobId, `[scenario-preview-runner] beforeValidate generatedCase=${generatedCase.displayId} steps=${JSON.stringify(generatedCase.steps)}`);
  }

  const artifactValidation = validatePreviewArtifacts(previewCases, routeProfile, appConfig);
  if (!artifactValidation.valid) {
    const errorMessage = artifactValidation.message ?? artifactValidation.error ?? "Artifact validation failed";
    saveLogFile(artifactDir, "stdout.log", "");
    saveLogFile(artifactDir, "stderr.log", "");
    const resultsPath = path.join(artifactDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify(
        {
          ok: false,
          error: artifactValidation.error,
          message: artifactValidation.message,
          scenarioId: artifactValidation.scenarioId,
          details: artifactValidation.details,
        },
        null,
        2,
      ),
      "utf-8",
    );
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage,
      summary: {
        totalStories: normalizedCases.length,
        synced: 0,
        passed: 0,
        failed: 0,
        errorMessage,
      },
    });
    jobStore.appendLog(jobId, `[run:scenario-preview] artifact validation failed: ${artifactValidation.error}`);
    jobStore.appendLog(jobId, `[run:scenario-preview] ${artifactValidation.message}`);
    if (artifactValidation.scenarioId) {
      jobStore.appendLog(jobId, `[run:scenario-preview] scenarioId=${artifactValidation.scenarioId}`);
    }
    if (artifactValidation.field) {
      jobStore.appendLog(jobId, `[validatePreviewArtifacts] field=${artifactValidation.field}`);
    }
    if (artifactValidation.details) {
      jobStore.appendLog(jobId, `[run:scenario-preview] details: ${JSON.stringify(artifactValidation.details)}`);
    }
    return;
  }

  jobStore.appendLog(jobId, `[run:scenario-preview] validating artifacts`);
  jobStore.appendLog(jobId, `[run:scenario-preview] artifacts valid`);
  const labelMapSize = buildCanonicalLabelMap(routeProfile, appConfig).size;
  jobStore.appendLog(
    jobId,
    `[run:scenario-preview] appSlug=${appSlug} routeProfile=${routeProfile?.name ?? "default"} labelMapSize=${labelMapSize}`,
  );

  // ── FASE 5: labelMapSize guard — skip if 0 when routeProfile is expected ──
  if (labelMapSize === 0 && routeProfile) {
    const errorMessage = `routeProfile "${routeProfile.name}" has labelMapSize=0. Cannot execute discovery:preview with empty label registry.`;
    jobStore.appendLog(jobId, `[run:scenario-preview] ${errorMessage}`);
    saveLogFile(artifactDir, "stdout.log", "");
    saveLogFile(artifactDir, "stderr.log", "");
    const resultsPath = path.join(artifactDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({ ok: false, error: "empty_label_registry", message: errorMessage }, null, 2),
      "utf-8",
    );
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage,
      summary: { totalStories: normalizedCases.length, synced: 0, passed: 0, failed: 0, errorMessage },
    });
    jobStore.appendLog(jobId, `[run:scenario-preview] failed reason=empty_label_registry appSlug=${appSlug}`);
    return;
  }

  const shouldPublishToTestRail = p.publishToTestRail === true;
  const shouldCreateTestRun = p.createTestRun === true;
  const shouldReportResults = p.reportResults === true;
  const selectedProjectId = p.testrailProjectId ?? (config.integrations.testRail?.projectId ? Number(config.integrations.testRail.projectId) : undefined);
  const selectedSuiteId = p.testrailSuiteId ?? (config.integrations.testRail?.suiteId ? Number(config.integrations.testRail.suiteId) : undefined);
  const selectedSectionId = p.testrailSectionId ?? (config.integrations.testRail?.sectionId ? Number(config.integrations.testRail.sectionId) : undefined);
  const cacheKey = buildCacheKey(p, normalizedScenarios, routeProfile);
  const persistedMappings = readPersistedScenarioMappings().filter((mapping) =>
    mapping.cacheKey === cacheKey &&
    mapping.projectId === selectedProjectId &&
    mapping.sectionId === selectedSectionId &&
    mapping.suiteId === selectedSuiteId,
  );

  let publishedCaseIds: number[] = [];
  let testRailRunId: number | undefined;
  let testRailRunUrl: string | undefined;
  let testRailMappings: Array<{ scenarioId: string; testRailCaseId: number; title?: string }> = [];
  const caseOutcomeMap = new Map<string, { status: "passed" | "failed" | "skipped" | "review_needed"; failureReason?: string }>();

  if (shouldPublishToTestRail || shouldCreateTestRun || shouldReportResults) {
    if (!selectedProjectId || !selectedSuiteId || !selectedSectionId) {
      const errorMessage = "publishToTestRail/createTestRun/reportResults requires projectId, suiteId and sectionId.";
      jobStore.appendLog(jobId, `[run:scenario-preview] ${errorMessage}`);
      jobStore.update(jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage,
        summary: mergeScenarioPreviewSummary(jobStore.get(jobId)?.summary, {
          errorMessage,
        }),
      });
      return;
    }

    try {
      const testRailClient = new TestRailClient(requireTestRailConfig(config));
      if (shouldPublishToTestRail) {
        const publishResult = await publishScenariosToTestRail(testRailClient, {
          projectId: selectedProjectId,
          suiteId: selectedSuiteId,
          sectionId: selectedSectionId,
          appSlug,
          sprintId: p.source?.sprintId,
          storyKey: p.source?.projectKey,
          scenarios: validScenarios,
          cacheKey,
        });
        publishedCaseIds = publishResult.caseIds;
        testRailMappings = publishResult.mappings.map((mapping) => ({
          scenarioId: mapping.scenarioId,
          testRailCaseId: mapping.testRailCaseId,
          title: mapping.scenarioTitle,
        }));
        jobStore.appendLog(jobId, `[run:scenario-preview] publishedToTestRail created=${publishResult.created} updated=${publishResult.updated} reused=${publishResult.reused} caseIds=${publishedCaseIds.join(",")}`);
      } else {
        const resolvedMappings = normalizedScenarios
          .map((scenario, index) => {
            const scenarioId = buildScenarioPreviewScenarioId(scenario, index);
            return persistedMappings.find((entry) => entry.scenarioId === scenarioId);
          })
          .filter((mapping): mapping is NonNullable<typeof mapping> => Boolean(mapping));
        publishedCaseIds = resolvedMappings.map((mapping) => mapping.testRailCaseId);
        testRailMappings = resolvedMappings.map((mapping) => ({
          scenarioId: mapping.scenarioId,
          testRailCaseId: mapping.testRailCaseId,
          title: mapping.scenarioTitle,
        }));
      }

      if (shouldCreateTestRun) {
        if (publishedCaseIds.length === 0) {
          throw new Error("No TestRail caseIds available. Publish scenarios to TestRail first or reuse existing mappings.");
        }
        const runName = buildTestRailRunName(appSlug, selectedSectionId, normalizedCases.length);
        const run = await testRailClient.addRun({
          projectId: String(selectedProjectId),
          suiteId: String(selectedSuiteId),
          name: runName,
          description: `QA Lab scenario preview run for ${appSlug} / section ${selectedSectionId}`,
          caseIds: publishedCaseIds,
        });
        testRailRunId = run.id;
        testRailRunUrl = run.url;
        jobStore.appendLog(jobId, `[run:scenario-preview] createdTestRun id=${run.id} url=${run.url ?? "n/a"}`);
        jobStore.update(jobId, {
          summary: mergeScenarioPreviewSummary(jobStore.get(jobId)?.summary, {
            testRailRunId: run.id,
            testRailRunUrl: run.url,
            caseIds: publishedCaseIds,
          }),
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const errorMessage = `Failed to publish TestRail cases or create run: ${message}`;
      jobStore.appendLog(jobId, `[run:scenario-preview] ${errorMessage}`);
      jobStore.update(jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage,
        summary: mergeScenarioPreviewSummary(jobStore.get(jobId)?.summary, {
          errorMessage,
        }),
      });
      return;
    }
  }

  if (process.env.SCENARIO_PREVIEW_SKIP_DISCOVERY_PREVIEW === "true") {
    const resultsPath = path.join(artifactDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify(
        {
          ok: true,
          skippedDiscoveryPreview: true,
          summary: {
            totalStories: normalizedCases.length,
            synced: normalizedCases.length,
            passed: 0,
            failed: 0,
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    jobStore.update(jobId, {
      status: "done",
      completedAt: new Date().toISOString(),
      summary: mergeScenarioPreviewSummary(undefined, {
        totalStories: normalizedCases.length,
        synced: normalizedCases.length,
        passed: 0,
        failed: 0,
        completed: normalizedCases.length,
        scenarioCount: normalizedCases.length,
        artifactsDir: artifactDir,
      }),
    });
    jobStore.appendLog(jobId, `[run:scenario-preview] skipped discovery:preview due to SCENARIO_PREVIEW_SKIP_DISCOVERY_PREVIEW=true`);
    return;
  }

  const opts = p.options ?? {};
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";

  const args: string[] = [
    "run",
    "discovery:preview",
    "--",
    "--input",
    previewPath,
    "--app",
    appSlug,
  ];

  if (opts.overwrite !== false) args.push("--overwrite");
  if (opts.autoPromote !== false) args.push("--auto-promote");
  if (opts.autoPom !== false) args.push("--auto-pom");
  if (opts.rerunActive !== false) args.push("--rerun-active");
  if (opts.headed) args.push("--headed");

  console.log(`[run:scenario-preview] scenarios=${normalizedCases.length} appSlug=${appSlug}`);
  console.log(`[run:scenario-preview] command=${cmd} args=${args.join(" ")}`);
  console.log(`[run:scenario-preview] jobId=${jobId}`);
  console.log(`[run:scenario-preview] artifactsDir=${artifactDir}`);
  console.log(`[run:scenario-preview] started`);

  jobStore.appendLog(jobId, `[run:scenario-preview] spawning discovery:preview`);
  jobStore.appendLog(jobId, `[run:scenario-preview] scenarios=${normalizedCases.length} appSlug=${appSlug}`);
  jobStore.appendLog(jobId, `[run:scenario-preview] artifactsDir=${artifactDir}`);
  jobStore.appendLog(jobId, `[run:scenario-preview] command=${cmd} ${args.join(" ")}`);
  jobStore.appendLog(jobId, `[run:scenario-preview] jobId=${jobId}`);
  jobStore.appendLog(jobId, `[run:scenario-preview] started`);

  const child = spawn(cmd, args, {
    shell: true,
    cwd: ROOT,
    env: process.env as NodeJS.ProcessEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  jobStore.appendLog(jobId, `[run:scenario-preview] child started pid=${child.pid}`);

  // Save stdout/stderr to files
  const stdoutLogPath = path.join(artifactDir, "stdout.log");
  const stderrLogPath = path.join(artifactDir, "stderr.log");
  let stdoutBuffer = "";
  let stderrBuffer = "";
  const finishedCaseIds = new Set<string>();
  let sawResultsLine = false;

  // FASE 5: First case timeout
  const firstCaseTimeoutMs = parseInt(process.env.SCENARIO_PREVIEW_FIRST_CASE_TIMEOUT_MS ?? "120000", 10);
  let firstCaseStarted = false;
  let firstCaseTimeoutTimer: NodeJS.Timeout | null = null;

  const startFirstCaseTimeout = () => {
    firstCaseTimeoutTimer = setTimeout(() => {
      if (!firstCaseStarted) {
        const errorMessage = `discovery:preview did not start the first case within ${firstCaseTimeoutMs}ms.`;
        jobStore.appendLog(jobId, `[run:scenario-preview] first case timeout: no case started within ${firstCaseTimeoutMs}ms`);
        jobStore.update(jobId, {
          status: "failed",
          completedAt: new Date().toISOString(),
          errorMessage,
          summary: {
            ...(jobStore.get(jobId)?.summary ?? { totalStories: 0, synced: 0, passed: 0, failed: 0 }),
            errorMessage,
          },
        });
        jobStore.appendLog(jobId, `[run:scenario-preview] failed reason=discovery_preview_no_first_case_started`);

        // Write error results
        const resultsPath = path.join(artifactDir, "results.json");
        fs.writeFileSync(
          resultsPath,
          JSON.stringify(
            {
              ok: false,
              error: "discovery_preview_no_first_case_started",
              message: errorMessage,
            },
            null,
            2,
          ),
          "utf-8",
        );

        // Kill the child process
        if (child.pid) {
          try {
            child.kill("SIGTERM");
          } catch {
            // ignore
          }
        }
      }
    }, firstCaseTimeoutMs);
  };

  startFirstCaseTimeout();

  jobStore.update(jobId, {
    status: "running",
    startedAt: new Date().toISOString(),
    process: child,
    summary: mergeScenarioPreviewSummary(undefined, {
      totalStories: normalizedCases.length,
      synced: 0,
      passed: 0,
      failed: 0,
      completed: 0,
      scenarioCount: normalizedCases.length,
      command: `${cmd} ${args.join(" ")}`,
      artifactsDir: artifactDir,
    }),
  });

  // FASE 4: Parse progress from stdout
  const parseProgressLine = (line: string) => {
    const promotionStatusPatch = parsePromotionGateStatusLine(line);
    if (promotionStatusPatch) {
      updateScenarioPreviewSummary(jobId, promotionStatusPatch);
    }

    const promotionReasonPatch = parsePromotionGateReasonLine(line);
    if (promotionReasonPatch) {
      updateScenarioPreviewSummary(jobId, promotionReasonPatch);
    }

    const resultsPatch = parseScenarioPreviewResultsLine(line);
    if (resultsPatch) {
      sawResultsLine = true;
      updateScenarioPreviewSummary(jobId, resultsPatch);
    }

    // Try JSON line first
    if (line.startsWith("{")) {
      try {
        const json = JSON.parse(line);
        if (json.type === "case_started") {
          firstCaseStarted = true;
          if (firstCaseTimeoutTimer) {
            clearTimeout(firstCaseTimeoutTimer);
            firstCaseTimeoutTimer = null;
          }
          jobStore.update(jobId, {
            currentCase: json.caseId,
            summary: mergeScenarioPreviewSummary(jobStore.get(jobId)?.summary, {
              currentCaseIndex: json.index,
              totalCases: json.total,
              scenarioCount: json.total,
              totalStories: json.total,
            }),
          });
          jobStore.appendLog(jobId, `[scenario-preview] case_started: ${json.caseId} (${json.index}/${json.total}) ${json.title}`);
          return;
        }
        if (json.type === "case_finished") {
          if (typeof json.caseId === "string" && finishedCaseIds.has(json.caseId)) {
            return;
          }
          if (typeof json.caseId === "string") {
            finishedCaseIds.add(json.caseId);
            if (typeof json.status === "string") {
              caseOutcomeMap.set(json.caseId, {
                status: json.status === "passed" || json.status === "failed" || json.status === "skipped" ? json.status : "review_needed",
                failureReason: typeof json.failureReason === "string" ? json.failureReason : typeof json.error === "string" ? json.error : undefined,
              });
            }
          }
          const currentSummary = jobStore.get(jobId)?.summary;
          jobStore.update(jobId, {
            currentCase: json.caseId,
            summary: mergeScenarioPreviewSummary(jobStore.get(jobId)?.summary, applyCaseFinishedSummaryPatch(currentSummary, json.status)),
          });
          jobStore.appendLog(jobId, `[scenario-preview] case_finished: ${json.caseId} status=${json.status}`);
          return;
        }
      } catch {
        // Not valid JSON, fall through to text parsing
      }
    }

    // Text parsing fallback
    if (line.includes("[discovery:preview] starting") || line.includes("[discovery:preview] Running")) {
      firstCaseStarted = true;
      if (firstCaseTimeoutTimer) {
        clearTimeout(firstCaseTimeoutTimer);
        firstCaseTimeoutTimer = null;
      }
      const match = line.match(/(PREVIEW-\d+)/);
      if (match) {
        jobStore.update(jobId, { currentCase: match[1] });
      }
      jobStore.appendLog(jobId, `[scenario-preview] case_started: ${line.trim()}`);
    } else if (line.includes("[discovery:preview] completed")) {
      const match = line.match(/(PREVIEW-\d+)/);
      if (match && finishedCaseIds.has(match[1])) {
        return;
      }
      if (match) {
        finishedCaseIds.add(match[1]);
        caseOutcomeMap.set(match[1], {
          status: line.includes("status=passed") ? "passed" : line.includes("status=skipped") ? "skipped" : line.includes("status=failed") ? "failed" : "review_needed",
          failureReason: line.includes("error=") ? line.split("error=").slice(1).join("error=").trim() : undefined,
        });
      }
      const currentSummary = jobStore.get(jobId)?.summary;
      const isPassed = line.includes("status=passed");
      jobStore.update(jobId, {
        currentCase: match?.[1] ?? jobStore.get(jobId)?.currentCase ?? null,
        summary: currentSummary ? mergeScenarioPreviewSummary(currentSummary, applyCaseFinishedSummaryPatch(currentSummary, isPassed ? "passed" : "failed")) : undefined,
      });
      jobStore.appendLog(jobId, `[scenario-preview] case_finished: ${line.trim()}`);
    }
  };

  const handleStdout = (data: Buffer) => {
    const text = data.toString();
    stdoutBuffer += text;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        parseProgressLine(line.trim());
        jobStore.appendLog(jobId, `[scenario-preview] stdout: ${line.trimEnd()}`);
      }
    }
  };

  const handleStderr = (data: Buffer) => {
    const text = data.toString();
    stderrBuffer += text;
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        jobStore.appendLog(jobId, `[scenario-preview] stderr: ${line.trimEnd()}`);
      }
    }
  };

  child.stdout?.on("data", handleStdout);
  child.stderr?.on("data", handleStderr);

  child.on("close", async (code) => {
    // Clear timeout
    if (firstCaseTimeoutTimer) {
      clearTimeout(firstCaseTimeoutTimer);
      firstCaseTimeoutTimer = null;
    }

    // Save log files
    saveLogFile(artifactDir, "stdout.log", stdoutBuffer);
    saveLogFile(artifactDir, "stderr.log", stderrBuffer);

    const currentSummary = jobStore.get(jobId)?.summary;
  const completedCount = currentSummary?.completed ?? 0;
    const lastStdout = stdoutBuffer.split("\n").filter((l) => l.trim()).slice(-10).join("\n");
    const lastStderr = stderrBuffer.split("\n").filter((l) => l.trim()).slice(-10).join("\n");

    let resultsSummaryAvailable = false;

    // If child failed and no cases were processed, write diagnostic results.json
    if (code !== 0 && completedCount === 0) {
      const errorMessage = lastStderr || lastStdout || `discovery:preview exited with code ${code}`;

      const resultsPath = path.join(artifactDir, "results.json");
      if (!fs.existsSync(resultsPath)) {
        fs.writeFileSync(
          resultsPath,
          JSON.stringify(
            {
              ok: false,
              error: "discovery_preview_start_failed",
              message: errorMessage,
              exitCode: code,
              command: `${cmd} ${args.join(" ")}`,
              lastStdout: lastStdout.slice(0, 2000),
              lastStderr: lastStderr.slice(0, 2000),
            },
            null,
            2,
          ),
          "utf-8",
        );
      }
    }

    // Read results.json and build errorMessage
    let resultsErrorMessage: string | undefined;
    let parsedResults: ScenarioPreviewResultsFile | null = null;
    const resultsPath = path.join(artifactDir, "results.json");
    if (fs.existsSync(resultsPath)) {
      try {
        parsedResults = JSON.parse(fs.readFileSync(resultsPath, "utf-8")) as ScenarioPreviewResultsFile;
        const results = parsedResults;
        resultsSummaryAvailable = hasUsableResultsSummary(results);
        if (results.message) {
          resultsErrorMessage = results.message;
        } else if (results.error) {
          resultsErrorMessage = results.error;
        }
        const existingSummary = jobStore.get(jobId)?.summary;
        const resultsSummaryPatch = parseScenarioPreviewResultsFile(results);
        jobStore.update(jobId, {
          summary: mergeScenarioPreviewSummary(existingSummary, resultsSummaryPatch),
        });
      } catch {
        // ignore parse errors
      }
    }

    const finalSummarySnapshot = jobStore.get(jobId)?.summary;
    const actualCompleted = finalSummarySnapshot?.completed ?? completedCount;
    const outcome = getScenarioPreviewOutcome({
      exitCode: code,
      results: parsedResults,
      completedCount: actualCompleted,
      sawCaseStarted: firstCaseStarted,
      firstCaseStarted,
    });
    const reportBeforeFirstCase = shouldReportFailedBeforeFirstCase({
      exitCode: code,
      firstCaseStarted,
      finishedCaseIds,
      completedCount: actualCompleted,
      hasResultsSummary: resultsSummaryAvailable,
      sawResultsLine,
    });

    jobStore.appendLog(jobId, `[run:scenario-preview] child exit code=${code ?? "?"}`);

    if (code !== 0) {
      if (reportBeforeFirstCase) {
        jobStore.appendLog(jobId, `[run:scenario-preview] failed before first case error=${lastStderr || lastStdout || "unknown"}`);
      } else if (actualCompleted > 0) {
        jobStore.appendLog(jobId, `[run:scenario-preview] failed after executing cases`);
        jobStore.appendLog(
          jobId,
          `[run:scenario-preview] completed summary passed=${finalSummarySnapshot?.passed ?? 0} failed=${finalSummarySnapshot?.failed ?? 0} total=${finalSummarySnapshot?.scenarioCount ?? finalSummarySnapshot?.totalStories ?? 0}`,
        );
      }
      if (lastStdout) jobStore.appendLog(jobId, `[run:scenario-preview] last stdout:\n${lastStdout}`);
      if (lastStderr) jobStore.appendLog(jobId, `[run:scenario-preview] last stderr:\n${lastStderr}`);
    } else {
      jobStore.appendLog(
        jobId,
        `[run:scenario-preview] completed summary passed=${finalSummarySnapshot?.passed ?? 0} failed=${finalSummarySnapshot?.failed ?? 0} total=${finalSummarySnapshot?.scenarioCount ?? finalSummarySnapshot?.totalStories ?? 0}`,
      );
    }

    // Determine final errorMessage
    const finalSummary = jobStore.get(jobId)?.summary;
    const promotionReason = (finalSummary as any)?.promotionReason as string | undefined;
    const hasCompletedResults = actualCompleted > 0;
    const humanSummary = hasCompletedResults
      ? `${finalSummary?.passed ?? 0} de ${finalSummary?.scenarioCount ?? finalSummary?.totalStories ?? actualCompleted} escenarios pasaron. ${(finalSummary?.failed ?? 0)} requiere revisión.`
      : undefined;
    const finalErrorMessage = outcome === "technical_failure"
      ? (resultsErrorMessage || promotionReason || lastStderr || lastStdout || `discovery:preview exited with code ${code}`)
      : humanSummary || resultsErrorMessage || promotionReason || undefined;

    const finalStatus = outcome === "completed_with_failures"
      ? "completed_with_failures"
      : code === 0
        ? "done"
        : outcome === "passed"
          ? "done"
          : "failed";

    if (shouldReportResults && testRailRunId && publishedCaseIds.length > 0) {
      const runtimeResults = buildScenarioPreviewResults(caseOutcomeMap, normalizedCases);
      try {
        const reportResponse = await reportScenarioPreviewResultsToTestRail(new TestRailClient(requireTestRailConfig(config)), {
          runId: testRailRunId,
          projectId: selectedProjectId!,
          suiteId: selectedSuiteId,
          sectionId: selectedSectionId!,
          runName: buildTestRailRunName(appSlug, selectedSectionId!, normalizedCases.length),
          artifactDir,
          results: runtimeResults,
          mappings: testRailMappings.map((mapping) => ({
            scenarioId: mapping.scenarioId,
            scenarioTitle: mapping.title ?? mapping.scenarioId,
            cacheKey,
            testRailCaseId: mapping.testRailCaseId,
            sectionId: selectedSectionId!,
            projectId: selectedProjectId!,
            suiteId: selectedSuiteId,
            updatedAt: new Date().toISOString(),
            source: "reused",
          })),
        });
        if (reportResponse.pendingReportPath) {
          jobStore.appendLog(jobId, `[run:scenario-preview] reportResults pending retry path=${reportResponse.pendingReportPath}`);
          jobStore.update(jobId, {
            summary: mergeScenarioPreviewSummary(jobStore.get(jobId)?.summary, {
              errorMessage: `TestRail report pending retry: ${reportResponse.pendingReportPath}`,
            }),
          });
        } else {
          jobStore.appendLog(jobId, `[run:scenario-preview] reported results to TestRail added=${reportResponse.added}`);
        }
      } catch (reportErr) {
        const reportMessage = reportErr instanceof Error ? reportErr.message : String(reportErr);
        jobStore.appendLog(jobId, `[run:scenario-preview] TestRail reporting failed: ${reportMessage}`);
      }
    }

    jobStore.update(jobId, {
      status: finalStatus,
      completedAt: new Date().toISOString(),
      exitCode: code ?? undefined,
      errorMessage: finalErrorMessage,
      summary: mergeScenarioPreviewSummary(jobStore.get(jobId)?.summary, {
        errorMessage: finalErrorMessage,
      }),
    });
  });

  child.on("error", (err) => {
    // Clear timeout
    if (firstCaseTimeoutTimer) {
      clearTimeout(firstCaseTimeoutTimer);
      firstCaseTimeoutTimer = null;
    }

    // Save log files
    saveLogFile(artifactDir, "stdout.log", stdoutBuffer);
    saveLogFile(artifactDir, "stderr.log", stderrBuffer);

    const errorMessage = `Child process error: ${err.message}`;

    // Write results.json
    const resultsPath = path.join(artifactDir, "results.json");
    if (!fs.existsSync(resultsPath)) {
      fs.writeFileSync(
        resultsPath,
        JSON.stringify(
          {
            ok: false,
            error: "child_process_error",
            message: errorMessage,
          },
          null,
          2,
        ),
        "utf-8",
      );
    }

    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage,
      summary: {
        ...(jobStore.get(jobId)?.summary ?? { totalStories: 0, synced: 0, passed: 0, failed: 0 }),
        errorMessage,
      },
    });
    jobStore.appendLog(jobId, `[run:scenario-preview] Error al iniciar proceso: ${err.message}`);
  });
}

type ResolvedApp = {
  appSlug: string;
  appConfig: Record<string, unknown> | null;
  routeProfile: McpRouteProfile | null;
  inference: ScenarioPreviewTargetInference;
};

function resolveEffectiveAppSlug(
  params: ScenarioPreviewParams,
  validScenarios: ScenarioPreviewParams["scenarios"],
): ResolvedApp {
  const inference = inferTargetAppSlugFromScenarios(params, validScenarios);
  const sectionSlug = inference.sectionSlug ?? (params.sectionName ? normalizeSectionSlug(params.sectionName) : undefined);
  const requestAppSlug = normalizeMaybeSlug(params.appSlug);
  const requestTargetAppSlug = normalizeMaybeSlug(params.targetAppSlug);
  const functionalAppSlug = normalizeMaybeSlug((params as { functionalAppSlug?: string }).functionalAppSlug);
  const hasFunctionalScenarioTarget = inference.scenarioTargetAppSlugs.some((slug) => !isTechnicalSlug(slug) && !isTechnicalAppName(slug) && !isTestRailSectionDerivedSlug(slug, params.sectionName, sectionSlug));

  if (
    requestAppSlug &&
    (isTechnicalSlug(requestAppSlug) || isTechnicalAppName(requestAppSlug)) &&
    !functionalAppSlug &&
    !hasFunctionalScenarioTarget &&
    (!requestTargetAppSlug || isTechnicalSlug(requestTargetAppSlug) || isTechnicalAppName(requestTargetAppSlug))
  ) {
    throw new Error(`invalid_target_app_slug: requested app "${params.appSlug}" is technical/non-executable and no valid functional target app with routeProfile was found.`);
  }

  const rawCandidateSlugs = [
    inference.effectiveTargetAppSlug,
    params.targetAppSlug,
    params.appSlug,
    ...inference.scenarioTargetAppSlugs,
  ]
    .map((slug) => normalizeMaybeSlug(slug))
    .filter((slug): slug is string => Boolean(slug));

  const candidateSlugs = rawCandidateSlugs
    .filter((slug) => !isTechnicalSlug(slug) && !isTechnicalAppName(slug))
    .filter((slug) => !isTestRailSectionDerivedSlug(slug, params.sectionName, sectionSlug));

  const candidates = Array.from(new Set(candidateSlugs));

  const tryLoad = (slug: string): ResolvedApp | null => {
    const ac = loadAppConfigSync(slug);
    const rp = extractRouteProfile(params.routeProfile, ac);
    if (isExecutableAppSlug(slug, rp)) {
      return { appSlug: slug, appConfig: ac, routeProfile: rp, inference };
    }
    return null;
  };

  for (const candidate of candidates) {
    const found = tryLoad(candidate);
    if (found) {
      console.log(
        `[scenario-preview] requestedAppSlug=${params.appSlug} functionalAppSlug=${(params as { functionalAppSlug?: string }).functionalAppSlug ?? "none"} scenarioTargetAppSlug=${inference.scenarioTargetAppSlugs[0] ?? "none"} effectiveTargetAppSlug=${found.appSlug}`,
      );
      if (sectionSlug) {
        console.log(`[scenario-preview] testRailSectionName="${params.sectionName ?? "N/A"}" sectionSlug=${sectionSlug} metadataOnly=true`);
        console.log("[scenario-preview] sectionSlug is metadata only, not appSlug");
      }
      return found;
    }
  }

  const sectionDerivedCandidate = rawCandidateSlugs.find((slug) => isTestRailSectionDerivedSlug(slug, params.sectionName, sectionSlug));
  if (sectionDerivedCandidate) {
    const errorMessage = `no_valid_functional_app_slug: section-derived slug "${sectionDerivedCandidate}" is metadata only and cannot be used as appSlug.`;
    throw new Error(errorMessage);
  }

  const technicalRequest = requestAppSlug ? isTechnicalSlug(requestAppSlug) || isTechnicalAppName(requestAppSlug) : true;

  if (technicalRequest && candidates.length === 0) {
    const errorMessage = `invalid_target_app_slug: requested app "${params.appSlug}" is technical/non-executable and no valid functional target app with routeProfile was found.`;
    throw new Error(errorMessage);
  }

  if (candidates.length > 1) {
    const errorMessage = `invalid_target_app_slug: multiple functional target apps found (${candidates.join(", ")}). Please select one app with a valid routeProfile.`;
    throw new Error(errorMessage);
  }

  const candidate = candidates[0];
  if (candidate) {
    const errorMessage = isTestRailSectionDerivedSlug(candidate, params.sectionName, sectionSlug)
      ? `no_valid_functional_app_slug: section-derived slug "${candidate}" is metadata only and cannot be used as appSlug.`
      : `invalid_target_app_slug: resolved candidate "${candidate}" does not have a valid routeProfile.`;
    throw new Error(errorMessage);
  }

  const fallbackMessage = inference.diagnostics
    ?? `invalid_target_app_slug: requested app "${params.appSlug}" is technical/non-executable and no valid functional target app with routeProfile was found.`;
  throw new Error(fallbackMessage);
}

function loadAppConfigSync(appSlug: string): Record<string, unknown> | null {
  try {
    const appConfigPath = path.join(ROOT, "automations", "apps", appSlug, "app.config.json");
    if (!fs.existsSync(appConfigPath)) return null;
    const content = fs.readFileSync(appConfigPath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

function extractRouteProfile(
  requestRouteProfile: McpRouteProfile | undefined,
  appConfig: Record<string, unknown> | null,
): McpRouteProfile | null {
  if (requestRouteProfile) return requestRouteProfile;
  if (!appConfig) return null;
  const rp = appConfig.routeProfile;
  if (rp && typeof rp === "object" && !Array.isArray(rp)) {
    return rp as McpRouteProfile;
  }
  return null;
}
