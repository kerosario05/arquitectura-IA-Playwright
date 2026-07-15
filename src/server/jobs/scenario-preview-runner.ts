import { spawn } from "child_process";
import path from "path";
import fs from "fs";
import { randomUUID } from "crypto";
import { jobStore, type JobSummary, type JobStatus } from "./job-store";
import type { PublishedCaseEntry } from "./launch-orchestrator";
import { toVirtualCase, type ScenarioPreviewRequest, type VirtualCase } from "../../types/scenario-preview.types";
import { config, requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { defectChecklistStore } from "../services/defect-checklist-store";
import {
  normalizeScenario,
  normalizeVirtualCase,
  normalizeScenarioEntryStepsOrder,
  filterUnsupportedClickTargets,
  ensureDetailScenarioHasItemSelection,
  convertUnsupportedPreOrdinalClicks,
  validateVirtualCases,
  canonicalizeText,
  buildCanonicalLabelMap,
  buildCanonicalLabelRegistry,
  loadAppConfig,
  normalizeForComparison,
  stripStepNumbering,
  buildCanonicalEntrySteps,
  applyFinalCanonicalization,
} from "../../automations/scenario-normalizer";
import { normalizeSectionSlug, resolveSectionProfileSync } from "../../automations/app-profile";
import type { McpRouteProfile } from "../../scenarios/scenario-types";
import {
  buildTestRailRunName,
  reportScenarioPreviewResultsToTestRail,
} from "../services/testrail-run-reporter";
import { publishScenariosToTestRail, readPersistedScenarioMappings } from "../services/testrail-case-publisher";
import { buildScenarioPreviewScenarioId, type ScenarioPreviewTestRailResult } from "../services/testrail-sync-types";
import { learnEntryStepsFromSnapshot } from "../services/entry-steps-learner";
import { RunEvidenceRecorder } from "../../evidence/run-evidence-recorder";
import { loadEvidenceConfig } from "../../evidence/evidence-types";

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

type CaseOutcomeEntry = {
  status: "passed" | "failed" | "skipped" | "review_needed";
  failureReason?: string;
  discoveryStatus?: string;
  failedAtStep?: number;
  failedTarget?: string;
  failedReason?: string;
  evidenceDir?: string;
  stepResults?: Array<{ stepIndex: number; action?: string; target?: string; status?: string; reason?: string; evidencePath?: string }>;
  rawError?: string;
};

async function consolidateRunEvidence(
  jobId: string,
  appSlug: string,
  sectionSlug: string | undefined,
  sectionName: string | undefined,
  caseOutcomeMap?: Map<string, CaseOutcomeEntry>,
): Promise<void> {
  try {
    const evidenceConfig = loadEvidenceConfig();
    if (!evidenceConfig.enabled || !evidenceConfig.docxEnabled) {
      console.log(`[evidence:run] skipped jobId=${jobId} reason=evidence_disabled`);
      return;
    }

    console.log(`[evidence:run] starting consolidation jobId=${jobId} appSlug=${appSlug} sectionSlug=${sectionSlug || "default-section"}`);

    const runRecorder = new RunEvidenceRecorder({
      appSlug,
      sectionSlug: sectionSlug || "default-section",
      sectionName,
      runId: jobId,
    });

    await runRecorder.start();

    // Scan artifact directory for scenario evidence.json files
    const artifactDir = path.join(ARTIFACTS_DIR, jobId);
    const evidenceRoot = evidenceConfig.outputRoot;
    const sectionSlugNormalized = sectionSlug || "default-section";
    const runDir = path.join(evidenceRoot, appSlug, sectionSlugNormalized, "runs", jobId, "scenarios");

    console.log(`[evidence:run] searching for scenarios in runDir=${runDir}`);

    if (fs.existsSync(runDir)) {
      const scenarioDirs = fs.readdirSync(runDir, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      console.log(`[evidence:run] found ${scenarioDirs.length} scenario directories: ${scenarioDirs.join(", ")}`);

      for (const scenarioDir of scenarioDirs) {
        const evidenceJsonPath = path.join(runDir, scenarioDir, "evidence.json");
        if (fs.existsSync(evidenceJsonPath)) {
          console.log(`[evidence:run] loading scenario evidence from ${evidenceJsonPath}`);
          await runRecorder.addScenarioFromFile(evidenceJsonPath);
        } else {
          console.log(`[evidence:run] evidence.json not found in ${scenarioDir}`);
        }
      }

      // Apply final status overrides from case_finished events
      // BUT: evidence gate failures (Fallido) must not be overridden to Exitoso
      if (caseOutcomeMap && caseOutcomeMap.size > 0) {
        console.log(`[evidence:run] applying ${caseOutcomeMap.size} status overrides from case_finished events`);
        for (const [scenarioId, outcome] of caseOutcomeMap.entries()) {
          // Get recorded scenario - handle both Map and object/array structures
          let recordedScenario: any = null;
          if (runRecorder.scenarios instanceof Map) {
            recordedScenario = runRecorder.scenarios.get(scenarioId);
          } else if (Array.isArray(runRecorder.scenarios)) {
            recordedScenario = runRecorder.scenarios.find((s: any) => s?.scenarioId === scenarioId || s?.id === scenarioId);
          } else if (typeof runRecorder.scenarios === "object" && runRecorder.scenarios !== null) {
            recordedScenario = runRecorder.scenarios[scenarioId];
          }

          // Check if this scenario was previously marked as failed by evidence gate
          const currentEvidenceStatus = recordedScenario?.status;
          const isEvidenceGateFailed = currentEvidenceStatus === "Fallido" &&
            (recordedScenario?.failureReasons?.some((r: string) =>
              r.includes("evidence_gate") || r.includes("missing_detail_screenshot") || r.includes("promotion_gate")
            ) ?? false);

          // Don't allow case_finished to improve Fallido (from evidence gate) to Exitoso
          if (isEvidenceGateFailed && outcome.status === "passed") {
            console.log(
              `[evidence:run] statusOverrideSkipped scenarioId=${scenarioId} from="Fallido" attempted="Exitoso" reason=evidence_gate_failed`,
            );
            continue;
          }

          runRecorder.overrideScenarioStatus(scenarioId, outcome.status, "case_finished");
        }
      }
    } else {
      console.log(`[evidence:run] runDir does not exist: ${runDir}`);
    }

    await runRecorder.finish();
    console.log(`[evidence:run] consolidated jobId=${jobId} appSlug=${appSlug} sectionSlug=${sectionSlugNormalized}`);
  } catch (err: any) {
    console.log(`[evidence:run] consolidation failed jobId=${jobId}: ${err.message}`);
  }
}

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

  // ── Extract launch metadata for TestRail result sync (Fase 2) ──
  const pRecord = p as Record<string, unknown>;
  const launchId = (pRecord.launchId as string) || undefined;
  const testRunId = pRecord.testRunId ? Number(pRecord.testRunId) : undefined;
  const jiraKey = (pRecord.jiraKey as string) || undefined;
  const publishedCases: PublishedCaseEntry[] = Array.isArray(pRecord.publishedCases) ? pRecord.publishedCases : [];

  // Log what we received from manifest
  console.log(`[launch-sync] manifest publishedCases count=${publishedCases.length}`);
  for (const pc of publishedCases) {
    console.log(`[launch-sync] received publishedCase execution=${pc.executionScenarioId ?? "MISSING"} launch=${pc.launchScenarioId ?? "—"} testrailCustom=${pc.testrailCustomScenarioId ?? "MISSING"} caseId=${pc.caseId}`);
  }

  // Build dual mapping: executionScenarioId (PREVIEW-001) → caseId AND testrailCustomScenarioId (L-{hex8}-001) → caseId
  const scenarioToCaseMap = new Map<string, number>();
  for (const pc of publishedCases) {
    // Primary key: TestRail custom_scenario_id (L-abe094d6-001) - globally unique
    if (pc.testrailCustomScenarioId) {
      scenarioToCaseMap.set(pc.testrailCustomScenarioId, pc.caseId);
    }
    // Fallback: scenarioId (should be same as testrailCustomScenarioId)
    scenarioToCaseMap.set(pc.scenarioId, pc.caseId);

    // Secondary key: Execution scenario ID (PREVIEW-001) — what discovery emits
    if (pc.executionScenarioId) {
      scenarioToCaseMap.set(pc.executionScenarioId, pc.caseId);
    }

    // Tertiary key: Launch scenario ID (LAUNCH-001) - visual only, NOT unique
    if (pc.launchScenarioId && pc.launchScenarioId !== pc.scenarioId) {
      scenarioToCaseMap.set(pc.launchScenarioId, pc.caseId);
    }
  }

  if (testRunId) {
    const scenarioIds = publishedCases.map(pc => pc.scenarioId).join(",");
    const caseIds = publishedCases.map(pc => pc.caseId).join(",");
    const executionIds = publishedCases.map(pc => pc.executionScenarioId).filter(Boolean).join(",");
    const testrailCustomIds = publishedCases.map(pc => pc.testrailCustomScenarioId).filter(Boolean).join(",");
    const mapSize = scenarioToCaseMap.size;
    console.log(`[launch-sync] metadata received launchId=${launchId} testRunId=${testRunId} publishedCases=${publishedCases.length} jiraKey=${jiraKey ?? '—'}`);
    console.log(`[launch-sync] published scenarioIds=${scenarioIds}`);
    console.log(`[launch-sync] published caseIds=${caseIds}`);
    console.log(`[launch-sync] published executionIds=${executionIds}`);
    console.log(`[launch-sync] published testrailCustomIds=${testrailCustomIds}`);
    console.log(`[launch-sync] scenarioToCaseMap size=${mapSize} entries`);
    for (const pc of publishedCases) {
      console.log(`[launch-sync] map testrailCustom=${pc.testrailCustomScenarioId ?? "—"} execution=${pc.executionScenarioId ?? "—"} launch=${pc.launchScenarioId ?? "—"} -> caseId=${pc.caseId}`);
    }
  } else {
    console.log(`[launch-sync] disabled reason="missing_launch_metadata"`);
  }

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
    const appConfigPath = `automations/apps/${appSlug}/app.config.json`;
    const errorMessage = `Resolved targetAppSlug="${appSlug}" has no valid routeProfile. ` +
      `Cannot execute scenario-preview without routeProfile with domainTerms and entry steps. ` +
      `Check app config at ${appConfigPath}. Expected routeProfile.shape: { name, entry, aliases, domainTerms, visibleControls }`;
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

  // ── FASE 2b: Resolve entrySteps from routeProfile, appConfig, or snapshot learning ──
  let entrySteps: EntryStepConfig[] = [];

  // Priority 1: explicit entrySteps in appConfig routeProfile (persisted from previous runs)
  const fromConfig = readEntryStepsFromAppConfig(appConfig);
  if (fromConfig.length > 0) {
    entrySteps = fromConfig;
    jobStore.appendLog(jobId, `[run:scenario-preview] entrySteps from appConfig (${fromConfig.length})`);
  }

  // Priority 2: entrySteps in the resolved routeProfile (provided by QA Lab in payload)
  if (entrySteps.length === 0 && routeProfile) {
    const rp = routeProfile as Record<string, unknown>;
    const rpEntrySteps = rp.entrySteps;
    if (Array.isArray(rpEntrySteps) && rpEntrySteps.length > 0) {
      const valid = rpEntrySteps.filter(
        (es: unknown): es is EntryStepConfig =>
          typeof es === "object" && es !== null && typeof (es as EntryStepConfig).action === "string" && typeof (es as EntryStepConfig).target === "string",
      );
      if (valid.length > 0) {
        entrySteps = valid;
        jobStore.appendLog(jobId, `[run:scenario-preview] entrySteps from routeProfile (${valid.length})`);
      }
    }
  }

  // Priority 3: snapshot-based learning via Playwright if no explicit entrySteps
  if (entrySteps.length === 0) {
    const firstSteps = validScenarios
      .filter((s) => s.steps && s.steps.length > 0)
      .map((s) => s.steps![0])
      .filter(Boolean);

    if (firstSteps.length > 0 && appConfig?.baseUrl) {
      jobStore.appendLog(jobId, `[run:scenario-preview] no entrySteps resolved; trying snapshot learning for baseUrl=${appConfig.baseUrl}`);
      const learned = await learnEntryStepsFromSnapshot(
        appConfig.baseUrl as string,
        {
          loginMode: appConfig.loginMode as string | undefined,
          username: appConfig.username as string | undefined,
          password: appConfig.password as string | undefined,
          scenarioFirstSteps: firstSteps,
        },
      );
      jobStore.appendLog(jobId, `[run:scenario-preview] snapshot learning: ${learned.reason}`);
      if (learned.entrySteps.length > 0) {
        entrySteps = learned.entrySteps;
      }
    }
  }

  // Priority 4: fallback — convert routeProfile.entry (old format) to entrySteps
  if (entrySteps.length === 0) {
    const fallback = resolveEntrySteps(routeProfile, appConfig);
    if (fallback.length > 0) {
      entrySteps = fallback;
      jobStore.appendLog(jobId, `[run:scenario-preview] entrySteps fallback from entry conversion (${fallback.length})`);
    }
  }

  if (entrySteps.length > 0) {
    jobStore.appendLog(jobId, `[run:scenario-preview] applying ${entrySteps.length} entrySteps`);
    applyEntryStepsToScenarios(validScenarios, entrySteps);
  } else {
    jobStore.appendLog(jobId, `[run:scenario-preview] no entrySteps resolved`);
  }

  // Persist routeProfile + entrySteps to app.config.json for child process
  if (routeProfile) {
    persistRouteProfileToAppConfig(appSlug, routeProfile, entrySteps);
  }

  // Normalize scenarios before converting to virtual cases
  const normalizedScenarios = validScenarios.map((s) => {
    const { scenario, stats } = normalizeScenario(s, routeProfile, appConfig, entrySteps);
    jobStore.appendLog(
      jobId,
      `[run:scenario-preview] normalized scenario=${s.sourceIssueKey} beforeSteps=${stats.beforeSteps} afterSteps=${stats.afterSteps} entryDeduped=${stats.entryDeduped} canonicalizedLabels=${stats.canonicalizedLabels}`,
    );
    return scenario;
  });

  // Resolve section profile from params (prefer explicit slug, then name, then fallback)
  const paramsRecord = p as Record<string, unknown>;
  const rawSectionSlug = (paramsRecord.sectionSlug as string) || undefined;
  const rawSectionName = (paramsRecord.sectionName as string) || undefined;
  const rawSectionId = (paramsRecord.sectionId as string | number) || undefined;
  const sectionProfile = resolveSectionProfileSync(rawSectionName, rawSectionSlug, rawSectionId);
  console.log(`[section-profile] source=${sectionProfile.source} sectionName="${sectionProfile.sectionName}" sectionSlug=${sectionProfile.sectionSlug}`);

  // Convert to virtual cases with section metadata
  const virtualCases = normalizedScenarios.map((s, i) => toVirtualCase(s, i, sectionProfile.sectionSlug, sectionProfile.sectionName, sectionProfile.sectionId));

  // Normalize virtual cases (second pass for safety)
  const normalizedCases: VirtualCase[] = [];
  for (const vc of virtualCases) {
    const { vc: normalized, stats } = normalizeVirtualCase(vc, routeProfile, appConfig, entrySteps);
    jobStore.appendLog(
      jobId,
      `[run:scenario-preview] normalized ${vc.displayId} beforeSteps=${stats.beforeSteps} afterSteps=${stats.afterSteps} entryDeduped=${stats.entryDeduped} canonicalizedLabels=${stats.canonicalizedLabels}`,
    );
    normalizedCases.push(normalized);
  }

  // Final ordering pass: ensure entrySteps are first in the correct order
  if (entrySteps.length > 0) {
    for (const vc of normalizedCases) {
      const result = normalizeScenarioEntryStepsOrder(vc.steps, entrySteps);
      vc.steps = result.steps;
      jobStore.appendLog(
        jobId,
        `[entry-steps] normalizedOrder scenario=${vc.displayId} inserted=${result.inserted} moved=${result.moved} alreadyFirst=${result.alreadyFirst} deduped=${result.deduped}`,
      );
    }
  }

  // PRE-GUARDS: Capture original scenario steps as authoritative source
  const originalScenarioSteps = new Map<string, string[]>();
  for (const vc of normalizedCases) {
    originalScenarioSteps.set(vc.displayId, [...vc.steps]);
  }

  // Guard: filter unsupported click targets not backed by routeProfile/snapshot
  // but PRESERVE clicks that are part of required entry steps navigation
  const entryStepsTargets = new Set(
    entrySteps
      .filter(es => es.action === "click")
      .map(es => es.target.toLowerCase())
  );

  for (const vc of normalizedCases) {
    const result = filterUnsupportedClickTargets(vc.steps, routeProfile, entrySteps);

    // Filter out converted targets that are actually required navigation
    const actuallyConverted = result.convertedTargets.filter(
      target => !entryStepsTargets.has(target.toLowerCase())
    );

    if (result.skipped > 0) {
      jobStore.appendLog(
        jobId,
        `[scenario-guard] scenario=${vc.displayId} skipped=${result.skipped} skippedReason=${result.skippedReason} allowlistSize=${result.allowlistSize} profileContextStrength=${result.profileContextStrength}`,
      );
    }

    // Restore required navigation clicks that were converted to validations
    const restoredSteps = result.steps.map((step: string) => {
      const validationMatch = step.match(/^Validar que se muestre "([^"]+)"\.?$/i);
      if (validationMatch) {
        const target = validationMatch[1];
        if (entryStepsTargets.has(target.toLowerCase())) {
          const restoredStep = `Clic en "${target}".`;
          jobStore.appendLog(
            jobId,
            `[scenario-guard] requiredNavigationActionRestored target="${target}" reason=required_navigation`,
          );
          return restoredStep;
        }
      }
      return step;
    });

    // Log preserved required navigation
    const preservedNavigation = result.convertedTargets.filter(
      target => entryStepsTargets.has(target.toLowerCase())
    );
    for (const target of preservedNavigation) {
      jobStore.appendLog(
        jobId,
        `[scenario-guard] requiredNavigationActionPreserved target="${target}" reason=required_navigation`,
      );
    }

    for (const target of actuallyConverted) {
      jobStore.appendLog(
        jobId,
        `[scenario-guard] actionTarget not backed by profile/snapshot target="${target}" handling=contextual_assertion`,
      );
    }
    vc.steps = restoredSteps;
  }

  // POST-GUARDS: Enforce scenario steps as authoritative (FINAL AUTHORITY PASS)
  // Any click that exists in original scenario MUST be preserved as click, not converted
  for (const vc of normalizedCases) {
    const originalSteps = originalScenarioSteps.get(vc.displayId) || [];
    const originalClicks = new Map<string, string>();

    // Extract all explicit clicks from original scenario
    for (const step of originalSteps) {
      const clickMatch = step.match(/^Clic en "([^"]+)"/i);
      if (clickMatch) {
        originalClicks.set(clickMatch[1].toLowerCase(), step);
      }
    }

    // Restore any original click that was converted to validation by ANY guard
    let restoredCount = 0;
    const enforcedSteps = vc.steps.map((step: string) => {
      const validationMatch = step.match(/^Validar que se muestre "([^"]+)"\.?$/i);
      if (validationMatch) {
        const target = validationMatch[1];
        const originalClick = originalClicks.get(target.toLowerCase());
        if (originalClick) {
          restoredCount++;
          jobStore.appendLog(
            jobId,
            `[scenario-guard] explicitScenarioClickPreserved target="${target}" reason=scenario_steps_authority`,
          );
          return originalClick;
        }
      }
      return step;
    });

    if (restoredCount > 0) {
      jobStore.appendLog(
        jobId,
        `[mcp-execution] scenarioStepAuthority scenario=${vc.displayId} action=restored_explicit_clicks count=${restoredCount}`,
      );
      vc.steps = enforcedSteps;
    }

    jobStore.appendLog(
      jobId,
      `[mcp-execution] routeProfileUsedAsResolverOnly appSlug=${appSlug} scenario=${vc.displayId}`,
    );
  }

  // Guard: convert unsupported short/generic click targets that appear right before ordinal selection
  for (const vc of normalizedCases) {
    const result = convertUnsupportedPreOrdinalClicks(vc.steps, routeProfile, entrySteps);
    for (const diag of result.diagnostics) {
      jobStore.appendLog(
        jobId,
        `[scenario-guard] unsupportedPreOrdinalClick target="${diag.target}" handling=contextual_assertion reason=${diag.reason}`,
      );
    }
    vc.steps = result.steps;
  }

  // Post-guards: Restore any required navigation that was converted to assertions by guards
  // This runs AFTER all guards to catch re-conversions
  for (const vc of normalizedCases) {
    vc.steps = vc.steps.map((step: string) => {
      const validationMatch = step.match(/^Validar que se muestre "([^"]+)"\.?$/i);
      if (validationMatch) {
        const target = validationMatch[1];
        if (entryStepsTargets.has(target.toLowerCase())) {
          const restoredStep = `Clic en "${target}".`;
          jobStore.appendLog(
            jobId,
            `[scenario-guard] requiredNavigationActionRestored target="${target}" source=post_guards`,
          );
          return restoredStep;
        }
      }
      return step;
    });
  }

  // Guard: ensure detail scenarios have an item selection step before detail assertions
  for (const vc of normalizedCases) {
    // Skip list-only scenarios — they should not get ordinal selection
    const isListOnly =
      /^visualiz(?:aci[oó]n|ar)\s+(?:\w+\s+)*listado/i.test(vc.title) ||
      /^validar\s+(?:el\s+)?listado/i.test(vc.title) ||
      /^mostrar\s+listado/i.test(vc.title) ||
      /listado\s+de\s+\w+/i.test(vc.title) ||
      vc.steps.some(s => /^validar que se muestre el listado/i.test(stripStepNumbering(s))) ||
      (/\blistado\b/i.test(vc.title) && !/\bdetalle\b/i.test(vc.title));
    if (isListOnly) {
      jobStore.appendLog(jobId, `[scenario-detail-guard] skipped scenario=${vc.displayId} reason=list_only`);
      continue;
    }
    const result = ensureDetailScenarioHasItemSelection(vc.steps, vc.expectedResult, routeProfile, entrySteps);
    if (result.inserted) {
      jobStore.appendLog(
        jobId,
        `[scenario-detail-guard] insertedOrdinalSelection scenario=${vc.displayId} target="${result.steps.find((s, i) => s !== vc.steps[i])}" reason=${result.reason}`,
      );
      vc.steps = result.steps;
    } else if (result.reason === "already_has_selection") {
      jobStore.appendLog(jobId, `[scenario-detail-guard] alreadyHasSelection scenario=${vc.displayId}`);
    } else if (result.reason !== "no_detail_assertions") {
      jobStore.appendLog(jobId, `[scenario-detail-guard] skipped scenario=${vc.displayId} reason=${result.reason}`);
    }
  }

  // ── FINAL CANONICALIZATION (post-guards) ──
  // Ensure all steps use canonical labels before saving and validation.
  // This catches any steps inserted or modified by guards that may have non-canonical labels.
  jobStore.appendLog(jobId, `[scenario-preview] applying final canonicalization to ${normalizedCases.length} cases`);
  const finalCanonResult = applyFinalCanonicalization(normalizedCases, routeProfile, appConfig);

  // Replace normalizedCases with canonicalized versions
  normalizedCases.length = 0;
  normalizedCases.push(...finalCanonResult.cases);

  // Log canonicalization diagnostics
  if (finalCanonResult.totalCanonicalized > 0) {
    jobStore.appendLog(
      jobId,
      `[final-canonicalization] canonicalized ${finalCanonResult.totalCanonicalized} fields across ${finalCanonResult.diagnostics.length} changes`,
    );
  }

  for (const diag of finalCanonResult.diagnostics) {
    const fieldLabel = diag.field === "step" ? `step[${diag.stepIndex}]` : diag.field;
    jobStore.appendLog(
      jobId,
      `[final-canonicalization] scenario=${diag.scenarioId} field=${fieldLabel} source=${diag.matchedSource} original="${diag.originalText}" canonical="${diag.canonicalText}"`,
    );
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
  // Expected navigation clicks = all entry steps that are clicks (minimum navigation for any route)
  const expectedNavigationTargets = new Set(
    entrySteps.map((es) => es.target.toLowerCase())
  );
  const expectedRequiredNavigationCount = entrySteps.filter((es) => es.action === "click").length;

  let hasNavigationBlockage = false;

  for (const vc of normalizedCases) {
    jobStore.appendLog(jobId, `[scenario-preview-runner] beforeWrite scenario=${vc.displayId} steps=${JSON.stringify(vc.steps)}`);

    // Verify that required navigation is preserved as clicks, not converted to assertions
    // Step 1: Repair ANY assertions that correspond to navigation entry points
    let repairedCount = 0;
    const repairedSteps = vc.steps.map((step: string) => {
      const validationMatch = step.match(/^Validar que se muestre "([^"]+)"\.?$/i);
      if (validationMatch) {
        const target = validationMatch[1];
        // Repair if target is ANY entry step (not just clicks, any action)
        if (expectedNavigationTargets.has(target.toLowerCase())) {
          const repairedStep = `Clic en "${target}".`;
          repairedCount++;
          jobStore.appendLog(
            jobId,
            `[scenario-preview-runner] requiredNavigationRepairApplied scenario=${vc.displayId} target="${target}" from=assertion to=click`,
          );
          return repairedStep;
        }
      }
      return step;
    });

    if (repairedCount > 0) {
      vc.steps = repairedSteps;
    }

    // Step 2: Validate that we have the correct number of navigation clicks
    const actualNavigationClicks = vc.steps.filter((s: string) => s.match(/^Clic en/i) && expectedNavigationTargets.has(
      (s.match(/^Clic en "([^"]+)"/i)?.[1] || "").toLowerCase()
    )).length;

    if (expectedRequiredNavigationCount > 0 && actualNavigationClicks !== expectedRequiredNavigationCount) {
      const missingTargets = Array.from(expectedNavigationTargets).filter(
        target => !vc.steps.some(s => s.match(new RegExp(`^Clic en "${target}"`, "i")))
      );
      jobStore.appendLog(
        jobId,
        `[scenario-preview-runner] requiredNavigationVerified scenario=${vc.displayId} status=error clicks=${actualNavigationClicks} expected=${expectedRequiredNavigationCount}`,
      );
      jobStore.appendLog(
        jobId,
        `[scenario-preview-runner] requiredNavigationBlocked scenario=${vc.displayId} missing="${missingTargets.join(", ")}" action=abort_before_discovery`,
      );
      hasNavigationBlockage = true;
    } else {
      jobStore.appendLog(
        jobId,
        `[scenario-preview-runner] requiredNavigationExpected scenario=${vc.displayId} expected=${expectedRequiredNavigationCount} source=full_private_navigation targets="${Array.from(expectedNavigationTargets).join("|")}"`,
      );
      jobStore.appendLog(
        jobId,
        `[scenario-preview-runner] requiredNavigationVerified scenario=${vc.displayId} status=ok clicks=${actualNavigationClicks} expected=${expectedRequiredNavigationCount}`,
      );
    }
  }

  // FAIL-FAST: If navigation is blocked, abort before writing and executing
  if (hasNavigationBlockage) {
    jobStore.appendLog(jobId, `[run:scenario-preview] aborting execution: required navigation incomplete`);
    const resultsPath = path.join(artifactDir, "results.json");
    fs.writeFileSync(
      resultsPath,
      JSON.stringify({
        ok: false,
        error: "required_navigation_incomplete",
        message: "Scenarios have missing required navigation steps. Execution aborted.",
        details: normalizedCases.map(vc => ({
          scenarioId: vc.displayId,
          title: vc.title,
          steps: vc.steps
        }))
      }, null, 2),
      "utf-8",
    );
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: "Scenarios have missing required navigation steps",
      summary: {
        totalStories: normalizedCases.length,
        synced: 0,
        passed: 0,
        failed: 0,
        errorMessage: "Navigation validation failed - execution blocked"
      }
    });
    return;
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
  const caseOutcomeMap = new Map<string, CaseOutcomeEntry>();
  const pendingSyncs: Promise<void>[] = [];
  const syncKeys = new Set<string>();
  const syncTimeoutMs = Number(process.env.TESTRAIL_RESULT_SYNC_TIMEOUT_MS) || 30000;
  let syncFailedCount = 0;

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
  console.log(`[run:scenario-preview] env EVIDENCE_RUN_ID=${jobId}`);
  console.log(`[run:scenario-preview] started`);

  // ── Enrich publishedCases with executionScenarioId by index mapping ──
  // This is critical for TestRail result sync: discovery emits case_finished with executionScenarioId (PREVIEW-001),
  // and we need to map that to the TestRail caseId.
  if (publishedCases.length > 0 && normalizedCases.length > 0) {
    console.log(`[testrail-sync] enriching publishedCases with executionScenarioId by index count=${publishedCases.length}`);

    // Rebuild scenarioToCaseMap with enriched execution IDs
    scenarioToCaseMap.clear();

    for (let i = 0; i < publishedCases.length; i++) {
      const pc = publishedCases[i];
      const normalizedCase = normalizedCases[i];

      // Derive executionScenarioId from normalized case or fallback to PREVIEW-{i+1}
      let executionScenarioId = pc.executionScenarioId;
      if (!executionScenarioId) {
        executionScenarioId = normalizedCase?.displayId ?? `PREVIEW-${String(i + 1).padStart(3, "0")}`;
        // Update in place
        pc.executionScenarioId = executionScenarioId;
        console.log(`[testrail-sync] enriched publishedCase[${i}] executionScenarioId=${executionScenarioId} caseId=${pc.caseId}`);
      }

      // Rebuild map with all keys
      // Primary: TestRail custom_scenario_id (L-{hex8}-001)
      if (pc.testrailCustomScenarioId) {
        scenarioToCaseMap.set(pc.testrailCustomScenarioId, pc.caseId);
      }
      // Fallback: scenarioId (should be same as testrailCustomScenarioId)
      scenarioToCaseMap.set(pc.scenarioId, pc.caseId);

      // Execution scenario ID (PREVIEW-001) - what discovery emits
      scenarioToCaseMap.set(executionScenarioId, pc.caseId);

      // Launch scenario ID (LAUNCH-001) - visual only
      if (pc.launchScenarioId && pc.launchScenarioId !== pc.scenarioId) {
        scenarioToCaseMap.set(pc.launchScenarioId, pc.caseId);
      }
    }

    // Log final enriched state
    const enrichedExecutionIds = publishedCases.map(pc => pc.executionScenarioId).filter(Boolean).join(",");
    const mapKeys = Array.from(scenarioToCaseMap.keys()).join(",");
    console.log(`[testrail-sync] enriched executionIds=${enrichedExecutionIds}`);
    console.log(`[testrail-sync] map keys count=${scenarioToCaseMap.size} keys=${mapKeys}`);

    // Validate that all execution IDs are present
    const missingExecutionIds = publishedCases.filter(pc => !pc.executionScenarioId);
    if (missingExecutionIds.length > 0) {
      const errorMessage = `testrail_result_mapping_invalid: ${missingExecutionIds.length} publishedCases have no executionScenarioId after enrichment`;
      console.error(`[testrail-sync] ${errorMessage}`);
      jobStore.appendLog(jobId, `[testrail-sync] ERROR: ${errorMessage}`);
    }
  }

  jobStore.appendLog(jobId, `[run:scenario-preview] spawning discovery:preview`);
  jobStore.appendLog(jobId, `[run:scenario-preview] scenarios=${normalizedCases.length} appSlug=${appSlug}`);
  jobStore.appendLog(jobId, `[run:scenario-preview] artifactsDir=${artifactDir}`);
  jobStore.appendLog(jobId, `[run:scenario-preview] command=${cmd} ${args.join(" ")}`);
  jobStore.appendLog(jobId, `[run:scenario-preview] jobId=${jobId}`);
  jobStore.appendLog(jobId, `[run:scenario-preview] started`);

  const child = spawn(cmd, args, {
    shell: true,
    cwd: ROOT,
    env: {
      ...process.env,
      EVIDENCE_RUN_ID: jobId,
    } as NodeJS.ProcessEnv,
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
          jobStore.appendLog(jobId, `[defect-checklist] completed issueKey=${issueKey} defectCount=${list.defects.length}`);
          jobStore.update(jobId, { defectCount: list.defects.length } as any);
        } else {
          jobStore.appendLog(jobId, `[defect-checklist] skipped reason=missing_issue_key jobId=${jobId}`);
        }
      }
    }, firstCaseTimeoutMs);
  };

  // Async helper for TestRail result sync (Fase 2) — called from sync parseProgressLine
  const syncSingleResult = async (
    _jobId: string,
    _testRunId: number,
    _caseId: number,
    json: Record<string, unknown>,
    _launchId: string | undefined,
    _p: ScenarioPreviewParams,
    _pRecord: Record<string, unknown>,
    _artifactDir: string,
    _scenarioCount: number,
  ): Promise<void> => {
    const { syncDiscoveryResultToTestRail, updateLaunchManifestWithResult } = await import("./testrail-result-sync");
    const rawStatus = String(json.status || "review_needed");
    const st: "passed" | "failed" | "skipped" | "review_needed" =
      rawStatus === "passed" ? "passed" :
      rawStatus === "failed" ? "failed" :
      rawStatus === "skipped" ? "skipped" : "review_needed";
    const syncResult = await syncDiscoveryResultToTestRail({
      runId: _testRunId,
      caseId: _caseId,
      scenarioId: json.caseId as string,
      discoveryStatus: st,
      title: json.title as string | undefined,
      artifactsDir: _artifactDir,
      errorMessage: json.error as string | undefined,
      launchId: _launchId,
      appSlug: _p.appSlug,
    });
    jobStore.appendLog(_jobId, `[testrail-sync] scenario=${json.caseId} caseId=${_caseId} status=${syncResult.syncStatus}`);
    if (_launchId) {
      updateLaunchManifestWithResult(_launchId, {
        scenarioId: json.caseId as string,
        caseId: _caseId,
        discoveryStatus: st,
        testRailStatusId: syncResult.statusId,
        syncStatus: syncResult.syncStatus,
        syncedAt: syncResult.syncedAt,
        error: syncResult.error,
      }, _scenarioCount);
    }
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
              const entry: CaseOutcomeEntry = {
                status: json.status === "passed" || json.status === "failed" || json.status === "skipped" ? json.status : "review_needed",
                failureReason: typeof json.failureReason === "string" ? json.failureReason : typeof json.error === "string" ? json.error : undefined,
                discoveryStatus: typeof json.discoveryStatus === "string" ? json.discoveryStatus : undefined,
                failedAtStep: typeof json.failedAtStep === "number" ? json.failedAtStep : undefined,
                failedTarget: typeof json.failedTarget === "string" ? json.failedTarget : undefined,
                failedReason: typeof json.failedReason === "string" ? json.failedReason : undefined,
                evidenceDir: typeof json.evidenceDir === "string" ? json.evidenceDir : undefined,
                stepResults: Array.isArray(json.stepResults) ? json.stepResults : undefined,
                rawError: typeof json.rawError === "string" ? json.rawError : undefined,
              };
              caseOutcomeMap.set(json.caseId, entry);
            }
          }
          const currentSummary = jobStore.get(jobId)?.summary;
          jobStore.update(jobId, {
            currentCase: json.caseId,
            summary: mergeScenarioPreviewSummary(jobStore.get(jobId)?.summary, applyCaseFinishedSummaryPatch(currentSummary, json.status)),
          });
          jobStore.appendLog(jobId, `[scenario-preview] case_finished: ${json.caseId} status=${json.status}`);

          // TestRail result sync (Fase 2) — fire-and-forget, tracked for flush
          if (testRunId && typeof json.caseId === "string" && typeof json.status === "string") {
            const caseId = scenarioToCaseMap.get(json.caseId);
            if (caseId) {
              const syncKey = `${testRunId}:${caseId}:${json.caseId}`;
              if (syncKeys.has(syncKey)) {
                jobStore.appendLog(jobId, `[testrail-sync] duplicate skipped scenario=${json.caseId} caseId=${caseId}`);
              } else {
                syncKeys.add(syncKey);
                // Determine which ID type was used for resolution
                const matchedCase = publishedCases.find(pc => pc.caseId === caseId);
                const idType = matchedCase?.executionScenarioId === json.caseId ? "execution" :
                               matchedCase?.testrailCustomScenarioId === json.caseId ? "testrailCustom" :
                               matchedCase?.scenarioId === json.caseId ? "testrail" :
                               matchedCase?.launchScenarioId === json.caseId ? "launch" : "unknown";
                jobStore.appendLog(jobId, `[testrail-sync] queued scenario=${json.caseId} idType=${idType} caseId=${caseId} runId=${testRunId}`);
                const promise = syncSingleResult(jobId, testRunId, caseId, json, launchId, p, pRecord, artifactDir, publishedCases.length)
                  .catch((err: any) => { syncFailedCount++; });
                pendingSyncs.push(promise);
              }
            } else {
              const availableIds = Array.from(scenarioToCaseMap.keys()).join(",");
              const executionIds = publishedCases.map(pc => pc.executionScenarioId).filter(Boolean).join(",");
              const testrailCustomIds = publishedCases.map(pc => pc.testrailCustomScenarioId).filter(Boolean).join(",");
              const launchIds = publishedCases.map(pc => pc.launchScenarioId).filter(Boolean).join(",");
              jobStore.appendLog(jobId, `[testrail-sync] skipped scenario=${json.caseId} reason="no_matching_case_id" executionIds=${executionIds} testrailCustomIds=${testrailCustomIds} launchIds=${launchIds}`);
            }
          }

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

    // Flush pending TestRail result syncs before completing
    if (pendingSyncs.length > 0) {
      jobStore.appendLog(jobId, `[testrail-sync] flushing pending result syncs count=${pendingSyncs.length}`);
      const startFlush = Date.now();
      const results = await Promise.allSettled(
        pendingSyncs.map(p =>
          Promise.race([
            p,
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error(`sync_timeout`)), syncTimeoutMs)
            )
          ])
        )
      );
      const elapsed = Date.now() - startFlush;
      const synced = results.filter(r => r.status === "fulfilled").length;
      const syncedFailed = results.filter(r => r.status === "rejected").length;
      syncFailedCount += syncedFailed;
      jobStore.appendLog(jobId, `[testrail-sync] flush completed synced=${synced} failed=${syncedFailed} elapsed=${elapsed}ms`);
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

    let finalStatus: JobStatus = outcome === "completed_with_failures"
      ? "completed_with_failures"
      : code === 0
        ? "done"
        : outcome === "passed"
          ? "done"
          : "failed";

    // If discovery passed but some TestRail syncs failed, reflect it in status
    if (syncFailedCount > 0 && finalStatus === "done") {
      finalStatus = "completed_with_sync_errors";
      jobStore.appendLog(jobId, `[testrail-sync] discovery passed but ${syncFailedCount} sync(s) failed; status=completed_with_sync_errors`);
    }

    // Finalize launch manifest with real terminal status
    if (launchId) {
      const { finalizeLaunchManifest } = await import("./testrail-result-sync");
      finalizeLaunchManifest(launchId, finalStatus, syncFailedCount, publishedCases.length);
    }

    // Jira traceability (Fase 3): link TestRun to selected Jira issue after all syncs
    if (launchId) {
      const { updateLaunchManifestJiraLink } = await import("./testrail-result-sync");
      if (testRunId && jiraKey) {
        const { linkTestRunToJiraIssue } = await import("./jira-traceability");
        const finalSummary = jobStore.get(jobId)?.summary;
        const jiraResult = await linkTestRunToJiraIssue({
          jiraKey,
          testRunId,
          launchId,
          appSlug,
          sectionSlug: (pRecord.sectionSlug as string) || undefined,
          finalStatus,
          summary: {
            total: publishedCases.length,
            passed: finalSummary?.passed ?? 0,
            failed: finalSummary?.failed ?? 0,
            synced: publishedCases.length - syncFailedCount,
            syncFailed: syncFailedCount,
          },
        });
        updateLaunchManifestJiraLink(launchId, jiraResult);
      } else if (!jiraKey) {
        console.log(`[jira-traceability] skipped reason="missing_jira_key"`);
        updateLaunchManifestJiraLink(launchId, { jiraKey: "", linkStatus: "skipped", linkedAt: new Date().toISOString(), errorCode: "missing_jira_key" });
      } else if (!testRunId) {
        console.log(`[jira-traceability] skipped reason="missing_test_run_id"`);
        updateLaunchManifestJiraLink(launchId, { jiraKey, linkStatus: "skipped", linkedAt: new Date().toISOString(), errorCode: "missing_test_run_id" });
      }
    }

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

    // Write per-case outcomes to results.json for rerun support
    const finalResultsPath = path.join(artifactDir, "results.json");
    try {
      const existingResults = fs.existsSync(finalResultsPath)
        ? JSON.parse(fs.readFileSync(finalResultsPath, "utf-8"))
        : {};
      const caseResults = Array.from(caseOutcomeMap.entries()).map(([caseId, outcome]) => ({
        id: caseId,
        status: outcome.status,
        failureReason: outcome.failureReason,
      }));
      fs.writeFileSync(
        finalResultsPath,
        JSON.stringify({ ...existingResults, caseResults, outcome: finalStatus }, null, 2),
        "utf-8",
      );
    } catch {
      // non-fatal; best-effort persistence of per-case outcomes
    }

    // Helper: build human-readable defect description from technicalContext (preferred) or legacy failureReason
    function buildStructuredDefectDescription(params: {
      scenarioId: string;
      scenarioTitle: string;
      failureReason?: string;
      technicalContext?: Record<string, unknown>;
      jobId?: string;
    }): string {
      const tc = params.technicalContext;
      const hasTc = tc && Object.keys(tc).length > 0;

      // Fallback to legacy builder when no technicalContext
      if (!hasTc) return buildLegacyDefectDescription(params.scenarioTitle, params.failureReason);

      const lines: string[] = [];

      // Scenario header
      lines.push(`Escenario:`);
      lines.push(`${params.scenarioId} — ${params.scenarioTitle}`);
      lines.push("");

      // Result
      lines.push("Resultado:");
      lines.push("Fallido");
      lines.push("");

      // Failed step
      const failedAtStep = typeof tc.failedAtStep === "number" ? tc.failedAtStep : undefined;
      const failedTarget = typeof tc.failedTarget === "string" ? tc.failedTarget : undefined;
      if (failedAtStep != null || failedTarget) {
        lines.push("Paso fallido:");
        const stepParts: string[] = [];
        if (failedAtStep != null) stepParts.push(`Paso ${failedAtStep}`);
        if (failedTarget) stepParts.push(failedTarget);
        lines.push(stepParts.join(": "));
        lines.push("");
      }

      // Last successful step
      const ls = tc.lastSuccessfulStep as Record<string, unknown> | undefined;
      if (ls && typeof ls.stepIndex === "number") {
        lines.push("Último paso exitoso:");
        const lsParts: string[] = [`Paso ${ls.stepIndex}`];
        if (typeof ls.action === "string") lsParts.push(ls.action);
        if (typeof ls.target === "string") lsParts.push(ls.target);
        lines.push(lsParts.join(": "));
        lines.push("");
      }

      // Expected result
      if (typeof tc.expectedResult === "string" && tc.expectedResult.trim().length > 0) {
        lines.push("Resultado esperado:");
        lines.push(tc.expectedResult);
        lines.push("");
      }

      // Actual result / reason
      const reasonCode = typeof tc.reasonCode === "string" ? tc.reasonCode : undefined;
      const rawError = typeof tc.rawError === "string" ? tc.rawError : undefined;
      const actualSummary = mapReasonCodeToHuman(reasonCode, rawError);
      if (actualSummary) {
        lines.push("Resultado actual:");
        lines.push(actualSummary);
        lines.push("");
      }

      // Technical code
      if (reasonCode) {
        lines.push("Código técnico:");
        lines.push(reasonCode);
        lines.push("");
      }

      // Execution
      if (params.jobId) {
        lines.push("Ejecución:");
        lines.push(params.jobId);
        lines.push("");
      }

      // TestRail
      const trCaseId = typeof tc.testRailCaseId === "number" || typeof tc.testRailCaseId === "string" ? String(tc.testRailCaseId) : undefined;
      const trRunId = typeof tc.testRailRunId === "number" || typeof tc.testRailRunId === "string" ? String(tc.testRailRunId) : undefined;
      if (trCaseId || trRunId) {
        const trParts: string[] = [];
        if (trCaseId) trParts.push(`Caso ${formatTestRailId(trCaseId)}`);
        if (trRunId) trParts.push(`Run ${trRunId}`);
        lines.push("TestRail:");
        lines.push(trParts.join(" · "));
        lines.push("");
      }

      // Evidence
      const hasEvidence = Boolean(tc.evidenceDir) || Boolean(tc.evidencePath) || Boolean(ls?.evidencePath);
      lines.push("Evidencia:");
      lines.push(hasEvidence ? "Evidencia técnica disponible." : "No se registró evidencia visual.");
      lines.push("");

      // Diagnostic counters
      let sections = 0;
      if (failedAtStep != null || failedTarget) sections++;
      if (ls) sections++;
      if (tc.expectedResult) sections++;
      if (actualSummary) sections++;
      if (reasonCode) sections++;
      if (trCaseId || trRunId) sections++;
      console.log(`[defect-description] scenarioId=${params.scenarioId} source=technical_context sections=${sections} hasFailedStep=${failedAtStep != null || Boolean(failedTarget)} hasExpectedResult=${Boolean(tc.expectedResult)} hasActualResult=${Boolean(actualSummary)} hasEvidence=${hasEvidence} hasTestRail=${Boolean(trCaseId || trRunId)}`);

      return lines.join("\n").trim();
    }

    function buildLegacyDefectDescription(scenarioTitle: string, failureReason?: string): string {
      const reason = (failureReason ?? "").toLowerCase();
      let problem = "El escenario falló durante la ejecución automatizada y requiere revisión.";
      if (reason.includes("assertion_not_found") || reason.includes("assertion")) {
        problem = "Durante la ejecución del escenario, no se encontró en pantalla la información esperada para completar la validación.";
      } else if (reason.includes("timeout")) {
        problem = "El escenario no pudo completarse porque la pantalla o acción esperada tardó más de lo permitido.";
      } else if (reason.includes("target_not_found") || reason.includes("element_not_found")) {
        problem = "No se encontró en pantalla la opción o elemento necesario para continuar con el escenario.";
      } else if (reason.includes("click_failed")) {
        problem = "No fue posible seleccionar la opción requerida durante la ejecución del escenario.";
      } else if (reason.includes("auth_failed") || reason.includes("authentication")) {
        problem = "No se pudo completar correctamente el flujo de autenticación requerido para ejecutar el escenario.";
      }
      console.log(`[defect-description] scenarioId=${scenarioTitle} source=legacy sections=3 hasFailedStep=false hasExpectedResult=false hasActualResult=false hasEvidence=false hasTestRail=false`);
      return `Escenario: ${scenarioTitle}\n\n${problem}\n\nAcción sugerida: revisar la evidencia y confirmar si corresponde a un defecto funcional o ajuste del caso de prueba.`;
    }

    function mapReasonCodeToHuman(reasonCode?: string, rawError?: string): string {
      if (!reasonCode && !rawError) return "";
      const code = (reasonCode ?? "").toLowerCase();
      if (code.includes("assertion_not_found") || code.includes("assertion") && !code.includes("assertion")) {
        return "La validación esperada no fue encontrada en la pantalla.";
      }
      if (code.includes("target_not_found") || code.includes("element_not_found") || code.includes("locator_resolution_failed")) {
        return "No se encontró el elemento necesario para continuar la ejecución.";
      }
      if (code.includes("timeout") || code.includes("navigation_timeout")) {
        return "La navegación o acción esperada no completó dentro del tiempo límite.";
      }
      if (code.includes("auth_failed") || code.includes("auth_flow") || code.includes("authentication")) {
        return "La autenticación no alcanzó el estado final esperado.";
      }
      if (code.includes("execution_exception") || code.includes("net::err_") || code.includes("page.goto")) {
        const err = sanitizeRawError(rawError);
        return err || "La aplicación no respondió al intentar ejecutar la prueba.";
      }
      if (code.includes("detail_evidence") || code.includes("detail_screenshot")) {
        return "No se obtuvo la evidencia requerida para validar la pantalla de detalle.";
      }
      if (code.includes("ambiguous_target")) {
        return "Se encontraron múltiples opciones coincidentes y no fue posible determinar la correcta.";
      }
      if (code) {
        return `La ejecución falló con código: ${code}`;
      }
      const sanitized = sanitizeRawError(rawError);
      return sanitized || "La ejecución automatizada no pudo completarse correctamente.";
    }

    function sanitizeRawError(raw?: string): string {
      if (!raw) return "";

      // 1. Strip ANSI escape codes
      let s = raw
        .replace(/\x1b\[[0-9;]*m/g, "")
        .replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, "");

      // 2. Redact Bearer tokens first (before generic "authorization" key matching)
      s = s.replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]");

      // 3. Redact secrets (case-insensitive patterns with common delimiters)
      const secretKeys = [
        "password", "passwd", "pwd",
        "token", "access_token", "refresh_token", "api_key", "apikey", "api-key",
        "authorization", "auth",
        "cookie", "set-cookie",
        "otp", "otp_secret", "otpsecret",
        "client_secret", "clientsecret", "client-secret",
        "secret", "private_key", "privatekey",
      ];
      for (const key of secretKeys) {
        s = s.replace(
          new RegExp(`(${key})\\s*[:=]\\s*(["\\\']?)(?:Bearer\\s+)?\\S+\\2`, "gi"),
          (_m, p1) => `${p1}=[REDACTED]`
        );
        s = s.replace(
          new RegExp(`"(${key})"\\s*:\\s*"[^"]*"`, "gi"),
          (_m, p1) => `"${p1}":"[REDACTED]"`
        );
      }

      // 4. Sanitize paths
      s = s.replace(/[A-Za-z]:\\[^\s,;]*?([^\\\s,;]+\.\w{2,5})/g, "[LOCAL_PATH]\\$1");
      s = s.replace(/\.artifacts[\\/\S]*?([^\\/\s,;]+\.\w{2,5})/g, "[ARTIFACT_PATH]\\$1");

      // 5. Normalize whitespace
      s = s.replace(/\s+/g, " ").trim();

      // 6. Truncate
      const maxLen = 500;
      if (s.length > maxLen) s = s.slice(0, maxLen) + "...";

      return s;
    }

    function formatTestRailId(raw: string): string {
      const trimmed = raw.trim();
      if (!trimmed) return trimmed;
      return trimmed.startsWith("C") && trimmed.length > 1 && /^\d+$/.test(trimmed.slice(1)) ? trimmed : `C${trimmed}`;
    }

    // Helper: infer defect severity and severityReason from failure context
    function inferDefectSeverity(failureReason?: string, _scenarioId?: string, _scenarioTitle?: string): { severity: "low" | "medium" | "high" | "critical"; severityReason: string } {
      const reason = (failureReason ?? "").toLowerCase();
      // critical: auth failures, total blockage
      if (reason.includes("auth_failed") || reason.includes("authentication") || reason.includes("login") || reason.includes("otp")) {
        return { severity: "critical", severityReason: "Fallo de autenticación o bloqueo total que impide ejecutar el flujo." };
      }
      // high: product/detail loading failures, missing key fields
      if (reason.includes("target_not_found") || reason.includes("element_not_found") || reason.includes("selection") || reason.includes("no carga") ||
          reason.includes("producto") || reason.includes("balance") || reason.includes("monto") || reason.includes("tasa") ||
          reason.includes("fecha") || reason.includes("estado") || reason.includes("certificado") || reason.includes("detalle") ||
          reason.includes("listado")) {
        return { severity: "high", severityReason: "El fallo afecta información principal esperada por la Historia de Usuario." };
      }
      // low: formatting, labels, copy, warnings
      if (reason.includes("formato") || reason.includes("formato") || reason.includes("copy") || reason.includes("label") ||
          reason.includes("warning") || reason.includes("texto secundario")) {
        return { severity: "low", severityReason: "El fallo corresponde a un aspecto visual o de formato menor." };
      }
      // default: medium
      return { severity: "medium", severityReason: "Validación esperada no encontrada. Requiere revisión funcional." };
    }

    // Auto-create defects in HU checklist for failed cases
    try {
      const finalFailed = finalSummary?.failed ?? 0;
      if (finalFailed > 0) {
        const jobParams = (jobStore.get(jobId)?.params ?? {}) as Record<string, unknown>;
        const issueKey = String(jobParams.issueKey ?? jobParams.jiraKey ?? p.jiraKey ?? "");
        if (issueKey && issueKey !== "undefined" && issueKey !== "") {
          jobStore.appendLog(jobId, `[defect-checklist] resolved issueKey=${issueKey} jobId=${jobId} failed=${finalFailed}`);

          // Collect failed cases: first from caseOutcomeMap, then from results.json as fallback
          const failedCases: Array<{
            id: string; status: string; failureReason?: string;
            discoveryStatus?: string; failedAtStep?: number; failedTarget?: string;
            failedReason?: string; evidenceDir?: string;
            stepResults?: CaseOutcomeEntry["stepResults"]; rawError?: string;
          }> = [];
          const mapSize = caseOutcomeMap.size;
          jobStore.appendLog(jobId, `[defect-checklist] caseOutcomeMap size=${mapSize}`);
          for (const [caseId, outcome] of caseOutcomeMap.entries()) {
            if (outcome.status === "failed") {
              failedCases.push({
                id: caseId, status: outcome.status, failureReason: outcome.failureReason,
                discoveryStatus: outcome.discoveryStatus,
                failedAtStep: outcome.failedAtStep,
                failedTarget: outcome.failedTarget,
                failedReason: outcome.failedReason,
                evidenceDir: outcome.evidenceDir,
                stepResults: outcome.stepResults,
                rawError: outcome.rawError,
              });
            }
          }

          // Fallback: read from results.json if caseOutcomeMap was empty
          if (failedCases.length === 0) {
            try {
              const resultsPath = path.join(artifactDir, "results.json");
              if (fs.existsSync(resultsPath)) {
                const resultsFile = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
                const caseResults = resultsFile.caseResults || resultsFile.results || [];
                if (Array.isArray(caseResults)) {
                  for (const cr of caseResults) {
                    if (cr.status === "failed") {
                      failedCases.push({ id: cr.id || cr.caseId || cr.scenarioId, status: cr.status, failureReason: cr.failureReason || cr.error });
                    }
                  }
                }
                jobStore.appendLog(jobId, `[defect-checklist] results.json fallback cases=${caseResults.length} failed=${failedCases.length}`);
              }
            } catch (_) { /* non-fatal */ }
          }

           jobStore.appendLog(jobId, `[defect-checklist] failedCases count=${failedCases.length} ids=${failedCases.map(f => f.id).join(",") || "none"}`);

          if (failedCases.length === 0) {
            jobStore.appendLog(jobId, `[defect-checklist] skipped reason=no_failed_cases_found jobId=${jobId}`);
          } else {
            const list = defectChecklistStore.getOrCreate(issueKey);
            const checklistUrl = `/checklist/${list.urlSlug}`;

            for (const fc of failedCases) {
              jobStore.appendLog(jobId, `[defect-source-shape] scenarioId=${fc.id} isFailed=${fc.status === "failed"} hasFailureReason=${Boolean(fc.failureReason)}`);
              jobStore.appendLog(jobId, `[case-outcome-enriched] scenarioId=${fc.id} keys=${Object.keys(fc).filter(k => fc[k as keyof typeof fc] != null).join(",")} stepResults=${fc.stepResults?.length ?? 0}`);
              const scenarioTitle = normalizedCases.find((nc: any) => nc.displayId === fc.id)?.title ?? fc.id;
              const vc = normalizedCases.find((nc: any) => nc.displayId === fc.id);
              const expectedResult = vc?.expectedResult ?? undefined;

              // Compute lastSuccessfulStep from stepResults (before failedAtStep)
              const stepResults = fc.stepResults ?? [];
              const sorted = [...stepResults].sort((a, b) => (a.stepIndex ?? 0) - (b.stepIndex ?? 0));
              const threshold = fc.failedAtStep ?? Infinity;
              const successfulSteps = sorted.filter(s => s.status === "found" && (s.stepIndex ?? 0) < threshold);
              const lastSuccessful = successfulSteps.length > 0 ? successfulSteps[successfulSteps.length - 1] : undefined;

              const testRailCaseId = scenarioToCaseMap.get(fc.id);
              const technicalContext: any = {
                reasonCode: fc.failedReason ?? undefined,
                discoveryStatus: fc.discoveryStatus ?? undefined,
                failedAtStep: fc.failedAtStep ?? undefined,
                failedTarget: fc.failedTarget ?? undefined,
                expectedResult: expectedResult || undefined,
                rawError: fc.rawError ?? undefined,
                evidenceDir: fc.evidenceDir ?? undefined,
                evidencePath: lastSuccessful?.evidencePath ?? undefined,
                lastSuccessfulStep: lastSuccessful
                  ? { stepIndex: lastSuccessful.stepIndex!, action: lastSuccessful.action, target: lastSuccessful.target, evidencePath: lastSuccessful.evidencePath }
                  : undefined,
                testRailCaseId: testRailCaseId ?? undefined,
                testRailRunId: testRunId ?? undefined,
              };

              // Strip undefined values from technicalContext
              Object.keys(technicalContext).forEach(k => { if (technicalContext[k] === undefined) delete technicalContext[k]; });
              if (technicalContext.lastSuccessfulStep) {
                const ls: any = technicalContext.lastSuccessfulStep;
                Object.keys(ls).forEach(k => { if (ls[k] === undefined) delete ls[k]; });
                if (Object.keys(ls).length === 0) delete technicalContext.lastSuccessfulStep;
              }
              const hasTc = Object.keys(technicalContext).length > 0;

              const existingDefect = list.defects.find(d => d.jobId === jobId && d.scenarioId === fc.id);
              if (existingDefect) {
                existingDefect.updatedAt = new Date().toISOString();
                if (fc.failureReason && fc.failureReason.length > 10) {
                  existingDefect.description = buildStructuredDefectDescription({ scenarioId: fc.id, scenarioTitle, failureReason: fc.failureReason, technicalContext, jobId });
                  const sv = inferDefectSeverity(fc.failureReason, fc.id, scenarioTitle);
                  existingDefect.severity = sv.severity;
                  existingDefect.severityReason = sv.severityReason;
                }
                if (hasTc) existingDefect.technicalContext = technicalContext;
                jobStore.appendLog(jobId, `[defect-technical-context] scenarioId=${fc.id} reasonCode=${fc.failedReason ?? 'none'} failedAtStep=${fc.failedAtStep ?? 'none'} lastSuccessfulStep=${lastSuccessful?.stepIndex ?? 'none'} evidence=${technicalContext.evidenceDir != null} testRailCaseId=${testRailCaseId ?? 'none'} testRailRunId=${testRunId ?? 'none'}`);
                jobStore.appendLog(jobId, `[defect-checklist] upsert key=${jobId}:${fc.id} issueKey=${issueKey} scenarioId=${fc.id} jobId=${jobId} action=updated`);
                continue;
              }
              const description = buildStructuredDefectDescription({ scenarioId: fc.id, scenarioTitle, failureReason: fc.failureReason, technicalContext, jobId });
              const sv = inferDefectSeverity(fc.failureReason, fc.id, scenarioTitle);
              defectChecklistStore.addDefect(issueKey, {
                description,
                severity: sv.severity,
                severityReason: sv.severityReason,
                jobId,
                scenarioId: fc.id,
                scenarioTitle,
                evidenceUrl: undefined,
                technicalContext: hasTc ? technicalContext : undefined,
              });
              jobStore.appendLog(jobId, `[defect-technical-context] scenarioId=${fc.id} reasonCode=${fc.failedReason ?? 'none'} failedAtStep=${fc.failedAtStep ?? 'none'} lastSuccessfulStep=${lastSuccessful?.stepIndex ?? 'none'} evidence=${technicalContext.evidenceDir != null} testRailCaseId=${testRailCaseId ?? 'none'} testRailRunId=${testRunId ?? 'none'}`);
              jobStore.appendLog(jobId, `[defect-upsert-shape] scenarioId=${fc.id} keys=id,scenarioId,scenarioTitle,jobId,description,severity,severityReason,evidenceUrl,status,createdAt,updatedAt,technicalContext descriptionSource=buildStructuredDefectDescription evidenceSource=none`);
              jobStore.appendLog(jobId, `[defect-checklist] upsert key=${jobId}:${fc.id} issueKey=${issueKey} scenarioId=${fc.id} jobId=${jobId} action=created`);
            }

            // Refresh checklist to get accurate defectCount after upserts
            const updatedList = defectChecklistStore.get(issueKey);
            const defectCount = updatedList ? updatedList.defects.length : failedCases.length;
            jobStore.update(jobId, { issueKey, checklistUrl, defectCount } as any);
            jobStore.appendLog(jobId, `[defect-checklist] completed issueKey=${issueKey} defectCount=${defectCount}`);
          }
        } else {
          jobStore.appendLog(jobId, `[defect-checklist] skipped reason=missing_issue_key jobId=${jobId}`);
        }
      }
    } catch (_defectErr) {
      jobStore.appendLog(jobId, `[defect-checklist] error message=${_defectErr instanceof Error ? _defectErr.message : String(_defectErr)}`);
    }

    // Write job.json metadata for rerun support (survives server restart)
    try {
      const jobSnapshot = jobStore.get(jobId);
      const params = (jobSnapshot?.params ?? {}) as Record<string, unknown>;
      const jobMeta: Record<string, unknown> = {
        createdAt: jobSnapshot?.createdAt ?? new Date().toISOString(),
        completedAt: new Date().toISOString(),
        status: finalStatus,
        appSlug,
        targetAppSlug: params.targetAppSlug ?? appSlug,
        targetAppName: params.targetAppName ?? params.targetAppSlug ?? appSlug,
        sourceJobId: params.sourceJobId,
        rerunMode: params.rerunMode,
        options: params.options,
      };
      fs.writeFileSync(
        path.join(artifactDir, "job.json"),
        JSON.stringify(jobMeta, null, 2),
        "utf-8",
      );
    } catch {
      // non-fatal; best-effort persistence
    }

    // Consolidate run evidence into single DOCX
    await consolidateRunEvidence(jobId, appSlug, sectionSlug, p.sectionName, caseOutcomeMap);

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
    let rp = extractRouteProfile(params.routeProfile, ac);
    if (!rp) {
      rp = extractRouteProfileFromScenarios(validScenarios);
      if (rp) {
        console.log(`[scenario-preview] routeProfile inferred from scenarios: "${rp.name}" entry=${rp.entry.length} controls=${rp.visibleControls.length}`);
      }
    }
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

function extractRouteProfileFromScenarios(
  scenarios: Array<{ steps?: string[]; preconditions?: string[]; routeProfile?: string }> | undefined,
): McpRouteProfile | null {
  if (!scenarios || scenarios.length === 0) return null;

  const entryLabels: string[] = [];
  const allLabels: Set<string> = new Set();
  const allRouteNames: Set<string> = new Set();

  for (const sc of scenarios) {
    if (sc.routeProfile) allRouteNames.add(sc.routeProfile);

    if (sc.preconditions) {
      for (const pc of sc.preconditions) {
        const match = pc.match(/Route\s*Profile:\s*(\S+)/i);
        if (match) allRouteNames.add(match[1]);
      }
    }

    if (!sc.steps || sc.steps.length === 0) continue;
    const firstStep = sc.steps[0];
    const labelMatch = firstStep.match(/"([^"]+)"/);
    if (labelMatch) {
      if (entryLabels.length === 0) entryLabels.push(labelMatch[1]);
      allLabels.add(labelMatch[1]);
    }
    for (const step of sc.steps) {
      const m = step.match(/"([^"]+)"/g);
      if (m) {
        m.forEach((quoted) => {
          const lbl = quoted.replace(/"/g, "");
          if (lbl.length > 0 && lbl.length < 80) allLabels.add(lbl);
        });
      }
    }
  }

  if (entryLabels.length === 0) return null;

  const sortedLabels = Array.from(allLabels).sort();
  const entry = entryLabels.map((label) => ({
    businessLabel: label
      .toLowerCase()
      .replace(/[^a-z0-9áéíóúñü\s]/g, "")
      .trim()
      .replace(/\s+/g, "_"),
    visibleLabel: label,
  }));

  const routeProfileName = allRouteNames.size === 1
    ? Array.from(allRouteNames)[0]
    : "inferred_from_scenarios";

  return {
    name: routeProfileName,
    entry,
    aliases: {},
    intermediates: {},
    domainTerms: {},
    visibleControls: sortedLabels,
    representativeFixture: {},
    notes: [`Auto-inferred from ${scenarios.length} scenario(s) during run. Persist routeProfile in app.config.json for reuse.`],
  };
}

type EntryStepConfig = {
  action: "click" | "type" | "select" | "navigate";
  target: string;
  when?: string;
  reason?: string;
};

function readEntryStepsFromAppConfig(appConfig: Record<string, unknown> | null): EntryStepConfig[] {
  if (!appConfig) return [];
  const rp = appConfig.routeProfile;
  if (!rp || typeof rp !== "object" || Array.isArray(rp)) return [];
  const entrySteps = (rp as Record<string, unknown>).entrySteps;
  if (!Array.isArray(entrySteps)) return [];
  return entrySteps.filter(
    (es): es is EntryStepConfig =>
      typeof es === "object" && es !== null && typeof (es as EntryStepConfig).action === "string" && typeof (es as EntryStepConfig).target === "string",
  );
}

function entryStepToText(entryStep: EntryStepConfig): string {
  const label = entryStep.target.trim();
  switch (entryStep.action) {
    case "click":
      return `Clic en "${label}".`;
    case "type":
      return `Escribir "${label}".`;
    case "select":
      return `Seleccionar "${label}".`;
    case "navigate":
      return `Ir a "${label}".`;
    default:
      return `Clic en "${label}".`;
  }
}

function convertEntryToEntrySteps(entry: Array<{ visibleLabel?: string; businessLabel?: string }>): EntryStepConfig[] {
  if (!entry || entry.length === 0) return [];
  return entry
    .filter((e): e is { visibleLabel: string; businessLabel?: string } => typeof e.visibleLabel === "string" && e.visibleLabel.length > 0)
    .map((e) => ({
      action: "click" as const,
      target: e.visibleLabel,
      when: "before_first_functional_step" as const,
    }));
}

function resolveEntrySteps(
  routeProfile: McpRouteProfile | null,
  appConfig: Record<string, unknown> | null,
): EntryStepConfig[] {
  const fromConfig = readEntryStepsFromAppConfig(appConfig);
  if (fromConfig.length > 0) return fromConfig;

  if (routeProfile) {
    const rp = routeProfile as Record<string, unknown>;
    const rpEntrySteps = rp.entrySteps;
    if (Array.isArray(rpEntrySteps) && rpEntrySteps.length > 0) {
      const valid = rpEntrySteps.filter(
        (es: unknown): es is EntryStepConfig =>
          typeof es === "object" && es !== null && typeof (es as EntryStepConfig).action === "string" && typeof (es as EntryStepConfig).target === "string",
      );
      if (valid.length > 0) return valid;
    }

    if (routeProfile.entry && routeProfile.entry.length > 0) {
      const converted = convertEntryToEntrySteps(routeProfile.entry);
      if (converted.length > 0) return converted;
    }
  }

  if (appConfig?.routeProfile) {
    const rp = appConfig.routeProfile as Record<string, unknown>;
    if (Array.isArray(rp.entry)) {
      const converted = convertEntryToEntrySteps(rp.entry as Array<{ visibleLabel?: string; businessLabel?: string }>);
      if (converted.length > 0) return converted;
    }
  }

  return [];
}

function persistRouteProfileToAppConfig(
  appSlug: string,
  routeProfile: McpRouteProfile,
  entrySteps: EntryStepConfig[],
): void {
  const appConfigPath = path.join(ROOT, "automations", "apps", appSlug, "app.config.json");
  if (!fs.existsSync(appConfigPath)) return;

  try {
    const content = fs.readFileSync(appConfigPath, "utf-8");
    const appConfig = JSON.parse(content);

    appConfig.routeProfile = {
      ...routeProfile,
      entrySteps,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(appConfigPath, JSON.stringify(appConfig, null, 2), "utf-8");
  } catch (err) {
    console.error(`[scenario-preview] failed to persist routeProfile: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function normalizeStepForDedup(step: string): string {
  return stripStepNumbering(step)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/["""''«»]/g, "")
    .trim();
}

function applyEntryStepsToScenarios(
  scenarios: Array<{ steps?: string[] }>,
  entrySteps: EntryStepConfig[],
): void {
  if (!entrySteps.length) return;
  const entryTexts = entrySteps.map(entryStepToText);
  const normalizedEntryTexts = entryTexts.map(normalizeStepForDedup);

  for (const sc of scenarios) {
    if (!sc.steps) continue;
    const existingSteps = sc.steps;
    const nonEntrySteps = existingSteps.filter((step) => {
      const normalized = normalizeStepForDedup(step);
      return !normalizedEntryTexts.some((net) => normalized.startsWith(net));
    });
    sc.steps = [...entryTexts, ...nonEntrySteps];
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
