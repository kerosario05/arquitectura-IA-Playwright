import { Router } from "express";
import { currentReportAnalyst } from "../../auth/report-attribution";
import { filterByProjectAccess } from "../middleware/route-policy";
import fs from "fs";
import path from "path";
import { jobStore } from "../jobs/job-store";
import { startSprintRun } from "../jobs/run-runner";
import {
  buildDiscoveryBatchChecklistIdentity,
  buildRediscoveryProvenanceLine,
  resolveDiscoveryBatchIssueKeyMetadata,
  startDiscoveryBatchRun,
} from "../jobs/discovery-batch-runner";
import { getJiraPreviewTestRailGuardError } from "../jira-preview-testrail-guard";
import { startScenarioPreviewRun,startReuseExistingPromotedSpecRun, type ReuseExistingPromotedSpecScenario } from "../jobs/scenario-preview-runner";
import { startMixedRerun } from "../jobs/mixed-rerun-orchestrator";
import { inferLegacyJiraRerunOrigin, isScenarioEligibleForEngine, resolveExecutionEngine } from "../../jira/execution-origin";
import { startMobileLaunchExecutionJob } from "../jobs/mobile-launch-execution-runner";
import { prepareRerun } from "../jobs/rerun-runner";
import { launchExecution, type LaunchScenario, type LaunchExecutionInput } from "../jobs/launch-orchestrator";
import { coordinateLaunchRequest } from "../jobs/launch-request-coordinator";
import { defectChecklistStore } from "../services/defect-checklist-store";
import type { McpRouteProfile, McpScenario } from "../../scenarios/scenario-types";
import { buildDataContext, type DataContextEntry } from "../../data/data-context";
import { config, requireJiraConfig } from "../../config/env";
import { JiraClient } from "../../clients/jira.client";
import { loadAppConfig } from "../../automations/app-auto-resolver";
import { resolveJiraConfiguredInputValues, jiraScenarioRuntimeValues } from "../../jira/jira-runtime-values";
import { collectMissingJiraRequiredInputs } from "../../jira/jira-required-input-validation";
import type { JiraScenarioInput } from "../../jira/jira-semantic-executor";
import { deriveJiraInputRequirements } from "../../jira/jira-input-requirements";
import { buildExistingJiraCaseScenarios, resolveExistingJiraCaseValues } from "../../jira/jira-existing-case-requirements";
import { resolveJiraPublishedCaseId } from "../../jira/jira-case-input-persistence";
import { getConfirmedRuntimeValues } from "../../db/project-case-runtime-value-service";
import { getProjectBySlug } from "../../db/project-repository";
import * as testDesignRepo from "../../db/test-design-repository";
import { requireTestRailConfig } from "../../config/env";
import { TestRailClient } from "../../clients/testrail.client";
import { resolveTestDesignLaunchLinks, type TestDesignCaseResolution } from "../../test-design/test-design-launch-link";
import { toJiraSemanticDesignScenario } from "../../test-design/test-design-lineage";
import { refreshEditedJiraSource } from "../../test-design/test-design-edited-source";
import { extractTextFromAdf } from "../../jira/adf-extractor";

export const runsRouter = Router();

export function resolveJobStoreSourceJobId(params: Record<string, unknown>): string {
  return typeof params.sourceJobId === "string" && params.sourceJobId.length > 0 ? params.sourceJobId : "none";
}

async function resolveJiraSummary(issueKey: string, preferredTitle: unknown): Promise<string | undefined> {
  const preferred = typeof preferredTitle === "string" ? preferredTitle.trim() : "";
  if (preferred && preferred !== issueKey) return preferred;
  if (!issueKey) return preferred || undefined;
  try {
    const issue = await new JiraClient(requireJiraConfig(config)).getIssue(issueKey, ["summary"]);
    return issue.fields?.summary?.trim() || preferred || undefined;
  } catch {
    console.warn(`[jira-evidence] summary unavailable key=${issueKey}`);
    return preferred || undefined;
  }
}

const SENSITIVE_PATTERNS = [
  /delete\s+all/i,
  /drop\s+table/i,
  /truncate\s+table/i,
  /format\s+disk/i,
  /rm\s+-rf/i,
  /sudo\s+rm/i,
];

function containsSensitiveAction(steps: string[]): boolean {
  return steps.some((step) => SENSITIVE_PATTERNS.some((p) => p.test(step)));
}

function countRuntimeOverrideValues(value: unknown): { scenarios: number; fields: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { scenarios: 0, fields: 0 };
  const counts = Object.values(value as Record<string, unknown>).map((scenarioValues) =>
    scenarioValues && typeof scenarioValues === "object" && !Array.isArray(scenarioValues)
      ? Object.values(scenarioValues as Record<string, unknown>).filter(item => typeof item === "string" && item.trim().length > 0).length
      : 0,
  );
  return { scenarios: counts.filter(count => count > 0).length, fields: counts.reduce((sum, count) => sum + count, 0) };
}

async function findMissingJiraInputsForExecution(
  appSlug: string,
  scenarios: JiraScenarioInput[],
  overrides: unknown,
) {
  const profile = appSlug ? await loadAppConfig(appSlug) : null;
  const testData = (profile?.testData ?? {}) as typeof config.app.testData;
  const testDataAliases = (profile?.testDataAliases ?? {}) as typeof config.app.testDataAliases;
  const username = typeof profile?.username === "string" ? profile.username : undefined;
  const password = typeof profile?.password === "string" ? profile.password : undefined;
  const runtimeConfig = {
    ...config,
    app: {
      ...config.app,
      appProfile: appSlug,
      name: appSlug,
      username,
      password,
      testDataAliases,
      extraLoginFields: (profile?.extraLoginFields ?? {}) as Record<string, string>,
      testData,
      rawTestData: testData as Record<string, unknown>,
    },
  };
  const configuredValues = Object.fromEntries(buildDataContext(runtimeConfig).entries.map((entry) => [entry.key, entry.value]));
  const valuesByScenario: Record<string, Record<string, string>> = {};
  for (const scenario of scenarios) {
    const requirements = scenario.inputRequirements ?? [];
    const resolved = resolveJiraConfiguredInputValues({
      overrides,
      scenarioId: scenario.scenarioId,
      displayId: scenario.scenarioId,
      requirements,
      testData,
      testDataAliases,
      profileUsername: username,
      profilePassword: password,
    });
    valuesByScenario[scenario.scenarioId] = jiraScenarioRuntimeValues(resolved, configuredValues, requirements);
  }
  return collectMissingJiraRequiredInputs(scenarios, valuesByScenario);
}

function loadJiraRerunPublishedCases(launchId: unknown, params: Record<string, unknown>): unknown[] {
  if (Array.isArray(params.publishedCases) && params.publishedCases.length > 0) return params.publishedCases;
  if (typeof launchId !== "string" || !launchId.trim()) return [];
  const manifestPath = path.resolve(".artifacts", "scenario-launch-runs", launchId, "launch-manifest.json");
  try {
    if (!fs.existsSync(manifestPath)) return [];
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as { publishedCases?: unknown };
    return Array.isArray(manifest.publishedCases) ? manifest.publishedCases : [];
  } catch {
    return [];
  }
}

/** Restore only confirmed project/case inputs for a Jira rerun; explicit request values win. */
async function hydrateJiraRerunOverrides(
  appSlug: string,
  scenarios: JiraScenarioInput[],
  explicitOverrides: unknown,
  publishedCases: unknown,
): Promise<Record<string, Record<string, string>>> {
  const hydrated: Record<string, Record<string, string>> = {};
  if (explicitOverrides && typeof explicitOverrides === "object" && !Array.isArray(explicitOverrides)) {
    for (const [scenarioId, values] of Object.entries(explicitOverrides as Record<string, unknown>)) {
      if (!values || typeof values !== "object" || Array.isArray(values)) continue;
      hydrated[scenarioId] = Object.fromEntries(Object.entries(values as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0));
    }
  }
  let projectId: string | undefined;
  try { projectId = (await getProjectBySlug(appSlug))?.id; } catch { /* use explicit/configured values if the project store is unavailable */ }
  if (!projectId) return hydrated;

  for (const scenario of scenarios) {
    const caseId = resolveJiraPublishedCaseId(publishedCases, scenario.scenarioId);
    if (caseId === undefined) continue;
    try {
      const confirmed = await getConfirmedRuntimeValues(projectId, caseId);
      const stored = Object.fromEntries(confirmed
        .filter((entry) => entry.value !== null && entry.value !== undefined && String(entry.value).trim().length > 0)
        .map((entry) => [entry.key, String(entry.value)]));
      hydrated[scenario.scenarioId] = { ...stored, ...(hydrated[scenario.scenarioId] ?? {}) };
    } catch {
      // Missing/temporarily unavailable persisted values stay visible as preflight missingInputs.
    }
  }
  return hydrated;
}

const TECHNICAL_SLUGS = new Set(["tests", "test", "api-tests", "api tests", "qa-tests", "qa tests", "default", "unknown", "undefined", "null"]);

function isTechnicalSlug(slug: string | undefined): boolean {
  if (!slug) return true;
  return TECHNICAL_SLUGS.has(slug.trim().toLowerCase());
}

function normalizeMaybeSlug(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function inferTargetAppSlug(body: {
  functionalAppSlug?: string;
  appSlug?: string;
  targetAppSlug?: string;
  scenarios?: McpScenario[];
}): { effectiveTargetAppSlug?: string; scenarioTargetAppSlugs: string[]; titlesSample: string[] } {
  const functionalAppSlug = normalizeMaybeSlug(body.functionalAppSlug);
  const scenarioTargetAppSlugs = Array.from(
    new Set(
      (body.scenarios ?? [])
        .map((scenario) => normalizeMaybeSlug(scenario.targetAppSlug))
        .filter((slug): slug is string => Boolean(slug)),
    ),
  );
  const titlesSample = (body.scenarios ?? [])
    .map((scenario) => scenario.title)
    .filter((title): title is string => typeof title === "string" && title.trim().length > 0)
    .slice(0, 3);
  const requestTargetAppSlug = normalizeMaybeSlug(body.targetAppSlug);
  const requestAppSlug = normalizeMaybeSlug(body.appSlug);

  if (functionalAppSlug && !isTechnicalSlug(functionalAppSlug)) {
    return { effectiveTargetAppSlug: functionalAppSlug, scenarioTargetAppSlugs, titlesSample };
  }

  const scenarioTarget = scenarioTargetAppSlugs.find((slug) => !isTechnicalSlug(slug));
  if (scenarioTarget) return { effectiveTargetAppSlug: scenarioTarget, scenarioTargetAppSlugs, titlesSample };
  if (requestTargetAppSlug && !isTechnicalSlug(requestTargetAppSlug)) {
    return { effectiveTargetAppSlug: requestTargetAppSlug, scenarioTargetAppSlugs, titlesSample };
  }
  if (requestAppSlug && !isTechnicalSlug(requestAppSlug)) {
    return { effectiveTargetAppSlug: requestAppSlug, scenarioTargetAppSlugs, titlesSample };
  }
  return { scenarioTargetAppSlugs, titlesSample };
}

function toPositiveInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return undefined;
    const parsed = Number(trimmed);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function extractCaseIdFromValue(value: unknown): number | undefined {
  if (value == null) return undefined;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const direct = [
      record.caseId,
      record.testRailCaseId,
      record.testrailCaseId,
      record.id,
      (record.metadata as Record<string, unknown> | undefined)?.caseId,
      (record.metadata as Record<string, unknown> | undefined)?.testRailCaseId,
    ];
    for (const candidate of direct) {
      const parsed = toPositiveInt(candidate);
      if (parsed) return parsed;
    }
    return undefined;
  }
  return toPositiveInt(value);
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function normalizeLaunchScenario(value: unknown, _fallbackPrefix: string, index: number): LaunchScenario | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const metadata = (record.metadata && typeof record.metadata === "object")
    ? record.metadata as Record<string, unknown>
    : undefined;
  const testRailCaseId = extractCaseIdFromValue(record);

  const rawScenarioId = typeof record.scenarioId === "string"
    ? record.scenarioId.trim()
    : typeof record.id === "string"
      ? record.id.trim()
      : "";
  const scenarioId = rawScenarioId || (testRailCaseId ? `TR-CASE-${testRailCaseId}` : "");

  const rawTitle = typeof record.title === "string" ? record.title.trim() : "";
  const title = rawTitle || (testRailCaseId ? `TestRail Case ${testRailCaseId}` : `Scenario ${index + 1}`);

  const scenario: LaunchScenario = {
    recordingId: typeof record.recordingId==='string'?record.recordingId:undefined,
    recordingExecutionContract: record.recordingExecutionContract,
    scenarioId,
    title,
    steps: normalizeStringArray(record.steps),
    ...(Array.isArray(record.inputRequirements) ? { inputRequirements: deriveJiraInputRequirements(normalizeStringArray(record.steps), record.inputRequirements) } : {}),
    expectedResult: typeof record.expectedResult === "string" ? record.expectedResult : "",
    ...(record.expectedResultMode === "documentation" || record.expectedResultMode === "assertion" ? { expectedResultMode: record.expectedResultMode } : {}),
    preconditions: normalizeStringArray(record.preconditions),
    routeProfile: record.routeProfile as McpRouteProfile | undefined,
    sourceIssueKey: typeof record.sourceIssueKey === "string" ? record.sourceIssueKey : undefined,
    testRailCaseId,
    metadata: (record.metadata && typeof record.metadata === "object") ? (record.metadata as Record<string, unknown>) : undefined,
    mcpExecutable: typeof record.mcpExecutable === "boolean" ? record.mcpExecutable : typeof metadata?.mcpExecutable === "boolean" ? metadata.mcpExecutable : undefined,
    executionReadiness: typeof record.executionReadiness === "string" ? record.executionReadiness : typeof metadata?.executionReadiness === "string" ? metadata.executionReadiness : undefined,
    semanticValidity: typeof record.semanticValidity === "string" ? record.semanticValidity : typeof metadata?.semanticValidity === "string" ? metadata.semanticValidity : undefined,
    automationType: typeof record.automationType === "string" ? record.automationType : typeof metadata?.automationType === "string" ? metadata.automationType : undefined,
    launchClassification: record.launchClassification === "standard" || record.launchClassification === "adaptive" || record.launchClassification === "nonAutomatable"
      ? record.launchClassification
      : undefined,
    publicationClassification: typeof record.publicationClassification === "string" ? record.publicationClassification : undefined,
    nonAutomatable: typeof record.nonAutomatable === "boolean" ? record.nonAutomatable : undefined,
    validation: record.validation && typeof record.validation==='object' && typeof (record.validation as {valid?:unknown}).valid==='boolean'
      ? {
        valid:(record.validation as {valid:boolean}).valid,
        ...(Array.isArray((record.validation as {errors?:unknown}).errors)
          ? {errors:(record.validation as {errors:unknown[]}).errors.filter((error):error is string=>typeof error==='string')}
          : {}),
      } : undefined,
    targetScreen: typeof record.targetScreen === "string" ? record.targetScreen : typeof metadata?.targetScreen === "string" ? metadata.targetScreen : undefined,
    actualChain: record.actualChain ?? metadata?.actualChain,
    requiredChain: record.requiredChain ?? metadata?.requiredChain,
    branchId: typeof record.branchId === "string" ? record.branchId : typeof metadata?.branchId === "string" ? metadata.branchId : undefined,
    functionalBranch: (record.functionalBranch ?? metadata?.functionalBranch) as LaunchScenario["functionalBranch"],
    branchAssociation: (record.branchAssociation ?? metadata?.branchAssociation) as LaunchScenario["branchAssociation"],
    requirementDependencies: Array.isArray(record.requirementDependencies) ? record.requirementDependencies : Array.isArray(metadata?.requirementDependencies) ? metadata.requirementDependencies : undefined,
    stepRequirementRefs: Array.isArray(record.stepRequirementRefs) ? record.stepRequirementRefs : Array.isArray(metadata?.stepRequirementRefs) ? metadata.stepRequirementRefs : undefined,
  };

  return scenario;
}

function collectCaseIdsFromArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const ids: number[] = [];
  for (const item of value) {
    const parsed = extractCaseIdFromValue(item);
    if (parsed) ids.push(parsed);
  }
  return ids;
}

export function extractLaunchScenariosFromPayload(body: Record<string, unknown>): LaunchScenario[] {
  const dedup = new Map<string, LaunchScenario>();

  const append = (items: unknown, fallbackPrefix: string): void => {
    if (!Array.isArray(items)) return;
    for (let i = 0; i < items.length; i++) {
      const normalized = normalizeLaunchScenario(items[i], fallbackPrefix, i);
      if (!normalized) continue;
      const key = normalized.testRailCaseId
        ? `case:${normalized.testRailCaseId}`
        : normalized.scenarioId
          ? `scenario:${normalized.scenarioId.toLowerCase()}`
          : `missing-id:${fallbackPrefix}:${i}`;
      if (!dedup.has(key)) {
        dedup.set(key, normalized);
      }
    }
  };

  append(body.selectedScenarios, "SELECTED");
  append(body.selectedGeneratedScenarios, "GENERATED");
  append(body.selectedJiraScenarios, "JIRA");
  append(body.generatedScenarios, "GENERATED");
  append(body.selectedTestRailCases, "TR-CASE");

  return Array.from(dedup.values());
}

export function extractExistingTestRailCaseIdsFromPayload(body: Record<string, unknown>, selectedScenarios: LaunchScenario[]): number[] {
  const ids = new Set<number>();
  const sources: unknown[] = [
    body.existingTestRailCaseIds,
    body.selectedCaseIds,
    body.testRailCaseIds,
    body.caseIds,
    body.selectedTestRailCases,
    body.selectedScenarios,
  ];

  for (const source of sources) {
    for (const id of collectCaseIdsFromArray(source)) {
      ids.add(id);
    }
  }

  for (const scenario of selectedScenarios) {
    const caseId = extractCaseIdFromValue(scenario);
    if (caseId) ids.add(caseId);
  }

  return Array.from(ids);
}

export function buildRunStreamPayload(
  job: {
    status: string;
    exitCode?: number;
    summary?: Record<string, unknown>;
    errorMessage?: string;
    currentCase?: string | null;
    currentCaseId?: string | null;
    currentCaseTitle?: string | null;
    startedAt?: string;
    completedAt?: string;
    durationMs?: number;
    issueKey?: string;
    checklistUrl?: string;
    defectCount?: number;
  },
  terminal = false,
) {
  const payload: Record<string, unknown> = {
    status: job.status,
    summary: job.summary,
    currentCase: job.currentCase,
    currentCaseId: job.currentCaseId,
    currentCaseTitle: job.currentCaseTitle,
    startedAt: job.startedAt,
    issueKey: job.issueKey,
    checklistUrl: job.checklistUrl,
    defectCount: job.defectCount,
    ...(terminal ? {
      exitCode: job.exitCode,
      errorMessage: job.errorMessage ?? (job.summary as any)?.errorMessage,
      completedAt: job.completedAt,
      durationMs: job.durationMs,
    } : {}),
  };
  return payload;
}

runsRouter.post("/scenario-preview", async (req, res, next) => {
  let selectedEngine: ReturnType<typeof resolveExecutionEngine>;
  try { selectedEngine = resolveExecutionEngine(req.body); } catch (error) {
    res.status(400).json({ ok: false, error: error instanceof Error ? error.message : "INVALID_EXECUTION_ORIGIN" });
    return;
  }
  console.log(`[scenario-preview] selectedExecutionEngine=${selectedEngine}`);
  const jiraGuardError = getJiraPreviewTestRailGuardError(selectedEngine, req.body);
  if (jiraGuardError) {
    res.status(400).json(jiraGuardError);
    return;
  }
  const body = req.body as {
    functionalAppSlug?: string;
    appSlug?: string;
    targetAppSlug?: string;
    targetAppName?: string;
    jiraKey?: string;
    jiraTitle?: string;
    storyTitle?: string;
    huTitle?: string;
    sectionName?: string;
    sectionSlug?: string;
    sectionId?: string | number;
    testrailProjectId?: number;
    testrailSuiteId?: number;
    testrailSectionId?: number;
    publishToTestRail?: boolean;
    createTestRun?: boolean;
    reportResults?: boolean;
    source?: {
      projectKey: string;
      sprintId?: number;
      status?: string;
    };
    scenarios?: McpScenario[];
    executionEngine?: "jira_semantic" | "recording_replay";
    scenarioOrigin?: { kind: string; jiraKey?: string; recordingId?: string };
    options?: {
      overwrite?: boolean;
      autoPromote?: boolean;
      autoPom?: boolean;
      rerunActive?: boolean;
      headed?: boolean;
    };
  };

  if (!body.scenarios || body.scenarios.length === 0) {
    res.status(400).json({
      ok: false,
      error: "invalid_preview_scenarios",
      message: "No hay escenarios válidos para ejecutar.",
    });
    return;
  }

  const validScenarios = body.scenarios.filter((s) => isScenarioEligibleForEngine(selectedEngine, s));

  if (validScenarios.length === 0) {
    res.status(400).json({
      ok: false,
      error: "invalid_preview_scenarios",
      message: "No hay escenarios válidos para ejecutar.",
    });
    return;
  }

  for (const sc of validScenarios) {
    if (!sc.steps || sc.steps.length === 0) {
      res.status(400).json({
        ok: false,
        error: "invalid_preview_scenarios",
        message: `El escenario "${sc.sourceIssueKey}" no tiene steps.`,
      });
      return;
    }
    if (containsSensitiveAction(sc.steps)) {
      res.status(400).json({
        ok: false,
        error: "sensitive_action_blocked",
        message: `El escenario "${sc.sourceIssueKey}" contiene acciones sensibles no permitidas.`,
      });
      return;
    }
  }

  const inferred = inferTargetAppSlug({ ...body, scenarios: validScenarios });
  const inferredTargetAppSlug = inferred.effectiveTargetAppSlug;
  const inferredTargetAppName = body.targetAppName ?? validScenarios[0]?.targetAppName;

  if (!body.appSlug && !body.targetAppSlug) {
    res.status(400).json({
      ok: false,
      error: "invalid_preview_scenarios",
      message: "appSlug es requerido.",
    });
    return;
  }

  const requiresTestRailSync = body.publishToTestRail === true || body.createTestRun === true || body.reportResults === true;
  if (requiresTestRailSync) {
    if (!body.testrailProjectId || !body.testrailSuiteId || !body.testrailSectionId) {
      res.status(400).json({
        ok: false,
        error: "invalid_preview_scenarios",
        message: "projectId, suiteId y sectionId son requeridos para publicar y reportar en TestRail.",
      });
      return;
    }
  }

  const issueKey = ((validScenarios[0] as any)?.sourceIssueKey || body.source?.projectKey || body.jiraKey || "").trim();
  const jiraTitle = selectedEngine === "jira_semantic"
    ? await resolveJiraSummary(issueKey, body.jiraTitle ?? body.storyTitle ?? body.huTitle)
    : undefined;

  let checklistUrl: string | undefined;
  if (issueKey) {
    const list = defectChecklistStore.getOrCreate(issueKey);
    checklistUrl = `/checklist/${list.urlSlug}`;
  }

  const jobPayload = {
    ...body,
    ...(jiraTitle ? { jiraTitle } : {}),
    executionEngine: selectedEngine === "jira_semantic" ? selectedEngine : undefined,
    issueKey,
    checklistUrl,
    targetAppSlug: inferredTargetAppSlug,
    targetAppName: inferredTargetAppName,
  };

  if (selectedEngine === "jira_semantic") {
    const overrideCounts = countRuntimeOverrideValues((req.body as Record<string, unknown>).dataOverrides);
    console.log(`[scenario-preview] jira runtime data received scenarios=${overrideCounts.scenarios} fields=${overrideCounts.fields}`);
    try {
      const appSlug = inferredTargetAppSlug ?? normalizeMaybeSlug(body.appSlug) ?? normalizeMaybeSlug(body.targetAppSlug) ?? "";
      const missing = await findMissingJiraInputsForExecution(
        appSlug,
        validScenarios as unknown as JiraScenarioInput[],
        (req.body as Record<string, unknown>).dataOverrides,
      );
      if (missing.length > 0) {
        const missingLabels = Array.from(new Set(missing.map((input) => input.label)));
        res.status(400).json({
          ok: false,
          error: "JIRA_REQUIRED_DATA_MISSING",
          message: `Completa los datos requeridos antes de ejecutar: ${missingLabels.join(", ")}.`,
          missingInputs: missing.map(({ scenarioId, scenarioTitle, label, stepIndex }) => ({ scenarioId, scenarioTitle, label, stepIndex })),
        });
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
  }

  console.log(`[scenario-preview] received sectionName="${body.sectionName ?? "(none)"}" sectionSlug="${body.sectionSlug ?? "(none)"}" sectionId="${body.sectionId ?? "(none)"}"`);

  // Log launch metadata sync forwarding
  const bodyAny = req.body as Record<string, unknown>;
  const launchId = bodyAny.launchId as string | undefined;
  const testRunIdVal = bodyAny.testRunId;
  const jiraKeyVal = bodyAny.jiraKey as string | undefined;
  const hasLaunchMeta = Boolean(launchId && testRunIdVal);
  if (hasLaunchMeta) {
    const rawPub = bodyAny.publishedCases;
    const pubCount = Array.isArray(rawPub) ? rawPub.length : 0;
    console.log(`[scenario-preview] received launch metadata launchId=${launchId} testRunId=${testRunIdVal} publishedCases=${pubCount} jiraKey=${jiraKeyVal ?? '—'}`);
  }

  const job = jobStore.create("scenario-preview", jobPayload as Record<string, unknown>);
  checklistUrl = checklistUrl ? `${checklistUrl}${checklistUrl.includes("?") ? "&" : "?"}jobId=${encodeURIComponent(job.id)}` : checklistUrl;
  if (issueKey) {
    jobStore.update(job.id, { issueKey, checklistUrl } as any);
  }
  setImmediate(() => startScenarioPreviewRun(job.id));

  res.status(202).json({
    ok: true,
    jobId: job.id,
    issueKey,
    checklistUrl,
    status: job.status,
    mode: "scenario-preview",
    scenarioCount: validScenarios.length,
  });
});

runsRouter.post("/discovery-batch", (req, res) => {
  const body = req.body as {
    caseIds?: number[];
    appSlug?: string;
    sectionName?: string;
    sectionSlug?: string;
    forceRediscovery?: boolean;
    overwrite?: boolean;
    autoPromote?: boolean;
    autoPom?: boolean;
    rerunActive?: boolean;
    headed?: boolean;
    executePromotedSpecs?: boolean;
    launchId?: string;
    testRunId?: number;
    jiraKey?: string;
    publishedCases?: Array<{
      scenarioId: string;
      caseId: number;
      title?: string;
      sourceType?: "jira_preview" | "testrail_case";
      sourceIssueKey?: string;
      launchScenarioId?: string;
      executionScenarioId?: string;
    }>;
  };

  if (!body.caseIds || body.caseIds.length === 0) {
    res.status(400).json({ error: "caseIds is required and must be a non-empty array" });
    return;
  }

  const invalidIds = body.caseIds.filter((id: number) => !Number.isInteger(id) || id <= 0);
  if (invalidIds.length > 0) {
    res.status(400).json({ error: "All caseIds must be positive integers", invalidIds });
    return;
  }

  const job = jobStore.create("discovery-batch", body as Record<string, unknown>);
  console.log(buildRediscoveryProvenanceLine({ boundary: "request", caseId: body.caseIds[0], value: body.forceRediscovery }));
  jobStore.appendLog(job.id, buildRediscoveryProvenanceLine({
    boundary: "job_store",
    jobId: job.id,
    value: job.params.forceRediscovery as boolean | undefined,
  }) + ` sourceJobId=${resolveJobStoreSourceJobId(job.params)}`);
  const checklistIdentity = buildDiscoveryBatchChecklistIdentity({
    jobId: job.id,
    launchId: body.launchId,
  });
  const checklist = defectChecklistStore.getOrCreate(checklistIdentity);
  const checklistUrl = `/checklist/${checklist.urlSlug}?jobId=${encodeURIComponent(job.id)}`;
  const defectCount = checklist.defects.filter((defect) => defect.jobId === job.id).length;
  const issueKey = resolveDiscoveryBatchIssueKeyMetadata({
    jiraKey: body.jiraKey,
    publishedCases: body.publishedCases,
  });
  jobStore.update(job.id, {
    checklistUrl,
    defectCount,
    ...(issueKey ? { issueKey } : {}),
  });
  setImmediate(() => startDiscoveryBatchRun(job.id));

  res.status(202).json({
    jobId: job.id,
    status: job.status,
    checklistUrl,
    defectCount,
    ...(issueKey ? { issueKey } : {}),
  });
});

runsRouter.post("/sprint", (req, res) => {
  const body = req.body as {
    projectKey?: string;
    sprintId?: number;
    activeSprint?: boolean;
    status?: string;
    maxResults?: number;
    app?: string;
    headed?: boolean;
    autoPromote?: boolean;
    dryRun?: boolean;
    overwrite?: boolean;
  };

  if (!body.projectKey) {
    res.status(400).json({ error: "projectKey is required" });
    return;
  }

  if (!body.activeSprint && !body.sprintId) {
    res.status(400).json({ error: "activeSprint: true or sprintId is required" });
    return;
  }

  const job = jobStore.create("sprint", body as Record<string, unknown>);
  setImmediate(() => startSprintRun(job.id));

  res.status(202).json({ jobId: job.id, status: job.status });
});

runsRouter.get("/", (req, res) => {
  const jobs = filterByProjectAccess(req.principal, jobStore.list(), (job) => {
    const params = (job.params ?? {}) as Record<string, unknown>;
    const value = params.appSlug ?? params.projectSlug;
    return typeof value === "string" ? value : null;
  });
  res.json({ jobs });
});

runsRouter.get("/:jobId", (req, res) => {
  const job = jobStore.get(req.params.jobId) ?? jobStore.getPersisted(req.params.jobId);
  if (!job) {
    res.status(404).json({ error: "Job not found" });
    return;
  }
  const rawLogsAfter = req.query.logsAfter;
  if (rawLogsAfter !== undefined) {
    const logsAfter = typeof rawLogsAfter === "string" && /^\d+$/.test(rawLogsAfter)
      ? Number(rawLogsAfter)
      : Number.NaN;
    if (!Number.isSafeInteger(logsAfter) || logsAfter < 0) {
      res.status(400).json({ error: "logsAfter must be a non-negative safe integer" });
      return;
    }
    res.json({
      ...job,
      logs: job.logs.slice(logsAfter),
      logsOffset: Math.min(logsAfter, job.logs.length),
      totalLogs: job.logs.length,
    });
    return;
  }
  res.json(job);
});

runsRouter.get("/:jobId/logs", (req, res) => {
  const jobId = req.params.jobId;
  const current = jobStore.get(jobId);

  if (!current) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Prevent an unhandled 'error' event (e.g. writing after the client disconnected
  // mid-stream) from crashing the whole process — Node re-throws unhandled 'error'
  // events on EventEmitters, which takes down the server otherwise.
  res.on("error", (err) => {
    console.error(`[runs:logs] SSE write error jobId=${jobId}: ${err.message}`);
  });

  const send = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (err) {
      console.error(`[runs:logs] SSE write failed jobId=${jobId}: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Replay buffered logs immediately
  for (const line of current.logs) {
    send("log", { line });
  }

  // If already finished, close right away
  if (current.status === "done" || current.status === "failed" || current.status === "cancelled") {
    send("done", buildRunStreamPayload({
      status: current.status,
      exitCode: current.exitCode,
      summary: current.summary,
      errorMessage: current.errorMessage,
      currentCase: (current as any).currentCase,
      currentCaseId: (current as any).currentCaseId,
      currentCaseTitle: (current as any).currentCaseTitle,
      startedAt: current.startedAt,
      completedAt: current.completedAt,
      durationMs: current.durationMs,
      issueKey: (current as any).issueKey,
      checklistUrl: (current as any).checklistUrl,
      defectCount: (current as any).defectCount,
    }, true));
    res.end();
    return;
  }

  if (current.status === "completed_with_failures" || current.status === "completed_with_sync_errors") {
    send("done", buildRunStreamPayload({
      status: current.status,
      exitCode: current.exitCode,
      summary: current.summary,
      errorMessage: current.errorMessage,
      currentCase: (current as any).currentCase,
      currentCaseId: (current as any).currentCaseId,
      currentCaseTitle: (current as any).currentCaseTitle,
      startedAt: current.startedAt,
      completedAt: current.completedAt,
      durationMs: current.durationMs,
      issueKey: (current as any).issueKey,
      checklistUrl: (current as any).checklistUrl,
      defectCount: (current as any).defectCount,
    }, true));
    res.end();
    return;
  }

  const unsubscribe = jobStore.subscribe(jobId, {
    onLog: (line) => send("log", { line }),
    onUpdate: (job) => {
      if (job.status === "done" || job.status === "failed" || job.status === "cancelled" || job.status === "completed_with_failures" || job.status === "completed_with_sync_errors") {
        send("done", buildRunStreamPayload({
          status: job.status,
          exitCode: job.exitCode,
          summary: job.summary,
          errorMessage: job.errorMessage,
          currentCase: (job as any).currentCase,
          currentCaseId: (job as any).currentCaseId,
          currentCaseTitle: (job as any).currentCaseTitle,
          startedAt: (job as any).startedAt,
          completedAt: (job as any).completedAt,
          durationMs: (job as any).durationMs,
          issueKey: (job as any).issueKey,
          checklistUrl: (job as any).checklistUrl,
          defectCount: (job as any).defectCount,
        }, true));
        unsubscribe();
        res.end();
      } else {
        send("status", buildRunStreamPayload({
          status: job.status,
          summary: job.summary,
          currentCase: (job as any).currentCase,
          currentCaseId: (job as any).currentCaseId,
          currentCaseTitle: (job as any).currentCaseTitle,
          startedAt: (job as any).startedAt,
          issueKey: (job as any).issueKey,
          checklistUrl: (job as any).checklistUrl,
          defectCount: (job as any).defectCount,
        }));
      }
    }
  });

  req.on("close", unsubscribe);
});

runsRouter.post("/:jobId/rerun", async (req, res, next) => {
  const jobId = req.params.jobId;
  const mode = (req.body?.mode as string) === "failed_only" ? "failed_only" : "all";

  // 1. Check memory first
  const historicalJiraJob = jobStore.getPersisted(jobId);
  const previous = jobStore.get(jobId) ?? (historicalJiraJob?.params.executionEngine === "jira_semantic" ? historicalJiraJob : undefined);

  if (previous) {
    if (previous.status === "running" || previous.status === "queued") {
      res.status(400).json({ ok: false, error: "job_in_progress", message: `Cannot rerun job ${jobId}: status is ${previous.status}. Wait until it completes.` });
      return;
    }
  }

  const memoryJobMiss = !previous;

  // Jira reruns retain their explicit provenance and never enter Recording hydration/reuse.
  if (previous?.params.executionEngine === "jira_semantic") {
    const manifest = path.resolve(".artifacts/scenario-preview-runs", jobId, "jira-scenarios.json");
    const all = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, "utf8")) as McpScenario[] : previous.params.scenarios as McpScenario[] | undefined;
    if (!all?.length) { res.status(409).json({ ok: false, error: "JIRA_RERUN_SOURCE_MISSING" }); return; }
    const resultsPath = path.resolve(".artifacts/scenario-preview-runs", jobId, "results.json");
    const outcomes = fs.existsSync(resultsPath) ? JSON.parse(fs.readFileSync(resultsPath, "utf8")).results as Array<{ scenarioId: string; status: string }> : [];
    const selected = mode === "all" ? all : all.filter(s => outcomes.some(r => r.scenarioId === s.scenarioId && r.status === "failed"));
    if (!selected.length) { res.status(409).json({ ok: false, error: "NO_JIRA_SCENARIOS_TO_RERUN" }); return; }
    const requestedDataOverrides = req.body?.dataOverrides ?? previous.params.dataOverrides;
    const appSlug = String(previous.params.appSlug ?? previous.params.targetAppSlug ?? "");
    const publishedCases = loadJiraRerunPublishedCases(previous.params.launchId, previous.params);
    let dataOverrides: Record<string, Record<string, string>>;
    try {
      dataOverrides = await hydrateJiraRerunOverrides(appSlug, selected as JiraScenarioInput[], requestedDataOverrides, publishedCases);
      const missing = await findMissingJiraInputsForExecution(appSlug, selected as JiraScenarioInput[], dataOverrides);
      if (missing.length > 0) {
        const missingLabels = Array.from(new Set(missing.map((input) => input.label)));
        res.status(400).json({
          ok: false,
          error: "JIRA_REQUIRED_DATA_MISSING",
          message: `No se inició la reejecución. Completa los datos requeridos y vuelve a intentarlo: ${missingLabels.join(", ")}.`,
          missingInputs: missing.map(({ scenarioId, scenarioTitle, label, stepIndex }) => ({ scenarioId, scenarioTitle, label, stepIndex })),
        });
        return;
      }
    } catch (error) {
      next(error);
      return;
    }
    const newJob = jobStore.create("scenario-preview", { ...previous.params, scenarios: selected, sourceJobId: jobId, dataOverrides,
      options: { ...(previous.params.options as Record<string, unknown> ?? {}), overwrite: true } });
    setImmediate(() => startScenarioPreviewRun(newJob.id));
    res.json({ ok: true, jobId: newJob.id, status: newJob.status, mode: "rerun", scenarioCount: selected.length, issueKey: previous.issueKey });
    return;
  }

  // 2. Prepare rerun from canonical artifacts by job type.
  const prepared = await prepareRerun(jobId, mode, previous?.type);
  if (!prepared.ok) {
    // No in-memory job and no persisted source artifacts → explicit source-not-found error.
    if (memoryJobMiss && (prepared.error === "missing_preview_scenarios" || prepared.error === "missing_mobile_rerun_manifest")) {
      res.status(404).json({
        ok: false,
        error: "rerun_source_not_found",
        sourceJobId: jobId,
        message: prepared.message,
      });
      return;
    }
    if (prepared.error === "missing_preview_scenarios" || prepared.error === "missing_mobile_rerun_manifest") {
      res.status(404).json(prepared);
      return;
    }
    res.status(400).json(prepared);
    return;
  }

  if (prepared.jobType === "discovery-batch") {
    const discoveryJob = jobStore.create("discovery-batch", prepared.discoveryParams);
    const checklistIdentity = buildDiscoveryBatchChecklistIdentity({ jobId: discoveryJob.id });
    const checklist = defectChecklistStore.getOrCreate(checklistIdentity);
    const checklistUrl = `/checklist/${checklist.urlSlug}?jobId=${encodeURIComponent(discoveryJob.id)}`;
    jobStore.update(discoveryJob.id, {
      checklistUrl,
      defectCount: checklist.defects.filter((defect) => defect.jobId === discoveryJob.id).length,
    });
    jobStore.appendLog(
      discoveryJob.id,
      `[runs:rerun] sourceJobId=${jobId} mode=${mode} selected=${prepared.selectedCount} total=${prepared.totalCount} dispatch=fresh_discovery_batch appSlug=${prepared.appSlug}`,
    );
    setImmediate(() => startDiscoveryBatchRun(discoveryJob.id));
    res.json({
      ok: true,
      jobId: discoveryJob.id,
      status: discoveryJob.status,
      mode: "rerun",
      rerunMode: mode,
      scenarioCount: prepared.selectedCount,
      totalOriginal: prepared.totalCount,
      dispatch: "fresh_discovery_batch",
      appSlug: prepared.appSlug,
    });
    return;
  }

  console.log(`[runs:rerun] sourceResolution=${previous ? "memory" : "artifact"}`);
  console.log(`[runs:rerun] sourceJobId=${jobId} memoryJob=${!memoryJobMiss} artifactFallback=${memoryJobMiss} sourceJobType=${prepared.jobType}`);

  // Resolve issueKey: body > sourceJob > sourceJob.params > artifact > scenarios
  let issueKey = String(req.body?.issueKey || req.body?.jiraKey || "");
  if (!issueKey && previous) {
    issueKey = String((previous as any).issueKey || (previous.params as any)?.issueKey || (previous.params as any)?.jiraKey || "");
  }
  if (!issueKey) {
    // Try to infer from the first scenario in prepared.scenarios
    const firstSc = prepared.jobType === "scenario-preview"
      ? (Array.isArray(prepared.scenarios) ? (prepared.scenarios[0] as any) : null)
      : (Array.isArray(prepared.mobileParams.scenarios) ? (prepared.mobileParams.scenarios[0] as any) : null);
    if (firstSc) {
      issueKey = String(firstSc.sourceIssueKey || firstSc.issueKey || firstSc.jiraKey || firstSc.refs || "");
    }
  }
  const source = issueKey ? (req.body?.issueKey ? "body" : previous ? "sourceJob" : "artifact") : "missing";
  console.log(`[runs:rerun] resolved issueKey=${issueKey || "missing"} source=${source}`);

  // Build checklistUrl if issueKey resolved
  let checklistUrl: string | undefined;
  if (issueKey && issueKey !== "undefined" && issueKey !== "") {
    const { defectChecklistStore } = await import("../services/defect-checklist-store");
    const list = defectChecklistStore.getOrCreate(issueKey);
    checklistUrl = `/checklist/${list.urlSlug}`;
  } else {
    console.log(`[runs:rerun] warning missing_issue_key sourceJobId=${jobId}`);
  }

  // Older Jira-generated scenario-preview jobs predate the explicit engine marker. Recover
  // only when every selected persisted scenario carries this same Jira key and none has
  // Recording lineage; recorded-session reruns continue through their existing path below.
  if (prepared.jobType === "scenario-preview") {
    const jiraOrigin = inferLegacyJiraRerunOrigin(issueKey, prepared.scenarios);
    if (jiraOrigin) {
      const jiraScenarios = prepared.scenarios.map((scenario) => ({
        scenarioId: String(scenario.scenarioId),
        title: scenario.title,
        sourceIssueKey: scenario.sourceIssueKey,
        steps: scenario.steps,
        expectedResult: scenario.expectedResult,
        expectedResultMode: (scenario as unknown as JiraScenarioInput).expectedResultMode,
        preconditions: scenario.preconditions,
        authIntent: scenario.authIntent,
        inputRequirements: scenario.inputRequirements,
      }));
      const requestedDataOverrides = req.body?.dataOverrides ?? previous?.params.dataOverrides;
      const appSlug = String(prepared.appSlug ?? previous?.params.appSlug ?? previous?.params.targetAppSlug ?? "");
      const launchContext = resolveLaunchContextForRerun(jobId, prepared);
      const publishedCases = loadJiraRerunPublishedCases(
        launchContext?.launchId ?? previous?.params.launchId,
        { ...(previous?.params ?? {}), ...(launchContext?.publishedCases ? { publishedCases: launchContext.publishedCases } : {}) },
      );
      let dataOverrides: Record<string, Record<string, string>>;
      try {
        dataOverrides = await hydrateJiraRerunOverrides(appSlug, jiraScenarios as JiraScenarioInput[], requestedDataOverrides, publishedCases);
        const missing = await findMissingJiraInputsForExecution(appSlug, jiraScenarios as JiraScenarioInput[], dataOverrides);
        if (missing.length > 0) {
          const missingLabels = Array.from(new Set(missing.map((input) => input.label)));
          res.status(400).json({
            ok: false,
            error: "JIRA_REQUIRED_DATA_MISSING",
            message: `No se inició la reejecución. Completa los datos requeridos y vuelve a intentarlo: ${missingLabels.join(", ")}.`,
            missingInputs: missing.map(({ scenarioId, scenarioTitle, label, stepIndex }) => ({ scenarioId, scenarioTitle, label, stepIndex })),
          });
          return;
        }
      } catch (error) {
        next(error);
        return;
      }
      const jiraJob = jobStore.create("scenario-preview", {
        appSlug: prepared.appSlug,
        targetAppSlug: prepared.targetAppSlug,
        targetAppName: prepared.targetAppName,
        sectionName: prepared.sectionName,
        sectionSlug: prepared.sectionSlug,
        scenarios: jiraScenarios,
        jiraKey: jiraOrigin.jiraKey,
        issueKey: jiraOrigin.jiraKey,
        executionEngine: "jira_semantic",
        scenarioOrigin: jiraOrigin,
        sourceJobId: jobId,
        rerunMode: mode,
        rerun: true,
        dataOverrides,
        publishToTestRail: false,
        createTestRun: false,
        reportResults: false,
        options: { ...(prepared.options ?? {}), overwrite: true, autoPromote: true, autoPom: false },
      });
      if (checklistUrl) jobStore.update(jiraJob.id, { issueKey: jiraOrigin.jiraKey, checklistUrl } as any);
      jobStore.appendLog(jiraJob.id, `[runs:rerun] sourceJobId=${jobId} mode=${mode} selected=${prepared.selectedCount} total=${prepared.totalCount} dispatch=jira_semantic recoveredOrigin=scenario_source_issue_key`);
      jobStore.appendLog(jiraJob.id, `[scenario-preview] selectedExecutionEngine=jira_semantic compiler=jira-semantic-v1 origin=${jiraOrigin.jiraKey}`);
      setImmediate(() => startScenarioPreviewRun(jiraJob.id));
      res.json({ ok: true, jobId: jiraJob.id, status: jiraJob.status, mode: "rerun", scenarioCount: prepared.selectedCount, issueKey: jiraOrigin.jiraKey, executionEngine: "jira_semantic" });
      return;
    }
  }

  // A rerun whose EVERY selected scenario already has a fresh, canonically-matched promoted
  // spec needs no discovery, no AI, and no TestRail publish — it is the exact `reuse_existing`
  // decision recordings.ts's own /execute handler already dispatches via
  // startReuseExistingPromotedSpecRun. A MIXED batch (some reusable, some not) is NOT split
  // here — see promotedSpecReuse's own doc comment for why a partial-reuse job isn't attempted
  // — it falls through to the existing, safe scenario-preview fallback below unchanged.
  if (prepared.jobType === "scenario-preview") {
    for (const entry of prepared.promotedSpecReuse) {
      console.log(
        `[promoted-spec-rerun] scenarioId=${entry.scenarioId} specPath=${entry.specPath ?? "none"} `
        + `state=${entry.specState} decision=${entry.reuse ? "reuse" : "regenerate"}`
      );
    }
    if (!prepared.allReusable && prepared.promotedSpecReuse.some((e) => e.reuse)) {
      console.log(`[promoted-spec-rerun] classification=MIXED_RERUN dispatch=mixed_rerun_orchestrator`);
      const reuseEntries = prepared.promotedSpecReuse.filter((e) => e.reuse);
      const reuseIds = new Set(reuseEntries.map((e) => e.scenarioId));
      const reuseScenarios: ReuseExistingPromotedSpecScenario[] = reuseEntries.map((entry) => ({
        scenarioId: entry.scenarioId,
        caseId: entry.caseId ?? 0,
        specPath: entry.specPath!,
        title: entry.title ?? entry.scenarioId,
        steps: entry.steps,
        runtimeValues: entry.runtimeValues,
      }));
      const fallbackScenarios = prepared.scenarios.filter((s) => !s.scenarioId || !reuseIds.has(s.scenarioId));

      const parentJob = jobStore.create("scenario-preview", {
        appSlug: prepared.appSlug,
        recordingId: prepared.recordingId,
        sourceJobId: jobId,
        rerunMode: mode,
        rerun: true,
        executionMode: "mixed_rerun",
        recordingSelections: prepared.recordingSelections,
        sectionName: prepared.sectionName,
        sectionSlug: prepared.sectionSlug,
        environment: prepared.environment,
      });
      jobStore.appendLog(
        parentJob.id,
        `[runs:rerun] sourceJobId=${jobId} mode=${mode} selected=${prepared.selectedCount} total=${prepared.totalCount} `
        + `dispatch=mixed_rerun reuseCount=${reuseScenarios.length} fallbackCount=${fallbackScenarios.length}`,
      );
      setImmediate(() => startMixedRerun({
        parentJobId: parentJob.id,
        appSlug: prepared.appSlug,
        targetAppSlug: prepared.targetAppSlug,
        targetAppName: prepared.targetAppName,
        sectionName: prepared.sectionName,
        sectionSlug: prepared.sectionSlug,
        options: prepared.options,
        sourceJobId: jobId,
        rerunMode: mode,
        reuseScenarios,
        fallbackScenarios,
      }));
      res.json({
        ok: true,
        jobId: parentJob.id,
        status: parentJob.status,
        mode: "rerun",
        rerunMode: mode,
        scenarioCount: prepared.selectedCount,
        totalOriginal: prepared.totalCount,
        memoryJob: !!previous,
        artifactFallback: memoryJobMiss,
        dispatch: "mixed_rerun",
      });
      return;
    }
    if (prepared.allReusable) {
      const reuseJobScenarios: ReuseExistingPromotedSpecScenario[] = prepared.promotedSpecReuse.map((entry) => ({
        scenarioId: entry.scenarioId,
        caseId: entry.caseId ?? 0,
        specPath: entry.specPath!,
        title: entry.title ?? entry.scenarioId,
        steps: entry.steps,
        runtimeValues: entry.runtimeValues,
      }));
      const reuseJob = jobStore.create("scenario-preview", {
        appSlug: prepared.appSlug,
        recordingId: prepared.recordingId,
        sourceJobId: jobId,
        rerunMode: mode,
        rerun: true,
        scenarios: reuseJobScenarios,
        executionMode: "reuse_existing_promoted_spec",
        recordingSelections: prepared.recordingSelections,
        environment: prepared.environment,
      });
      jobStore.appendLog(reuseJob.id, `[runs:rerun] sourceJobId=${jobId} mode=${mode} selected=${prepared.selectedCount} total=${prepared.totalCount} dispatch=reuse_existing_promoted_spec`);
      for (const s of reuseJobScenarios) {
        console.log(`[promoted-spec-rerun] phase=execution_start scenarioId=${s.scenarioId} specPath=${s.specPath}`);
      }
      setImmediate(() => startReuseExistingPromotedSpecRun(reuseJob.id));
      res.json({
        ok: true,
        jobId: reuseJob.id,
        status: reuseJob.status,
        mode: "rerun",
        rerunMode: mode,
        scenarioCount: prepared.selectedCount,
        totalOriginal: prepared.totalCount,
        memoryJob: !!previous,
        artifactFallback: memoryJobMiss,
        dispatch: "reuse_existing_promoted_spec",
      });
      return;
    }
  }

  // 4. Build new job payload
  let newPayload: Record<string, unknown>;

  if (prepared.jobType === "mobile-launch-execution") {
    newPayload = {
      ...prepared.mobileParams,
      sourceJobId: jobId,
      rerunMode: mode,
      rerun: true,
    };
  } else if (previous) {
    // Memory path: inherit all previous params
    const prevParams = previous.params as Record<string, unknown>;
    newPayload = {
      ...prevParams,
      scenarios: prepared.scenarios,
      sourceJobId: jobId,
      rerunMode: mode,
      rerun: true,
      issueKey,
      checklistUrl,
      sectionName: prevParams.sectionName,
      sectionSlug: prevParams.sectionSlug,
      publishToTestRail: prevParams.publishToTestRail ?? false,
      createTestRun: prevParams.createTestRun ?? false,
      reportResults: prevParams.reportResults ?? false,
    };
  } else {
    // Disk-only path: build payload from artifact metadata. Recover launch context
    // (launchId/testRunId/publishedCases) from the persisted launch manifest when present.
    const launchMeta = resolveLaunchContextForRerun(jobId, prepared);
    newPayload = {
      scenarios: prepared.scenarios,
      appSlug: prepared.appSlug,
      targetAppSlug: prepared.targetAppSlug,
      targetAppName: prepared.targetAppName,
      sourceJobId: jobId,
      rerunMode: mode,
      rerun: true,
      issueKey,
      checklistUrl,
      launchId: launchMeta?.launchId,
      testRunId: launchMeta?.testRunId,
      publishedCases: launchMeta?.publishedCases,
      sectionName: prepared.sectionName,
      sectionSlug: prepared.sectionSlug,
      environment: prepared.environment,
      publishToTestRail: false,
      createTestRun: false,
      reportResults: false,
      options: prepared.options ?? {
        overwrite: true,
        autoPromote: true,
        autoPom: true,
        rerunActive: true,
        headed: false,
      },
    };
  }

  const newJob = jobStore.create(prepared.jobType, newPayload);
  const scopedChecklistUrl = checklistUrl
    ? `${checklistUrl}${checklistUrl.includes("?") ? "&" : "?"}jobId=${encodeURIComponent(newJob.id)}`
    : checklistUrl;
  if (issueKey && issueKey !== "undefined" && issueKey !== "") {
    jobStore.update(newJob.id, { issueKey, checklistUrl: scopedChecklistUrl } as any);
  }
  jobStore.appendLog(newJob.id, `[runs:rerun] sourceJobId=${jobId} mode=${mode} selected=${prepared.selectedCount} total=${prepared.totalCount}`);
   jobStore.appendLog(newJob.id, `[runs:rerun] newJobId=${newJob.id} issueKey=${issueKey || "?"} checklistUrl=${scopedChecklistUrl || "?"}`);
  jobStore.appendLog(newJob.id, `[runs:rerun] appSlug=${prepared.appSlug}`);
  jobStore.appendLog(newJob.id, `[runs:rerun] sourceJobType=${prepared.jobType}`);

  if (prepared.jobType === "mobile-launch-execution") {
    setImmediate(() => startMobileLaunchExecutionJob(newJob.id));
  } else {
    setImmediate(() => startScenarioPreviewRun(newJob.id));
  }

  res.json({
    ok: true,
    jobId: newJob.id,
    status: newJob.status,
    issueKey,
    checklistUrl: scopedChecklistUrl,
    mode: "rerun",
    rerunMode: mode,
    scenarioCount: prepared.selectedCount,
    totalOriginal: prepared.totalCount,
    memoryJob: !!previous,
    artifactFallback: memoryJobMiss,
  });
});

  runsRouter.post("/launch-execution", async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const requestHasContextOnly = Object.prototype.hasOwnProperty.call(body, "contextOnly");
    const requestContextOnly = body.contextOnly;
    console.log(`[context-only-trace] boundary=backend_route requestHasField=${requestHasContextOnly} requestValue=${requestContextOnly === undefined ? "undefined" : requestContextOnly} parsedValue=${requestContextOnly === undefined ? "undefined" : requestContextOnly}`);
    const appSlug = String(body.appSlug ?? "");
    const selectedScenarios = extractLaunchScenariosFromPayload(body);
    const existingTestRailCaseIds = extractExistingTestRailCaseIdsFromPayload(body, selectedScenarios);
    console.log(
      `[launch-execution] received payload appSlug=${appSlug} scenarios=${selectedScenarios.length} existingCaseIds=${existingTestRailCaseIds.length} projectId=${body.projectId} sectionId=${body.sectionId}`,
    );
    const dataOverrides = body.dataOverrides && typeof body.dataOverrides === "object" && !Array.isArray(body.dataOverrides)
      ? body.dataOverrides as Record<string, Record<string, string>>
      : undefined;
    const requestedResolutions = body.testDesignCaseResolutions && typeof body.testDesignCaseResolutions === "object"
      && !Array.isArray(body.testDesignCaseResolutions)
      ? body.testDesignCaseResolutions as Record<string, unknown>
      : {};
    const testDesignCaseResolutions: Record<string, TestDesignCaseResolution> = {};
    for (const [caseId, resolution] of Object.entries(requestedResolutions)) {
      if (resolution === "sync_and_run" || resolution === "run_as_testrail") testDesignCaseResolutions[caseId] = resolution;
    }
    const testDesignLinks = existingTestRailCaseIds.length
      // Resolve by exact TestRail case ID first, then compare the project in the link.
      // Filtering here would hide a wrong-project selection and silently fall back to generic Discovery.
      ? await testDesignRepo.getPublishedCaseLinks(existingTestRailCaseIds)
      : [];
    let testDesignLinkedCases: Awaited<ReturnType<typeof resolveTestDesignLaunchLinks>>["linked"] = [];
    if (testDesignLinks.length) {
      const linkResolution = await resolveTestDesignLaunchLinks({
        caseIds: existingTestRailCaseIds,
        projectId: Number(body.projectId),
        appSlug,
        links: testDesignLinks,
        resolutions: testDesignCaseResolutions,
        client: new TestRailClient(requireTestRailConfig(config)),
      });
      if (linkResolution.conflicts.length) {
        res.status(409).json({
          ok: false,
          error: "TEST_DESIGN_CASE_CONTENT_DIVERGED",
          message: "Algunos casos TestRail vinculados a Diseño cambiaron desde su publicación. Elige sincronizarlos con Diseño o ejecutarlos como casos TestRail normales.",
          conflicts: linkResolution.conflicts,
        });
        return;
      }
      const appConfig = await loadAppConfig(appSlug);
      const authFlowAvailable = await fs.promises.access(path.resolve("automations/apps", appSlug, "flows", "auth.flow.ts")).then(() => true, () => false);
      const issueCache = new Map<string, Promise<Awaited<ReturnType<JiraClient["getIssue"]>>>>();
      const jira = new JiraClient(requireJiraConfig(config));
      testDesignLinkedCases = await Promise.all(linkResolution.linked.map(link => refreshEditedJiraSource(link, {
        loginMode: typeof appConfig?.loginMode === "string" ? appConfig.loginMode : undefined,
        authFlowAvailable,
        loadIssue: async (issueKey) => {
          if (!issueCache.has(issueKey)) issueCache.set(issueKey, jira.getIssue(issueKey));
          const raw = await issueCache.get(issueKey)!;
          const jiraConfig = requireJiraConfig(config);
          return {
            key: raw.key,
            summary: raw.fields.summary ?? raw.key,
            description: extractTextFromAdf(raw.fields.description),
            acceptanceCriteria: extractTextFromAdf(raw.fields[jiraConfig.acceptanceCriteriaField] as any) || null,
            labels: [], components: [], status: "", issueType: "Story",
          };
        },
      })));
    }
    const semanticDesignScenarios = testDesignLinkedCases.flatMap(link => {
      const scenario = toJiraSemanticDesignScenario(link.scenario, link.issueKey);
      return scenario ? [scenario as JiraScenarioInput] : [];
    });
    const dataOverridesWithDesign = { ...(dataOverrides ?? {}) };
    const runtimeEntriesByCase = body.runtimeEntriesByCase && typeof body.runtimeEntriesByCase === "object" && !Array.isArray(body.runtimeEntriesByCase)
      ? body.runtimeEntriesByCase as Record<string, DataContextEntry[]>
      : {};
    for (const link of testDesignLinkedCases) {
      // The launch wizard keys values by step position (jira_step_N); the scenario refreshed from edited Design
      // steps names them by field. Alias each positional value to the requirement of that step so both resolve.
      const entries = runtimeEntriesByCase[String(link.testRailCaseId)];
      const requirements = link.scenario.jiraSourceScenario?.inputRequirements ?? [];
      if (Array.isArray(entries) && requirements.length) {
        const norm = (value: unknown) => String(value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
        for (const requirement of requirements) {
          if (entries.some(entry => entry.key === requirement.key)) continue;
          const label = norm(requirement.label);
          const source = entries.find(entry => entry.key === `jira_step_${requirement.stepIndex}`)
            ?? entries.find(entry => label && (norm(entry.key) === label || norm(entry.key).startsWith(`${label}_`)))
            ?? entries.find(entry => label && `_${norm(entry.key)}_`.includes(`_${label}_`));
          if (source) entries.push({ ...source, key: requirement.key });
          console.log(`[launch-execution] value-binding case=${link.testRailCaseId} requirement=${requirement.label}@${requirement.stepIndex} source=${source ? source.key : "none"} candidates=${entries.filter(e => e.key !== requirement.key).map(e => e.key).join(",")}${source && !/contras|pass|clave|secret/i.test(`${requirement.label}${source.key}`) ? ` value=${source.value}` : ""}`);
        }
      }
      const values = Object.fromEntries((runtimeEntriesByCase[String(link.testRailCaseId)] ?? [])
        .filter(entry => typeof entry?.key === "string" && typeof entry.value === "string")
        .map(entry => [entry.key, entry.value]));
      if (Object.keys(values).length) dataOverridesWithDesign[link.designScenarioId] = {
        ...(dataOverridesWithDesign[link.designScenarioId] ?? {}), ...values,
      };
    }
    if (semanticDesignScenarios.length) {
      // These cases already exist in TestRail (they were published from Design), so their values come
      // from the launch runtime entries. A Jira-style pre-check must never block the launch for them.
      const missing = await findMissingJiraInputsForExecution(appSlug, semanticDesignScenarios, dataOverridesWithDesign);
      if (missing.length) {
        console.warn(`[launch-execution] ignoring ${missing.length} unresolved Jira input(s) for ${semanticDesignScenarios.length} TestRail-published Design case(s): ${Array.from(new Set(missing.map(input => input.label))).join(", ")}`);
        const probe = missing[0];
        const probeLink = testDesignLinkedCases.find(link => link.designScenarioId === probe.scenarioId);
        console.warn(`[launch-execution] unresolved sample scenario=${probe.scenarioId} requirementKeys=${(probeLink?.scenario.jiraSourceScenario?.inputRequirements ?? []).map(r => `${r.key}@${r.stepIndex}`).join(",")} overrideKeys=${Object.keys(dataOverridesWithDesign[probe.scenarioId] ?? {}).join(",")} entryKeys=${(runtimeEntriesByCase[String(probeLink?.testRailCaseId)] ?? []).map(e => e.key).join(",")}`);
      }
    }
    if (body.executionEngine === "jira_semantic") {
      // Preflight and execution must consume the same normalized field keys.
      const missing = await findMissingJiraInputsForExecution(appSlug, selectedScenarios as unknown as JiraScenarioInput[], dataOverrides);
      if (missing.length > 0) {
        const missingLabels = Array.from(new Set(missing.map((input) => input.label)));
        res.status(400).json({
          ok: false,
          error: "JIRA_REQUIRED_DATA_MISSING",
          message: `Completa los datos requeridos antes de ejecutar: ${missingLabels.join(", ")}.`,
          missingInputs: missing.map(({ scenarioId, scenarioTitle, label, stepIndex }) => ({ scenarioId, scenarioTitle, label, stepIndex })),
        });
        return;
      }
    }
    // Existing TestRail cases linked to Jira automations: reject unresolved required inputs before any Run exists.
    const existingJiraScenarios = await buildExistingJiraCaseScenarios(appSlug, existingTestRailCaseIds);
    if (existingJiraScenarios.length > 0) {
      const runtimeEntries = body.runtimeEntriesByCase && typeof body.runtimeEntriesByCase === "object" && !Array.isArray(body.runtimeEntriesByCase)
        ? body.runtimeEntriesByCase as Record<string, DataContextEntry[]>
        : {};
      const scopedOverrides: Record<string, Record<string, string>> = {};
      for (const scenario of existingJiraScenarios) {
        const linkedScenarioIds = selectedScenarios.filter((s) => extractCaseIdFromValue(s) === Number(scenario.scenarioId)).map((s) => s.scenarioId);
        const explicit: Record<string, string> = {};
        for (const id of [scenario.scenarioId, ...linkedScenarioIds]) {
          const scoped = dataOverrides?.[id];
          if (scoped && typeof scoped === "object") Object.assign(explicit, scoped);
        }
        for (const entry of Array.isArray(runtimeEntries[scenario.scenarioId]) ? runtimeEntries[scenario.scenarioId] : []) {
          if (typeof entry?.key === "string" && typeof entry.value === "string") explicit[entry.key] = entry.value;
        }
        scopedOverrides[scenario.scenarioId] = explicit;
      }
      const withConfirmed = await resolveExistingJiraCaseValues(appSlug, existingJiraScenarios, scopedOverrides);
      const missing = await findMissingJiraInputsForExecution(appSlug, existingJiraScenarios, withConfirmed);
      if (missing.length > 0) {
        const missingLabels = Array.from(new Set(missing.map((input) => input.label)));
        res.status(400).json({
          ok: false,
          error: "JIRA_REQUIRED_DATA_MISSING",
          message: `Completa los datos requeridos antes de ejecutar: ${missingLabels.join(", ")}.`,
          missingInputs: missing.map(({ scenarioId, scenarioTitle, label, stepIndex }) => ({ scenarioId, caseId: Number(scenarioId), scenarioTitle, label, stepIndex })),
        });
        return;
      }
    }
    const jiraKey = (typeof body.jiraKey === "string" ? body.jiraKey.trim() : "") || selectedScenarios[0]?.sourceIssueKey || "";
    const jiraTitle = body.executionEngine === "jira_semantic"
      ? await resolveJiraSummary(jiraKey, body.jiraTitle ?? body.storyTitle ?? body.huTitle)
      : body.jiraTitle ?? body.storyTitle ?? body.huTitle;
    const launchInput = {
      analystName: currentReportAnalyst(),
      appSlug: String(body.appSlug ?? ""),
      sectionSlug: body.sectionSlug as string | undefined,
      sectionName: body.sectionName as string | undefined,
      sectionId: body.sectionId as string | number | undefined,
      projectId: body.projectId ? Number(body.projectId) : undefined,
      suiteId: body.suiteId ? Number(body.suiteId) : undefined,
      testrailSectionId: body.testrailSectionId ? Number(body.testrailSectionId) : undefined,
      jiraKey: jiraKey || undefined,
      executionEngine: body.executionEngine as LaunchExecutionInput['executionEngine'],
      scenarioOrigin: body.scenarioOrigin as LaunchExecutionInput['scenarioOrigin'],
      jiraTitle: typeof jiraTitle === "string" ? jiraTitle : undefined,
      sprintName: body.sprintName as string | undefined,
      selectedScenarios,
       existingTestRailCaseIds,
       ...(Object.prototype.hasOwnProperty.call(body, "forceRediscovery")
         ? { forceRediscovery: body.forceRediscovery === true }
         : {}),
       ...(Object.prototype.hasOwnProperty.call(body, "overwrite")
         ? { overwrite: body.overwrite === true }
         : {}),
       contextOnly: body.contextOnly === true,
       ...(body.runtimeEntriesByCase && typeof body.runtimeEntriesByCase === "object" && !Array.isArray(body.runtimeEntriesByCase)
         ? { runtimeEntriesByCase: body.runtimeEntriesByCase as Record<string, DataContextEntry[]> }
         : {}),
       ...(dataOverrides ? { dataOverrides } : {}),
       adaptiveScenarios: Array.isArray(body.adaptiveScenarios) ? body.adaptiveScenarios : undefined,
       publishStrategy: body.publishStrategy === "use_existing" ? "use_existing" as const : "always_create" as const,
      ...(testDesignLinkedCases.length ? { testDesignLinkedCases } : {}),
      ...(Object.keys(dataOverridesWithDesign).length ? { dataOverrides: dataOverridesWithDesign } : {}),
    };
    const headerKey = req.get("Idempotency-Key")?.trim();
    const bodyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim()
      : typeof body.requestId === "string" ? body.requestId.trim()
        : undefined;
    let result: Awaited<ReturnType<typeof launchExecution>>;
    let replayed = false;
    try {
      const coordinated = await coordinateLaunchRequest(
        launchInput,
        headerKey || bodyKey,
        () => launchExecution(launchInput),
      );
      result = coordinated.result;
      replayed = coordinated.replayed;
    } catch (error) {
      if (error instanceof Error && error.message === "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_LAUNCH") {
        res.status(409).json({ ok: false, error: error.message, message: "La clave de idempotencia ya se usó con otro contenido. Genera una nueva clave para este lanzamiento." });
        return;
      }
      throw error;
    }
    if (replayed) res.setHeader("Idempotent-Replay", "true");

    if (!result.ok) {
      console.log(`[launch-execution] failed error=${result.error} message=${result.message}`);
      res.status(400).json(result);
      return;
    }

    res.json(result);
  } catch (err) {
    next(err);
  }
});

runsRouter.delete("/:jobId", (req, res) => {
  const internal = jobStore.getInternal(req.params.jobId);
  if (!internal) {
    res.status(404).json({ error: "Job not found" });
    return;
  }

  if (internal.status !== "running") {
    res.status(400).json({ error: `Cannot cancel a job in status: ${internal.status}` });
    return;
  }

  internal.process?.kill("SIGTERM");
  jobStore.update(req.params.jobId, {
    status: "cancelled",
    completedAt: new Date().toISOString()
  });

  res.json({ ok: true, jobId: req.params.jobId });
});

// ── TestRail result sync backfill — sync results from a completed launch to the TestRun ──
const LAUNCH_ARTIFACTS_DIR = path.resolve(__dirname, "..", "..", "..", ".artifacts", "scenario-launch-runs");
const PREVIEW_ARTIFACTS_DIR = path.resolve(__dirname, "..", "..", "..", ".artifacts", "scenario-preview-runs");
const EVIDENCE_ROOT_DIR = path.resolve(__dirname, "..", "..", "..", ".artifacts", "evidence");

type LaunchContextForRerun = {
  launchId?: string;
  testRunId?: number;
  publishedCases?: Array<{ scenarioId: string; caseId: number; title?: string }>;
};

// Rebuilds the minimal launch context for a rerun from persisted artifacts when the
// in-memory job is gone after a server restart. Scans the launch manifests for one that
// references the same source job or scenarios; returns undefined when nothing persisted.
function resolveLaunchContextForRerun(sourceJobId: string, prepared: { scenarios?: unknown[]; appSlug?: string }): LaunchContextForRerun | undefined {
  const sourceDir = path.join(PREVIEW_ARTIFACTS_DIR, sourceJobId);
  const sourceJobMetaPath = path.join(sourceDir, "job.json");
  let sourceJobMeta: Record<string, unknown> | null = null;
  try {
    if (fs.existsSync(sourceJobMetaPath)) {
      sourceJobMeta = JSON.parse(fs.readFileSync(sourceJobMetaPath, "utf-8"));
    }
  } catch {
    sourceJobMeta = null;
  }
  const sourceLaunchId = typeof sourceJobMeta?.launchId === "string" ? sourceJobMeta.launchId : undefined;
  if (sourceLaunchId) {
    const manifestPath = path.join(LAUNCH_ARTIFACTS_DIR, sourceLaunchId, "launch-manifest.json");
    try {
      if (fs.existsSync(manifestPath)) {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
        return {
          launchId: sourceLaunchId,
          testRunId: typeof manifest.testRunId === "number" ? manifest.testRunId : typeof manifest.testRunId === "string" ? Number(manifest.testRunId) : undefined,
          publishedCases: Array.isArray(manifest.publishedCases) ? manifest.publishedCases : undefined,
        };
      }
    } catch {
      // fall through to scan below
    }
  }
  // Fallback scan: find a launch manifest whose jobId/sourceJobId matches this source job.
  if (!fs.existsSync(LAUNCH_ARTIFACTS_DIR)) return undefined;
  const launchIds = fs.readdirSync(LAUNCH_ARTIFACTS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  for (const launchId of launchIds) {
    const manifestPath = path.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      const manifestJobIds = [manifest.jobId, manifest.sourceJobId, manifest.originJobId].filter((v): v is string => typeof v === "string");
      if (manifestJobIds.includes(sourceJobId)) {
        return {
          launchId,
          testRunId: typeof manifest.testRunId === "number" ? manifest.testRunId : typeof manifest.testRunId === "string" ? Number(manifest.testRunId) : undefined,
          publishedCases: Array.isArray(manifest.publishedCases) ? manifest.publishedCases : undefined,
        };
      }
    } catch {
      // ignore unreadable manifests
    }
  }
  return undefined;
}

type EvidenceDocxStatus = "ready" | "preparing" | "failed" | "unavailable";
type EvidenceDocxReasonCode =
  | "ready"
  | "job_not_found"
  | "document_preparing"
  | "cases_not_executable"
  | "evidence_initialization_failed"
  | "document_generation_failed"
  | "document_not_found_after_completion";

type EvidenceDocumentFormat = "pdf" | "docx";

const EVIDENCE_DOCUMENT_FILES: Record<EvidenceDocumentFormat, { fileName: string; contentType: string }> = {
  pdf: { fileName: "evidencia.pdf", contentType: "application/pdf" },
  docx: {
    fileName: "evidencia.docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
};

type EvidenceDocxResolution = {
  jobId: string;
  status: EvidenceDocxStatus;
  reasonCode: EvidenceDocxReasonCode;
  documentReady: boolean;
  documentPath?: string;
  documentFormat?: EvidenceDocumentFormat;
  jobExists: boolean;
  jobStatus?: string;
  appSlug?: string;
  sectionSlug?: string;
};

const TERMINAL_RUN_STATUSES = new Set([
  "done",
  "completed",
  "completed_with_failures",
  "completed_with_sync_errors",
  "failed",
  "error",
  "cancelled",
  "canceled",
  "stopped",
  "timeout",
]);

const ERROR_TERMINAL_RUN_STATUSES = new Set([
  "failed",
  "error",
  "cancelled",
  "canceled",
  "stopped",
  "timeout",
  "completed_with_failures",
  "completed_with_sync_errors",
]);

function toNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

function readPreviewJobMetadata(jobId: string): Record<string, unknown> | undefined {
  const jobMetaPath = path.join(PREVIEW_ARTIFACTS_DIR, jobId, "job.json");
  if (!fs.existsSync(jobMetaPath)) return undefined;
  try {
    const parsed = JSON.parse(fs.readFileSync(jobMetaPath, "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function findEvidenceDocxByJobId(rootDir: string, jobId: string, fileName: string): string | undefined {
  if (!fs.existsSync(rootDir)) return undefined;

  const stack = [rootDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir) continue;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (
        entry.name === fileName
        && fullPath.includes(path.sep + "runs" + path.sep + jobId + path.sep)
      ) {
        return fullPath;
      }
    }
  }
  return undefined;
}

/**
 * Locate a run's evidence document. The default is PDF; Word remains an explicit format.
 */
export function resolveEvidenceDocxForJob(
  jobId: string,
  formats: EvidenceDocumentFormat[] = ["pdf"],
): EvidenceDocxResolution {
  const job = jobStore.get(jobId);
  const params = (job?.params ?? {}) as Record<string, unknown>;
  const summary = (job?.summary ?? {}) as Record<string, unknown>;
  const diskMeta = readPreviewJobMetadata(jobId);

  const appSlug = toNonEmptyString(params.appSlug)
    ?? toNonEmptyString(params.targetAppSlug)
    ?? toNonEmptyString(diskMeta?.appSlug)
    ?? toNonEmptyString(diskMeta?.targetAppSlug);
  const sectionSlug = toNonEmptyString(params.sectionSlug) ?? toNonEmptyString(diskMeta?.sectionSlug);
  const jobStatus = toNonEmptyString(job?.status) ?? toNonEmptyString(diskMeta?.status);
  const previewJobDir = path.join(PREVIEW_ARTIFACTS_DIR, jobId);
  const jobExists = Boolean(job || fs.existsSync(previewJobDir));

  const candidateDirs: string[] = [];
  if (appSlug && sectionSlug) {
    candidateDirs.push(path.join(EVIDENCE_ROOT_DIR, appSlug, sectionSlug, "runs", jobId));
  }
  candidateDirs.push(path.join(PREVIEW_ARTIFACTS_DIR, jobId));

  for (const format of formats) {
    const { fileName } = EVIDENCE_DOCUMENT_FILES[format];
    const found = candidateDirs.map(dir => path.join(dir, fileName)).find(candidate => fs.existsSync(candidate))
      ?? findEvidenceDocxByJobId(EVIDENCE_ROOT_DIR, jobId, fileName);
    if (found) {
      return {
        jobId,
        status: "ready",
        reasonCode: "ready",
        documentReady: true,
        documentPath: found,
        documentFormat: format,
        jobExists: true,
        jobStatus,
        appSlug,
        sectionSlug,
      };
    }
  }

  if (!jobExists) {
    return {
      jobId,
      status: "unavailable",
      reasonCode: "job_not_found",
      documentReady: false,
      jobExists: false,
      jobStatus,
      appSlug,
      sectionSlug,
    };
  }

  const summaryReasonCode = toNonEmptyString(summary.reasonCode) as EvidenceDocxReasonCode | undefined;
  if (summaryReasonCode === "cases_not_executable") {
    return {
      jobId,
      status: "unavailable",
      reasonCode: "cases_not_executable",
      documentReady: false,
      jobExists: true,
      jobStatus,
      appSlug,
      sectionSlug,
    };
  }

  if (summaryReasonCode === "document_generation_failed") {
    return {
      jobId,
      status: "unavailable",
      reasonCode: "document_generation_failed",
      documentReady: false,
      jobExists: true,
      jobStatus,
      appSlug,
      sectionSlug,
    };
  }

  if (summaryReasonCode === "evidence_initialization_failed") {
    return {
      jobId,
      status: "unavailable",
      reasonCode: "evidence_initialization_failed",
      documentReady: false,
      jobExists: true,
      jobStatus,
      appSlug,
      sectionSlug,
    };
  }

  const normalizedStatus = (jobStatus ?? "").trim().toLowerCase();
  const terminal = TERMINAL_RUN_STATUSES.has(normalizedStatus);
  if (!terminal) {
    return {
      jobId,
      status: "preparing",
      reasonCode: "document_preparing",
      documentReady: false,
      jobExists: true,
      jobStatus,
      appSlug,
      sectionSlug,
    };
  }

  const documentAttempted = toBoolean(summary.documentAttempted) === true;
  const documentGenerated = toBoolean(summary.documentGenerated) === true;
  const documentPathPresent = toBoolean(summary.documentPathPresent) === true;
  if (documentAttempted && !documentGenerated) {
    return {
      jobId,
      status: "unavailable",
      reasonCode: "document_generation_failed",
      documentReady: false,
      jobExists: true,
      jobStatus,
      appSlug,
      sectionSlug,
    };
  }

  if (documentGenerated && !documentPathPresent) {
    return {
      jobId,
      status: "unavailable",
      reasonCode: "document_not_found_after_completion",
      documentReady: false,
      jobExists: true,
      jobStatus,
      appSlug,
      sectionSlug,
    };
  }

  return {
    jobId,
    status: ERROR_TERMINAL_RUN_STATUSES.has(normalizedStatus) ? "failed" : "unavailable",
    reasonCode: ERROR_TERMINAL_RUN_STATUSES.has(normalizedStatus)
      ? "document_generation_failed"
      : "document_not_found_after_completion",
    documentReady: false,
    jobExists: true,
    jobStatus,
    appSlug,
    sectionSlug,
  };
}

runsRouter.post("/:jobId/sync-results", async (req, res) => {
  const jobId = req.params.jobId;
  console.log(`[sync-results] requested jobId=${jobId}`);

  // Try to find launch metadata from the job store
  const job = jobStore.get(jobId);
  let launchId: string | undefined;
  let testRunId: number | undefined;
  let publishedCases: Array<{ scenarioId: string; caseId: number; title?: string }> | undefined;

  if (job) {
    const p = (job as any).payload as Record<string, unknown> | undefined;
    launchId = (p?.launchId as string) || undefined;
    testRunId = p?.testRunId ? Number(p.testRunId) : undefined;
    publishedCases = Array.isArray(p?.publishedCases) ? p.publishedCases as any[] : undefined;
  }

  if (!testRunId) {
    res.status(400).json({ ok: false, error: "No TestRun ID found in job metadata. Provide launchId in body." });
    return;
  }

  const { TestRailClient } = await import("../../clients/testrail.client");
  const { requireTestRailConfig } = await import("../../config/env");
  const config = requireTestRailConfig(await (await import("../../config/env")).config as any);

  if (!config) {
    res.status(500).json({ ok: false, error: "TestRail not configured" });
    return;
  }

  const trClient = new TestRailClient(config);

  // Read results from job artifact dir
  const jobArtifacts = path.join(PREVIEW_ARTIFACTS_DIR, jobId);
  const resultsPath = path.join(jobArtifacts, "results.json");
  const manifestPath = launchId ? path.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json") : undefined;

  console.log(`[sync-results] artifacts path=${jobArtifacts} resultsPath=${resultsPath} manifestPath=${manifestPath}`);

  if (!fs.existsSync(resultsPath)) {
    res.status(400).json({ ok: false, error: `No results.json found at ${resultsPath}` });
    return;
  }

  let resultsData: any;
  try {
    resultsData = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
  } catch {
    res.status(400).json({ ok: false, error: "Failed to parse results.json" });
    return;
  }

  const rawResults: any[] = resultsData.results ?? resultsData.cases ?? [];

  if (rawResults.length === 0) {
    res.status(400).json({ ok: false, error: "No results found in results.json" });
    return;
  }

  // Build results map and scenario-to-case mapping
  const scenarioToCaseMap = new Map<string, number>();
  if (publishedCases) {
    for (const pc of publishedCases) {
      scenarioToCaseMap.set(pc.scenarioId, pc.caseId);
    }
  }

  // Also try to read manifest for publishedCases if not available from job
  if (manifestPath && fs.existsSync(manifestPath) && publishedCases && publishedCases.length === 0) {
    try {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      launchId = manifest.launchId ?? launchId;
      testRunId = manifest.testRunId ?? testRunId;
      if (Array.isArray(manifest.publishedCases)) {
        for (const pc of manifest.publishedCases) {
          scenarioToCaseMap.set(pc.scenarioId, pc.caseId);
        }
      }
    } catch { /* ignore */ }
  }

  // Read manifest for existing results if present
  let manifest: any = { results: [] };
  if (manifestPath && fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch { /* ignore */ }
  }

  const { syncDiscoveryResultToTestRail, updateLaunchManifestWithResult } = await import("../jobs/testrail-result-sync");
  const syncResults: Array<{ scenarioId: string; status: string; syncStatus: string; caseId: number }> = [];
  const errors: string[] = [];

  const runIdValue = testRunId;
  if (!runIdValue) {
    const availableIds = Array.from(scenarioToCaseMap.keys()).join(",");
    res.status(400).json({ ok: false, error: "No TestRun ID available", scenarioIds: availableIds });
    return;
  }

  for (const r of rawResults) {
    const scenarioId: string = r.scenarioId ?? r.caseId ?? r.title ?? "unknown";
    const caseId = scenarioToCaseMap.get(scenarioId) || 0;

    if (!caseId) {
      const availableIds = Array.from(scenarioToCaseMap.keys()).join(",");
      console.log(`[sync-results] skipped scenarioId=${scenarioId} reason="no_matching_case_id" availableScenarioIds=${availableIds}`);
      syncResults.push({ scenarioId, status: r.status, syncStatus: "skipped_no_case_id", caseId: 0 });
      continue;
    }

    try {
      const syncResult = await syncDiscoveryResultToTestRail({
        runId: runIdValue,
        caseId,
        scenarioId,
        discoveryStatus: r.status === "passed" ? "passed" : r.status === "failed" ? "failed" : r.status === "skipped" ? "skipped" : "review_needed",
        title: r.title,
        errorMessage: r.failureReason,
        durationMs: r.durationMs,
        launchId,
      });

      if (manifestPath && launchId) {
        updateLaunchManifestWithResult(launchId, {
          scenarioId,
          caseId,
          discoveryStatus: r.status,
          testRailStatusId: syncResult.statusId,
          syncStatus: syncResult.syncStatus,
          syncedAt: syncResult.syncedAt,
          error: syncResult.error,
        }, publishedCases?.length ?? rawResults.length);
      }

      console.log(`[sync-results] synced scenarioId=${scenarioId} caseId=${caseId} status=${r.status} syncStatus=${syncResult.syncStatus}`);
      syncResults.push({ scenarioId, status: r.status, syncStatus: syncResult.syncStatus, caseId });
    } catch (err: any) {
      const errMsg = err.message ?? String(err);
      console.error(`[sync-results] failed scenarioId=${scenarioId} caseId=${caseId}: ${errMsg}`);
      errors.push(`scenarioId=${scenarioId}: ${errMsg}`);
    }
  }

  res.json({
    ok: errors.length === 0,
    synced: syncResults.filter(sr => sr.syncStatus === "synced").length,
    skipped: syncResults.filter(sr => sr.syncStatus === "skipped_no_case_id").length,
    failed: errors.length,
    total: rawResults.length,
    results: syncResults,
    errors: errors.length > 0 ? errors : undefined,
  });
});

// ── Jira link backfill — link an existing TestRun to a Jira issue without rerunning ──
runsRouter.post("/:jobId/link-jira", async (req, res) => {
  const jobId = req.params.jobId;
  const b = req.body as Record<string, unknown>;
  console.log(`[link-jira] requested jobId=${jobId}`);

  const { linkTestRunToJiraIssue } = await import("../jobs/jira-traceability");
  const { updateLaunchManifestJiraLink } = await import("../jobs/testrail-result-sync");

  const job = jobStore.get(jobId);
  let launchId: string | undefined = b.launchId as string | undefined;
  let testRunId: number | undefined = b.testRunId ? Number(b.testRunId) : undefined;
  let jiraKey: string | undefined = b.jiraKey as string | undefined;

  if (job) {
    const p = (job as any).payload as Record<string, unknown> | undefined;
    launchId = launchId || (p?.launchId as string);
    testRunId = testRunId || (p?.testRunId ? Number(p.testRunId) : undefined);
    jiraKey = jiraKey || (p?.jiraKey as string);
  }

  if (!launchId) {
    res.status(400).json({ ok: false, error: "No launchId found. Provide launchId in body." });
    return;
  }
  if (!jiraKey) {
    res.status(400).json({ ok: false, error: "No jiraKey found. Provide jiraKey in body." });
    return;
  }
  if (!testRunId) {
    res.status(400).json({ ok: false, error: "No testRunId found. Provide testRunId in body." });
    return;
  }

  try {
    const jiraResult = await linkTestRunToJiraIssue({
      jiraKey,
      testRunId,
      launchId,
      appSlug: b.appSlug as string | undefined,
      sectionSlug: b.sectionSlug as string | undefined,
      finalStatus: b.finalStatus as string | undefined,
    });
    updateLaunchManifestJiraLink(launchId, jiraResult);
    res.json({ ok: jiraResult.linkStatus === "linked", ...jiraResult });
  } catch (err: any) {
    const errMsg = err.message ?? String(err);
    res.status(500).json({ ok: false, error: errMsg, jiraKey, launchId, testRunId });
  }
});

// ── Link Jira Run Ref backfill — set refs on an existing TestRun to enable TestRail Runs panel ──
runsRouter.post("/:jobId/link-jira-run-ref", async (req, res) => {
  const jobId = req.params.jobId;
  const b = req.body as Record<string, unknown>;
  console.log(`[link-jira-run-ref] requested jobId=${jobId}`);

  const { config, requireTestRailConfig } = await import("../../config/env");
  const { TestRailClient } = await import("../../clients/testrail.client");

  let testRunId: number | undefined = b.testRunId ? Number(b.testRunId) : undefined;
  let jiraKey: string | undefined = b.jiraKey as string | undefined;

  // Try job payload for fallback
  const job = jobStore.get(jobId);
  if (job) {
    const p = (job as any).payload as Record<string, unknown> | undefined;
    testRunId = testRunId || (p?.testRunId ? Number(p.testRunId) : undefined);
    jiraKey = jiraKey || (p?.jiraKey as string);
  }

  if (!testRunId) {
    res.status(400).json({ ok: false, error: "No testRunId provided and not found in job. Provide testRunId in body." });
    return;
  }
  if (!jiraKey) {
    res.status(400).json({ ok: false, error: "No jiraKey provided and not found in job. Provide jiraKey in body." });
    return;
  }

  try {
    const trConfig = requireTestRailConfig(config);
    const trClient = new TestRailClient(trConfig);
    const result = await trClient.updateRun(testRunId, { refs: jiraKey });

    console.log(`[link-jira-run-ref] updated runId=${testRunId} refs=${jiraKey} resultId=${result.id}`);

    // Try to update manifest
    const launchId = b.launchId as string | undefined;
    if (launchId) {
      const { updateLaunchManifestJiraLink } = await import("../jobs/testrail-result-sync");
      updateLaunchManifestJiraLink(launchId, {
        jiraKey,
        linkStatus: "linked",
        linkedAt: new Date().toISOString(),
      });
    }

    res.json({ ok: true, testRunId, jiraKey });
  } catch (err: any) {
    const errMsg = err.message ?? String(err);
    console.error(`[link-jira-run-ref] failed testRunId=${testRunId} jiraKey=${jiraKey} error="${errMsg}"`);
    res.status(500).json({ ok: false, error: errMsg, testRunId, jiraKey });
  }
});

// ── Evidence DOCX status ──
runsRouter.get("/:jobId/evidence-docx/status", (req, res) => {
  const jobId = req.params.jobId;
  const resolution = resolveEvidenceDocxForJob(jobId);

  if (!resolution.jobExists && resolution.reasonCode === "job_not_found") {
    res.status(404).json({
      jobId,
      status: "not_found",
      documentReady: false,
      reasonCode: "job_not_found",
    });
    return;
  }

  const statusCode = resolution.status === "preparing" ? 202 : 200;
  res.status(statusCode).json({
    jobId,
    status: resolution.status,
    documentReady: resolution.documentReady,
    reasonCode: resolution.reasonCode,
    jobStatus: resolution.jobStatus,
    appSlug: resolution.appSlug,
    sectionSlug: resolution.sectionSlug,
  });
});

// ── Download evidence document ──
// Serves PDF by default; `?format=docx` explicitly requests Word.
// The route keeps its historical name: the panel and the BFF already call it and take the file
// name and type from the response headers.
runsRouter.get("/:jobId/evidence-docx", (req, res) => {
  const jobId = req.params.jobId;
  const requested = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "";
  if (requested && requested !== "pdf") {
    res.status(400).json({ error: "Invalid format", jobId, message: "El documento se entrega en PDF. Usa format=pdf." });
    return;
  }
  const resolution = resolveEvidenceDocxForJob(
    jobId,
    requested ? [requested as EvidenceDocumentFormat] : undefined,
  );
  const docxPath = resolution.documentPath;

  if (!docxPath) {
    if (!resolution.jobExists && resolution.reasonCode === "job_not_found") {
      res.status(404).json({
        error: "Job not found",
        jobId,
        reasonCode: "job_not_found",
        message: "No existe un job con ese ID.",
      });
      return;
    }
    if (resolution.status === "preparing") {
      res.status(409).json({
        error: "Evidence DOCX is still being prepared",
        jobId,
        reasonCode: "document_preparing",
        message: "La ejecución aún está consolidando el documento de evidencia.",
      });
      return;
    }
    console.error(`[evidence-docx] file not found jobId=${jobId} reason=${resolution.reasonCode}`);
    res.status(404).json({
      error: "Evidence DOCX not found",
      jobId,
      reasonCode: resolution.reasonCode,
      message: "El documento de evidencia no está disponible para este job.",
    });
    return;
  }

  const format = resolution.documentFormat ?? "docx";
  const job = jobStore.get(jobId) ?? jobStore.getPersisted(jobId);
  const params = (job?.params ?? {}) as Record<string, unknown>;
  const scenarioOrigin = params.scenarioOrigin && typeof params.scenarioOrigin === "object"
    ? params.scenarioOrigin as Record<string, unknown>
    : {};
  const jiraKey = toNonEmptyString(params.jiraKey)
    ?? toNonEmptyString(params.huKey)
    ?? toNonEmptyString(scenarioOrigin.jiraKey)
    ?? toNonEmptyString(job?.issueKey);
  const jiraTitle = toNonEmptyString(params.jiraTitle) ?? toNonEmptyString(params.huTitle);
  const caseTitle = toNonEmptyString(params.scenarioTitle)
    ?? toNonEmptyString(params.title)
    ?? toNonEmptyString(job?.currentCaseTitle);
  const documentTitle = jiraTitle ?? caseTitle;
  const descriptiveName = [jiraKey, documentTitle && documentTitle !== jiraKey ? documentTitle : undefined]
    .filter((part): part is string => Boolean(part))
    .join(" ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9 _.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .slice(0, 140);
  const filename = `${descriptiveName || `evidencia-${jobId}`}.${format}`;
  res.setHeader("Content-Type", EVIDENCE_DOCUMENT_FILES[format].contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  const stream = fs.createReadStream(docxPath);
  stream.on("error", (err) => {
    console.error(`[evidence-docx] stream error jobId=${jobId}:`, err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream evidence file" });
    }
  });

  stream.pipe(res);
});
