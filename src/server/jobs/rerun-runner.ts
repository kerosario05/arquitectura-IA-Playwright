import fs from "fs";
import path from "path";
import type { McpScenario } from "../../scenarios/scenario-types";
import { deriveScenarioRequiredData } from "../../scenarios/mobile-scenario-generator";
import type { VirtualCase } from "../../types/scenario-preview.types";
import type { MobileLaunchExecutionParams } from "./mobile-launch-execution-runner";
import { loadMobileRouteProfile } from "../../mobile/mobile-route-profile";
import {
  readMobileExecutionManifest,
  readMobileExecutionResults,
} from "./mobile-rerun-artifacts";
import { loadScenarios } from "../../recording/recording-store";
import { resolveSpecForScenario } from "../../automations/recording-automation-resolution";
import type { RecordedScenario } from "../../recording/trace-to-scenario";
import { toSharedMcpScenario, reconcileRecordingExecutionContractLineage } from "../../recording/canonical-recording-contract";

const ROOT = path.resolve(__dirname, "..", "..", "..");
const ARTIFACTS_DIR = path.join(ROOT, ".artifacts", "scenario-preview-runs");

export type CaseOutcome = { id: string; status: string; failureReason?: string };

/**
 * Per-scenario promoted-spec reuse authority for a rerun, resolved from the recording's own
 * persisted scenario store (recording-store.ts's loadScenarios) via the STABLE, canonical
 * lineage the original preview-scenarios.json snapshot already carries
 * (VirtualCase.recordingId + VirtualCase.recordedScenarioId) — never by matching on title or
 * array index, which are neither stable nor unique.
 */
export type PromotedSpecReuseEntry = {
  scenarioId: string;
  canonicalScenarioId?: string;
  specPath?: string;
  specState: "fresh" | "stale" | "missing";
  reuse: boolean;
  caseId?: number;
  title?: string;
  /**
   * This scenario's OWN current runtime data ("Datos de este escenario" -- the same
   * `RecordedScenario.runtimeDataset.resolvedValues` PUT /recordings/:recordingId/scenario-value
   * already edits/persists via `applyRuntimeDatasetValues`/`saveScenarios`). Carried through
   * verbatim so a reuse rerun's PROMOTED_<KEY> materialization uses THIS scenario's current
   * values, never the app's global/default testData alone.
   */
  runtimeValues?: Record<string, string>;
};

export type RerunPrepareResult = {
  ok: true;
  jobType: "scenario-preview";
  scenarios: McpScenario[];
  selectedCount: number;
  totalCount: number;
  sourceJobId: string;
  rerunMode: "failed_only" | "all";
  appSlug: string;
  recordingId?: string;
  targetAppSlug?: string;
  targetAppName?: string;
  sectionName?: string;
  sectionSlug?: string;
  /** One entry per selected scenario; see PromotedSpecReuseEntry. */
  promotedSpecReuse: PromotedSpecReuseEntry[];
  /** True only when EVERY selected scenario has a fresh, reusable promoted spec. */
  allReusable: boolean;
  options?: {
    overwrite?: boolean;
    autoPromote?: boolean;
    autoPom?: boolean;
    rerunActive?: boolean;
    headed?: boolean;
  };
} | {
  ok: true;
  jobType: "mobile-launch-execution";
  mobileParams: MobileLaunchExecutionParams;
  selectedCount: number;
  totalCount: number;
  sourceJobId: string;
  rerunMode: "failed_only" | "all";
  appSlug: string;
} | {
  ok: false;
  error: string;
  message: string;
};

type JobMetadata = {
  appSlug?: string;
  targetAppSlug?: string;
  targetAppName?: string;
  sectionName?: string;
  sectionSlug?: string;
  createdAt?: string;
  completedAt?: string;
  status?: string;
  options?: {
    overwrite?: boolean;
    autoPromote?: boolean;
    autoPom?: boolean;
    rerunActive?: boolean;
    headed?: boolean;
  };
  sourceJobId?: string;
  rerunMode?: string;
};

async function prepareRerunFromReuseExistingJob(
  sourceJobId: string,
  mode: "failed_only" | "all",
  record: JobRecordLike | undefined,
): Promise<RerunPrepareResult | undefined> {
  const params = record?.params;
  if (params?.executionMode !== "reuse_existing_promoted_spec" || typeof params.recordingId !== "string" || typeof params.appSlug !== "string" || !Array.isArray(params.scenarios)) return undefined;
  const stored = params.scenarios.filter((value): value is { scenarioId: string; caseId?: number; specPath: string; title?: string; runtimeValues?: Record<string, string> } =>
    Boolean(value && typeof value === "object" && typeof (value as { scenarioId?: unknown }).scenarioId === "string" && typeof (value as { specPath?: unknown }).specPath === "string"),
  );
  if (stored.length === 0) return { ok: false, error: "rerun_lineage_broken", message: `Reuse job ${sourceJobId} has no canonical selected scenarios.` };
  const appSlug = params.appSlug;
  const recordingId = params.recordingId;
  const recorded = loadScenarios(appSlug, recordingId);
  const promotedSpecReuse: PromotedSpecReuseEntry[] = [];
  const scenarios: McpScenario[] = [];
  for (const scenario of stored) {
    const canonical = recorded.find((candidate) => candidate.scenarioId === scenario.scenarioId);
    if (!canonical) {
      // No canonical authority exists for this scenarioId at all -- neither reuse NOR the
      // normal CORE route (toSharedMcpScenario) can be built without one. Fail closed rather
      // than guess.
      return { ok: false, error: "rerun_lineage_broken", message: `Reuse job ${sourceJobId} has no canonical scenario authority for scenario ${scenario.scenarioId}.` };
    }
    const resolved = await resolveSpecForScenario(canonical);
    const isReusable = resolved.status === "fresh" && resolved.path === scenario.specPath;
    // "Datos de este escenario" CURRENT authority -- never the stale value the job's own stored
    // params carried at creation time (see PromotedSpecReuseEntry.runtimeValues doc comment).
    const currentRuntimeValues = canonical.runtimeDataset?.resolvedValues;
    if (isReusable) {
      promotedSpecReuse.push({
        scenarioId: scenario.scenarioId,
        canonicalScenarioId: scenario.scenarioId,
        caseId: scenario.caseId,
        specPath: scenario.specPath,
        title: canonical.title,
        runtimeValues: currentRuntimeValues,
        specState: "fresh",
        reuse: true,
      });
    } else {
      // Not reusable (missing/stale/mismatched hash) -- per-scenario fallback to the normal
      // CORE route, using the EXACT SAME conversion `recordings.ts`'s own `/execute` route
      // already uses to feed `startScenarioPreviewRun` for a non-reuse scenario
      // (`toSharedMcpScenario`, canonical-recording-contract.ts) -- never a fabricated/
      // synthetic McpScenario, this scenario's own persisted canonical structure materialized
      // with its CURRENT runtime dataset values.
      scenarios.push(toSharedMcpScenario(canonical, appSlug, currentRuntimeValues ?? {}));
      promotedSpecReuse.push({
        scenarioId: scenario.scenarioId,
        canonicalScenarioId: scenario.scenarioId,
        caseId: scenario.caseId,
        specPath: resolved.status !== "missing" ? resolved.path : undefined,
        title: canonical.title,
        runtimeValues: currentRuntimeValues,
        specState: resolved.status,
        reuse: false,
      });
    }
  }
  const allReusable = promotedSpecReuse.length > 0 && promotedSpecReuse.every((entry) => entry.reuse);
  return {
    ok: true,
    jobType: "scenario-preview",
    scenarios,
    selectedCount: promotedSpecReuse.length,
    totalCount: promotedSpecReuse.length,
    sourceJobId,
    rerunMode: mode,
    appSlug,
    recordingId,
    promotedSpecReuse,
    allReusable,
  };
}

/**
 * FIRST_LOSS fix (jobId 662dad69-f0e5-480b-ba94-c23301713d72): `virtualCaseToScenario` reuses the
 * source job's OWN previously-materialized `canonicalInteractions`/`recordingExecutionContract`
 * verbatim (see the comment below -- that reuse is deliberate and stays unchanged). But
 * "preserve the source job's structured authority" and "trust its semantic lineage was computed
 * with today's rules" are different claims -- a scenario materialized before a canonicalization
 * fix landed carries the OLD lineage forever otherwise, since a rerun never re-derives from raw
 * events. `reconcileOptionOwnerLineage` (canonical-recording-contract.ts) is a pure, currently-
 * available-evidence-only correction -- it needs nothing beyond the interactions the VirtualCase
 * already has, so re-applying it here costs nothing extra and never regenerates Discovery, never
 * touches technicalTargetRefs/recordedValue/scenario identity. `recordingExecutionContract.actions`
 * is a SEPARATE, already-materialized projection of the same interactions (joined by the stable
 * `interactionId`/`CanonicalInteraction.id` identity, never index/position) and is reconciled the
 * same way so both representations agree.
 */
type LineageInteraction = { id?: string; action: string; semanticField?: string; recordedValue?: string; screenBeforeRef?: string } & Record<string, unknown>;

function reconcileVirtualCaseLineage(vc: VirtualCase): Pick<VirtualCase, "canonicalInteractions" | "recordingExecutionContract"> {
  const { canonicalInteractions, actions } = reconcileRecordingExecutionContractLineage(
    vc.canonicalInteractions as LineageInteraction[] | undefined,
    vc.recordingExecutionContract?.actions,
  );
  return {
    canonicalInteractions: canonicalInteractions as VirtualCase["canonicalInteractions"],
    recordingExecutionContract: vc.recordingExecutionContract && actions
      ? { ...vc.recordingExecutionContract, actions: actions as typeof vc.recordingExecutionContract.actions }
      : vc.recordingExecutionContract,
  };
}

function virtualCaseToScenario(vc: VirtualCase): McpScenario {
  const { canonicalInteractions, recordingExecutionContract } = reconcileVirtualCaseLineage(vc);
  return {
    sourceIssueKey: vc.sourceIssueKey,
    title: vc.title,
    steps: vc.steps,
    preconditions: vc.preconditions ?? [],
    expectedResult: vc.expectedResult,
    type: vc.type ?? "Functional",
    database: "QA",
    isConverted: 0,
    automationType: vc.automationType ?? "ui_with_auth_gate",
    setupStrategy: vc.setupStrategy ?? "auth_gate",
    appSlug: vc.appSlug,
    targetAppSlug: vc.targetAppSlug,
    targetAppName: vc.targetAppName,
    routeProfile: vc.routeProfile ?? "",
    dataRequirements: vc.dataRequirements ?? "",
    nonExecutableCriteria: "",
    mcpExecutable: vc.mcpExecutable !== false,
    // FIRST_LOSS fix: a rerun of a Recording Web-originated job is never a new semantic
    // derivation -- it must reuse the EXACT SAME structured authority the source job already
    // had, never re-derive actions from `steps`' human-readable text. `toVirtualCase`
    // (scenario-preview.types.ts) already copies every one of these fields from the original
    // McpScenario onto the persisted VirtualCase (`preview-scenarios.json`, confirmed intact for
    // a real recording rerun: `recordingExecutionContract.actions.length === 7`) -- this mapping
    // was simply never the inverse of that one, so a rerun silently discarded all of it and fell
    // through to `parseScenarioStepsForDiscovery`'s legacy text-parsing branch instead.
    recordingId: vc.recordingId,
    recordedScenarioId: vc.recordedScenarioId,
    canonicalInteractions,
    entityActionBlocks: vc.entityActionBlocks,
    runtimeInputRequirements: vc.runtimeInputRequirements,
    technicalKnowledgeRefs: vc.technicalKnowledgeRefs,
    executionReadinessAudit: vc.executionReadinessAudit,
    recordingExecutionContract,
    stateSequenceValid: vc.stateSequenceValid,
    stateSequenceIssues: vc.stateSequenceIssues,
  };
}

/**
 * Resolves promoted-spec reuse authority per scenario using ONLY the stable, canonical lineage
 * already captured in the original preview-scenarios.json snapshot (recordingId +
 * recordedScenarioId) — title and array position are never used to link a rerun scenario back
 * to its recording. A scenario missing either identity field, or whose canonical scenarioId has
 * no match in the recording's own persisted scenario store, is conservatively "missing" (falls
 * back to the existing scenario-preview pipeline) rather than guessed.
 */
async function resolvePromotedSpecReuse(cases: VirtualCase[]): Promise<PromotedSpecReuseEntry[]> {
  const recordingScenarioCache = new Map<string, RecordedScenario[]>();
  const entries: PromotedSpecReuseEntry[] = [];
  for (const vc of cases) {
    const scenarioId = vc.recordedScenarioId ?? vc.displayId ?? vc.id;
    if (!vc.recordingId || !vc.recordedScenarioId || !vc.appSlug) {
      entries.push({ scenarioId, specState: "missing", reuse: false, title: vc.title });
      continue;
    }
    const cacheKey = `${vc.appSlug}::${vc.recordingId}`;
    let recorded = recordingScenarioCache.get(cacheKey);
    if (!recorded) {
      recorded = loadScenarios(vc.appSlug, vc.recordingId);
      recordingScenarioCache.set(cacheKey, recorded);
    }
    // Canonical scenario identity match ONLY — never title/index.
    const match = recorded.find((s) => s.scenarioId === vc.recordedScenarioId);
    if (!match) {
      entries.push({ scenarioId, canonicalScenarioId: vc.recordedScenarioId, specState: "missing", reuse: false, title: vc.title });
      continue;
    }
    const spec = await resolveSpecForScenario(match);
    entries.push({
      scenarioId,
      canonicalScenarioId: vc.recordedScenarioId,
      specPath: spec.path,
      specState: spec.status,
      reuse: spec.status === "fresh" && Boolean(spec.path),
      caseId: match.testRailCaseId,
      title: vc.title,
      runtimeValues: match.runtimeDataset?.resolvedValues,
    });
  }
  return entries;
}

function loadJobMetadata(sourceDir: string): JobMetadata {
  const metaPath = path.join(sourceDir, "job.json");
  if (fs.existsSync(metaPath)) {
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as JobMetadata;
    } catch {
      // ignore parse errors
    }
  }
  return {};
}

function enrichMobileScenariosForRerun(params: MobileLaunchExecutionParams): MobileLaunchExecutionParams {
  const routeProfile = params.appSlug ? loadMobileRouteProfile(params.appSlug) : null;
  const scenarios = params.scenarios.map((scenario) => {
    const derived = deriveScenarioRequiredData(scenario.steps, routeProfile);
    const mergedByKey = new Map<string, (typeof derived)[number]>();
    for (const field of scenario.requiredData ?? []) {
      mergedByKey.set(`${field.kind}:${field.stepIndex}:${field.key}`, field);
    }
    for (const field of derived) {
      const key = `${field.kind}:${field.stepIndex}:${field.key}`;
      if (!mergedByKey.has(key)) {
        mergedByKey.set(key, field);
      }
    }
    return {
      ...scenario,
      requiredData: Array.from(mergedByKey.values()),
    };
  });
  return {
    ...params,
    scenarios,
  };
}

/** Minimal shape `prepareRerun`/lineage resolution needs from an in-memory job record. */
export type JobRecordLike = { type?: string; params?: Record<string, unknown> };

const MAX_RERUN_LINEAGE_DEPTH = 8;

async function defaultGetJobRecord(jobId: string): Promise<JobRecordLike | undefined> {
  const { jobStore } = await import("./job-store");
  return jobStore.get(jobId);
}

/**
 * Walks a rerun's own lineage (each reuse-existing job records `params.sourceJobId`, its
 * single-hop parent — see runs.ts's `jobStore.create("scenario-preview", { sourceJobId: jobId,
 * executionMode: "reuse_existing_promoted_spec", ... })`) back to the nearest ancestor that
 * actually persisted `preview-scenarios.json` -- a reuse-existing job never writes that artifact
 * by design (it runs an already-promoted spec directly, no discovery/generation). Fails closed
 * (never silently invents or reuses an unrelated project) on a cycle or on a chain that runs out
 * of parent pointers before finding a real root, both within a bounded depth.
 */
export async function resolveRerunLineageRoot(
  jobId: string,
  getJobRecord: (id: string) => Promise<JobRecordLike | undefined> = defaultGetJobRecord,
  visited: Set<string> = new Set(),
): Promise<{ ok: true; rootJobId: string } | { ok: false; error: "rerun_lineage_broken" | "rerun_lineage_cycle"; message: string }> {
  if (fs.existsSync(path.join(ARTIFACTS_DIR, jobId, "preview-scenarios.json"))) {
    return { ok: true, rootJobId: jobId };
  }
  if (visited.has(jobId)) {
    return { ok: false, error: "rerun_lineage_cycle", message: `Rerun lineage for job ${jobId} is cyclic (job ${jobId} already visited in this chain).` };
  }
  visited.add(jobId);
  if (visited.size > MAX_RERUN_LINEAGE_DEPTH) {
    return { ok: false, error: "rerun_lineage_broken", message: `Rerun lineage for job ${jobId} exceeds max depth (${MAX_RERUN_LINEAGE_DEPTH}) without finding a scenario-preview source.` };
  }
  const record = await getJobRecord(jobId);
  const parentSourceJobId = typeof record?.params?.sourceJobId === "string" && record.params.sourceJobId.trim()
    ? record.params.sourceJobId
    : undefined;
  if (!parentSourceJobId) {
    return { ok: false, error: "rerun_lineage_broken", message: `Job ${jobId} has no preview-scenarios.json and no parent sourceJobId to resolve rerun lineage from.` };
  }
  return resolveRerunLineageRoot(parentSourceJobId, getJobRecord, visited);
}

/** Extracts the current job's OWN scenario selection (e.g. a reuse-existing job's already-
 * resolved reuse list), so a rerun of it re-runs exactly that selection -- never the lineage
 * root's full/differently-filtered scenario set. */
function extractCurrentScenarioSelection(currentJob: JobRecordLike | undefined): Set<string> | undefined {
  const scenarios = currentJob?.params?.scenarios;
  if (!Array.isArray(scenarios) || scenarios.length === 0) return undefined;
  const ids = scenarios
    .map((s) => (s && typeof s === "object" ? (s as { scenarioId?: unknown }).scenarioId : undefined))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return ids.length > 0 ? new Set(ids) : undefined;
}

export async function prepareRerun(
  sourceJobId: string,
  mode: "failed_only" | "all",
  sourceJobTypeHint?: string,
  getJobRecord: (id: string) => Promise<JobRecordLike | undefined> = defaultGetJobRecord,
): Promise<RerunPrepareResult> {
  const sourceDir = path.join(ARTIFACTS_DIR, sourceJobId);
  const previewPath = path.join(sourceDir, "preview-scenarios.json");

  if (!fs.existsSync(previewPath) && sourceJobTypeHint !== "mobile-launch-execution") {
    const currentJob = await getJobRecord(sourceJobId);
    const directReuse = await prepareRerunFromReuseExistingJob(sourceJobId, mode, currentJob);
    if (directReuse) return directReuse;
    // The immediate sourceJobId itself has no preview-scenarios.json (e.g. it's a
    // reuse-existing job, which by design never writes one). Resolve its lineage back to the
    // nearest scenario-preview root before falling through to the mobile/failure paths below.
    const lineage = await resolveRerunLineageRoot(sourceJobId, getJobRecord);
    if (!lineage.ok) {
      return { ok: false, error: lineage.error, message: lineage.message };
    }
    if (lineage.rootJobId !== sourceJobId) {
      const currentSelection = extractCurrentScenarioSelection(currentJob);
      return prepareRerunFromScenarioPreviewRoot(lineage.rootJobId, mode, sourceJobId, currentSelection);
    }
  }

  if (!fs.existsSync(previewPath)) {
    const mobileManifest = readMobileExecutionManifest(sourceJobId);
    if (!mobileManifest) {
      if (sourceJobTypeHint === "mobile-launch-execution") {
        return {
          ok: false,
          error: "missing_mobile_rerun_manifest",
          message: `Source mobile job ${sourceJobId} has no mobile execution manifest for rerun.`,
        };
      }
      return {
        ok: false,
        error: "missing_preview_scenarios",
        message: `Source job ${sourceJobId} has no preview-scenarios.json at ${previewPath}`,
      };
    }

    const enrichedMobileParams = enrichMobileScenariosForRerun(mobileManifest.params);
    const allScenarios = enrichedMobileParams.scenarios;
    if (!Array.isArray(allScenarios) || allScenarios.length === 0) {
      return {
        ok: false,
        error: "empty_mobile_scenarios",
        message: `Mobile rerun manifest for source job ${sourceJobId} contains no scenarios.`,
      };
    }

    let selectedScenarios = allScenarios;
    if (mode === "failed_only") {
      const scenarioResults = readMobileExecutionResults(sourceJobId);
      if (!scenarioResults) {
        return {
          ok: false,
          error: "missing_mobile_results",
          message: `Source mobile job ${sourceJobId} has no mobile execution results. Cannot determine failed scenarios. Use mode=all instead.`,
        };
      }
      const failedScenarioIds = new Set(
        scenarioResults
          .filter((entry) => entry.status === "failed")
          .map((entry) => entry.scenarioId),
      );
      selectedScenarios = allScenarios.filter((scenario) => failedScenarioIds.has(scenario.scenarioId));
      if (selectedScenarios.length === 0) {
        return {
          ok: false,
          error: "no_failures",
          message: `No failed mobile scenarios found in source job ${sourceJobId}. All ${allScenarios.length} scenarios passed.`,
        };
      }
    }

    const dataOverrides = enrichedMobileParams.dataOverrides
      ? Object.fromEntries(
        Object.entries(enrichedMobileParams.dataOverrides)
          .filter(([scenarioId]) => selectedScenarios.some((scenario) => scenario.scenarioId === scenarioId)),
      )
      : undefined;

    return {
      ok: true,
      jobType: "mobile-launch-execution",
      mobileParams: {
        ...enrichedMobileParams,
        scenarios: selectedScenarios,
        dataOverrides,
      },
      selectedCount: selectedScenarios.length,
      totalCount: allScenarios.length,
      sourceJobId,
      rerunMode: mode,
      appSlug: enrichedMobileParams.appSlug,
    };
  }

  return prepareRerunFromScenarioPreviewRoot(sourceJobId, mode, sourceJobId);
}

/**
 * Loads and selects scenarios from a scenario-preview root job's own persisted
 * `preview-scenarios.json`/`results.json`, exactly as `prepareRerun` always has for a direct
 * scenario-preview rerun. `returnedSourceJobId` is the IMMEDIATE job the caller asked to rerun
 * (which may differ from `rootJobId` when resolved through lineage) so the new job's own
 * `sourceJobId` chain pointer stays single-hop-correct. `currentSelection`, when given,
 * restricts the root's scenarios down to exactly the calling (reuse) job's own already-selected
 * scenarioIds -- preserving that job's selection instead of reverting to the root's full/
 * differently-filtered set.
 */
async function prepareRerunFromScenarioPreviewRoot(
  rootJobId: string,
  mode: "failed_only" | "all",
  returnedSourceJobId: string,
  currentSelection?: Set<string>,
): Promise<RerunPrepareResult> {
  const sourceDir = path.join(ARTIFACTS_DIR, rootJobId);
  const previewPath = path.join(sourceDir, "preview-scenarios.json");

  let allScenarios: VirtualCase[];
  try {
    allScenarios = JSON.parse(fs.readFileSync(previewPath, "utf-8")) as VirtualCase[];
  } catch (err) {
    return { ok: false, error: "parse_error", message: `Failed to parse preview-scenarios.json: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (allScenarios.length === 0) {
    return { ok: false, error: "empty_scenarios", message: "preview-scenarios.json contains no scenarios." };
  }

  if (currentSelection) {
    const scoped = allScenarios.filter((vc) => currentSelection.has(vc.recordedScenarioId ?? vc.displayId ?? vc.id));
    if (scoped.length === 0) {
      return {
        ok: false,
        error: "rerun_lineage_selection_mismatch",
        message: `None of job ${returnedSourceJobId}'s own selected scenarios were found in lineage root ${rootJobId}'s preview-scenarios.json.`,
      };
    }
    allScenarios = scoped;
  }

  // Extract metadata from artifacts
  const metadata = loadJobMetadata(sourceDir);
  const appSlug = metadata.appSlug || allScenarios[0]?.appSlug || "unknown";
  const targetAppSlug = metadata.targetAppSlug || allScenarios[0]?.targetAppSlug || appSlug;
  const targetAppName = metadata.targetAppName || allScenarios[0]?.targetAppName || targetAppSlug;
  const sectionName = metadata.sectionName;
  const sectionSlug = metadata.sectionSlug;

  let selectedVcs: VirtualCase[];

  if (mode === "failed_only") {
    const resultsPath = path.join(sourceDir, "results.json");

    if (!fs.existsSync(resultsPath)) {
      return { ok: false, error: "missing_results", message: `Source job ${rootJobId} has no results.json. Cannot determine failed cases. Use mode=all instead.` };
    }

    let results: { caseResults?: CaseOutcome[] };
    try {
      results = JSON.parse(fs.readFileSync(resultsPath, "utf-8"));
    } catch (err) {
      return { ok: false, error: "parse_error", message: `Failed to parse results.json: ${err instanceof Error ? err.message : String(err)}` };
    }

    if (!results.caseResults || results.caseResults.length === 0) {
      return { ok: false, error: "no_case_results", message: "No per-case results found in results.json. Cannot filter failed cases. Use mode=all instead." };
    }

    const failedIds = new Set(
      results.caseResults
        .filter((c) => c.status === "failed" || c.status === "review_needed")
        .map((c) => c.id),
    );

    selectedVcs = allScenarios.filter((vc) => failedIds.has(vc.displayId) || failedIds.has(vc.id));

    if (selectedVcs.length === 0) {
      return {
        ok: false,
        error: "no_failures",
        message: `No failed scenarios found in source job ${rootJobId}. All ${allScenarios.length} scenarios passed.`,
      };
    }
  } else {
    selectedVcs = [...allScenarios];
  }

  const scenarios: McpScenario[] = selectedVcs.map((vc) => ({
    ...virtualCaseToScenario(vc),
    // Canonical identity, preserved through so a reuse-eligible scenario can still be matched
    // to its persisted case.spec.ts by runs.ts without re-deriving lineage from title/index.
    scenarioId: vc.recordedScenarioId ?? vc.displayId ?? vc.id,
  }));
  const promotedSpecReuse = await resolvePromotedSpecReuse(selectedVcs);
  const allReusable = promotedSpecReuse.length > 0 && promotedSpecReuse.every((entry) => entry.reuse);

  return {
    ok: true,
    jobType: "scenario-preview",
    scenarios,
    selectedCount: scenarios.length,
    totalCount: allScenarios.length,
    sourceJobId: returnedSourceJobId,
    rerunMode: mode,
    appSlug,
    targetAppSlug,
    targetAppName,
    sectionName,
    sectionSlug,
    promotedSpecReuse,
    allReusable,
    options: metadata.options,
  };
}
