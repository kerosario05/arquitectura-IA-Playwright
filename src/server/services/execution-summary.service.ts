/**
 * Execution summary service.
 *
 * Aggregates everything about a finished execution into a single view, read straight from the
 * persisted launch manifest (`.artifacts/scenario-launch-runs/<launchId>/launch-manifest.json`,
 * survives restarts) plus the defect checklist store:
 *   - the HU used (+ TestRail project/section and automation project)
 *   - the scenarios that were executed and pushed to TestRail, with their result
 *   - the TestRail Test Run (id + derived URL) and the run summary
 *   - the defects that were registered in Jira for that run
 *
 * Read-only. No manifest is written here.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "../../config/env";
import { defectChecklistStore } from "./defect-checklist-store";
import { loadScenarios, loadTrace } from "../../recording/recording-store";

const LAUNCH_ARTIFACTS_DIR = path.join(process.cwd(), ".artifacts", "scenario-launch-runs");
/** Recording replays ("Ejecutar" in Grabación) persist here, never as a launch manifest. */
const RECORDING_RUN_ARTIFACTS_DIR = path.join(process.cwd(), ".artifacts", "scenario-preview-runs");
const EVIDENCE_ROOT = path.join(process.cwd(), ".artifacts", "evidence");

export type ExecutionScenarioSummary = {
  scenarioId: string;
  caseId?: number;
  title: string;
  result: "passed" | "failed" | "pending";
  syncStatus?: string;
  testRailStatusId?: number;
};

export type ExecutionDefectSummary = {
  id: string;
  title: string;
  severity: string;
  status: string;
  /** True when the defect was actually created as a Jira issue (has a Jira key). */
  registeredInJira: boolean;
  jiraIssueKey?: string;
  jiraIssueUrl?: string;
};

/** Where an execution was launched from: a Jira/TestRail launch, or a recording replay. */
export type ExecutionSource = "launch" | "recording";

/**
 * What the run was based on, for the detail header: a Jira user story, TestRail cases with no
 * story behind them, or a recording. A launch without a Jira key used to render an empty "Historia
 * de Usuario" block, and a recording put its goal under it.
 */
export type ExecutionOrigin = "jira" | "testrail" | "recording";

export type ExecutionSummary = {
  launchId: string;
  source?: ExecutionSource;
  origin?: ExecutionOrigin;
  recordingId?: string;
  recording?: { id: string; goal?: string };
  jobId?: string;
  createdAt?: string;
  completedAt?: string;
  status?: string;
  hu: { key?: string; title?: string };
  project: { appSlug?: string };
  testRail: {
    projectId?: number | string;
    suiteId?: number | string;
    sectionId?: number | string;
    sectionName?: string;
    sectionSlug?: string;
    runId?: number | string;
    runUrl?: string;
  };
  scenarios: ExecutionScenarioSummary[];
  summary: { total: number; passed: number; failed: number; synced?: number; syncFailed?: number };
  defects: ExecutionDefectSummary[];
  evidenceAvailable: boolean;
};

export type ExecutionSummaryListItem = {
  launchId: string;
  source?: ExecutionSource;
  recordingId?: string;
  createdAt?: string;
  completedAt?: string;
  status?: string;
  huKey?: string;
  huTitle?: string;
  appSlug?: string;
  testRunId?: number | string;
  scenarioCount: number;
  passed: number;
  failed: number;
};

type ManifestShape = {
  launchId?: string;
  jobId?: string;
  createdAt?: string;
  completedAt?: string;
  status?: string;
  appSlug?: string;
  sectionSlug?: string;
  sectionName?: string;
  sectionId?: number | string;
  jira?: { key?: string; title?: string };
  testRail?: { projectId?: number | string; suiteId?: number | string; sectionId?: number | string; runId?: number | string };
  publishedCases?: Array<{
    scenarioId?: string; caseId?: number; title?: string;
    executionScenarioId?: string; launchScenarioId?: string; testrailCustomScenarioId?: string;
  }>;
  results?: Array<{ scenarioId?: string; caseId?: number; discoveryStatus?: string; syncStatus?: string; testRailStatusId?: number }>;
  summary?: { total?: number; passed?: number; failed?: number; synced?: number; syncFailed?: number };
  executionPlan?: { standardScenarios?: Array<{ scenarioId?: string; title?: string }> };
};

function readManifest(launchId: string): ManifestShape | null {
  const p = path.join(LAUNCH_ARTIFACTS_DIR, launchId, "launch-manifest.json");
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as ManifestShape;
  } catch {
    return null;
  }
}

/** Builds the TestRail Run URL from the configured base URL + runId (not persisted in the manifest). */
function buildTestRailRunUrl(runId?: number | string): string | undefined {
  const base = config.integrations.testRail?.url?.trim();
  if (!base || runId == null || runId === "") return undefined;
  return `${base.replace(/\/+$/, "")}/index.php?/runs/view/${runId}`;
}

/** True when a consolidated evidence document (PDF or DOCX) exists for this run's jobId. */
function hasEvidenceDocx(jobId?: string): boolean {
  if (!jobId) return false;
  try {
    // Structured layout: .artifacts/evidence/<appSlug>/<sectionSlug>/runs/<jobId>/evidencia.docx
    // Fall back to a shallow scan since appSlug/sectionSlug aren't needed to confirm existence.
    const stack: string[] = [EVIDENCE_ROOT];
    while (stack.length) {
      const dir = stack.pop()!;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          // Only descend where the jobId could live to keep the scan cheap.
          if (e.name === jobId) {
            if (fs.existsSync(path.join(full, "evidencia.pdf")) || fs.existsSync(path.join(full, "evidencia.docx"))) return true;
          }
          stack.push(full);
        }
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** Maps a TestRail discoveryStatus to the summary's result enum. */
function toResult(discoveryStatus?: string): "passed" | "failed" | "pending" {
  if (discoveryStatus === "passed") return "passed";
  if (discoveryStatus == null) return "pending";
  return "failed";
}

function buildScenarioSummaries(manifest: ManifestShape): ExecutionScenarioSummary[] {
  const published = manifest.publishedCases ?? [];
  // Index results by every id a scenario might be referenced under.
  const resultById = new Map<string, NonNullable<ManifestShape["results"]>[number]>();
  for (const r of manifest.results ?? []) {
    if (r.scenarioId) resultById.set(r.scenarioId, r);
  }
  const planTitleById = new Map<string, string>();
  for (const s of manifest.executionPlan?.standardScenarios ?? []) {
    if (s.scenarioId && s.title) planTitleById.set(s.scenarioId, s.title);
  }

  if (published.length > 0) {
    return published.map((pc) => {
      const ids = [pc.scenarioId, pc.executionScenarioId, pc.launchScenarioId, pc.testrailCustomScenarioId].filter(Boolean) as string[];
      const r = ids.map((id) => resultById.get(id)).find(Boolean);
      const title = pc.title || ids.map((id) => planTitleById.get(id)).find(Boolean) || pc.scenarioId || "escenario";
      return {
        scenarioId: pc.scenarioId || ids[0] || "unknown",
        caseId: pc.caseId,
        title,
        result: toResult(r?.discoveryStatus),
        syncStatus: r?.syncStatus,
        testRailStatusId: r?.testRailStatusId,
      };
    });
  }

  // Fallback: no publishedCases (e.g. a run that only has results/plan).
  return (manifest.results ?? []).map((r) => ({
    scenarioId: r.scenarioId || "unknown",
    caseId: r.caseId,
    title: (r.scenarioId && planTitleById.get(r.scenarioId)) || r.scenarioId || "escenario",
    result: toResult(r.discoveryStatus),
    syncStatus: r.syncStatus,
    testRailStatusId: r.testRailStatusId,
  }));
}

/**
 * Collects the defects for this execution from the HU's checklist, flagging which ones were
 * actually registered as Jira issues (have a Jira key). When the manifest carries the executing
 * jobId we scope to that exact run; otherwise (older manifests without a jobId) we return all of
 * the HU's defects. Includes not-yet-uploaded defects so the summary is useful before the Jira
 * upload step runs — the `registeredInJira` flag distinguishes them.
 */
function buildDefectSummaries(huKey: string | undefined, jobId: string | undefined): ExecutionDefectSummary[] {
  if (!huKey) return [];
  const list = defectChecklistStore.get(huKey);
  if (!list) return [];
  return list.defects
    .filter((d) => (jobId ? d.jobId === jobId : true))
    .map((d) => ({
      id: d.id,
      title: d.title || d.scenarioTitle || d.scenarioId || "Defecto",
      severity: d.severity,
      status: d.status,
      registeredInJira: Boolean(d.jiraIssueKey),
      jiraIssueKey: d.jiraIssueKey,
      jiraIssueUrl: d.jiraIssueUrl,
    }));
}

/** Builds the full summary for one execution, or null if the manifest is missing/unreadable. */
type RecordingRunShape = {
  jobId: string;
  testRail?: { projectId?: string; suiteId?: string; sectionId?: string; sectionName?: string };
  createdAt?: string;
  completedAt?: string;
  status?: string;
  appSlug?: string;
  recordingId: string;
  recordingTitle?: string;
  scenarios: ExecutionScenarioSummary[];
};

/**
 * A recording replay, read from its own run folder (job.json + results.json). These runs never
 * wrote a launch manifest, so "Ejecuciones" listed none of them: every execution started from
 * Grabación was invisible there although its results and evidence were on disk.
 */
function readRecordingRun(jobId: string): RecordingRunShape | null {
  try {
    const dir = path.join(RECORDING_RUN_ARTIFACTS_DIR, jobId);
    const resultsPath = path.join(dir, "results.json");
    if (!fs.existsSync(resultsPath)) return null;
    const results = JSON.parse(fs.readFileSync(resultsPath, "utf-8")) as {
      cases?: Array<{ recordingId?: string; recordedScenarioId?: string; caseId?: string | number; testRailCaseId?: number; title?: string; status?: string }>;
    };
    const cases = results.cases ?? [];
    const recordingId = cases.find((entry) => entry.recordingId)?.recordingId;
    if (!recordingId) return null;
    const jobPath = path.join(dir, "job.json");
    const job = fs.existsSync(jobPath)
      ? JSON.parse(fs.readFileSync(jobPath, "utf-8")) as { createdAt?: string; completedAt?: string; status?: string; appSlug?: string; testRail?: RecordingRunShape["testRail"] }
      : {};
    // TestRail case ids -- and the destination they were filed in -- live on the recorded
    // scenarios once published, whether by "Subir a TestRail" or by an execution.
    const executedIds = new Set(cases.map((entry) => entry.recordedScenarioId).filter(Boolean));
    const published = (job.appSlug ? loadScenarios(job.appSlug, recordingId) : [])
      .filter((scenario) => executedIds.has(scenario.scenarioId) && typeof scenario.testRailCaseId === "number");
    const caseIdByScenario = new Map(published.map((scenario) => [scenario.scenarioId, scenario.testRailCaseId as number]));
    const publishedDestination = published.find((scenario) => scenario.testRailDestination?.sectionId)?.testRailDestination;
    const trace = job.appSlug ? loadTrace(job.appSlug, recordingId) : null;
    return {
      jobId,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      status: job.status,
      appSlug: job.appSlug,
      recordingId,
      // The destination picked for this run wins; otherwise where its scenarios were published.
      ...(job.testRail?.sectionId
        ? { testRail: job.testRail }
        : publishedDestination ? { testRail: publishedDestination } : {}),
      recordingTitle: trace?.recordingGoal?.declaredGoal ?? trace?.label ?? undefined,
      scenarios: cases.map((entry) => ({
        scenarioId: entry.recordedScenarioId ?? String(entry.caseId ?? ""),
        ...(typeof entry.testRailCaseId === "number"
          ? { caseId: entry.testRailCaseId }
          : caseIdByScenario.has(entry.recordedScenarioId ?? "") ? { caseId: caseIdByScenario.get(entry.recordedScenarioId ?? "") } : {}),
        title: entry.title ?? entry.recordedScenarioId ?? "",
        result: entry.status === "passed" ? "passed" as const : entry.status === "failed" ? "failed" as const : "pending" as const,
      })),
    };
  } catch {
    return null;
  }
}

/** Job states in the launch vocabulary the list already shows (completed / with failures). */
function recordingRunStatus(jobStatus: string | undefined, failed: number): string | undefined {
  if (jobStatus === "queued" || jobStatus === "running") return "running";
  if (jobStatus === undefined) return undefined;
  return failed > 0 || jobStatus === "failed" || jobStatus === "error" ? "completed_with_failures" : "completed";
}

function buildRecordingRunSummary(run: RecordingRunShape): ExecutionSummary {
  const failed = run.scenarios.filter((scenario) => scenario.result === "failed").length;
  return {
    launchId: run.jobId,
    source: "recording",
    origin: "recording",
    recordingId: run.recordingId,
    recording: { id: run.recordingId, ...(run.recordingTitle ? { goal: run.recordingTitle } : {}) },
    jobId: run.jobId,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    status: recordingRunStatus(run.status, failed),
    // A recording is not a user story: no HU fields. Its goal is the run's title.
    hu: {},
    project: { appSlug: run.appSlug },
    testRail: {
      projectId: run.testRail?.projectId,
      suiteId: run.testRail?.suiteId,
      sectionId: run.testRail?.sectionId,
      sectionName: run.testRail?.sectionName,
    },
    scenarios: run.scenarios,
    summary: {
      total: run.scenarios.length,
      passed: run.scenarios.filter((scenario) => scenario.result === "passed").length,
      failed,
    },
    defects: [],
    evidenceAvailable: hasEvidenceDocx(run.jobId),
  };
}

function listRecordingRunSummaries(): ExecutionSummaryListItem[] {
  let dirs: string[];
  try {
    dirs = fs.readdirSync(RECORDING_RUN_ARTIFACTS_DIR, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
  return dirs.flatMap((jobId) => {
    const run = readRecordingRun(jobId);
    if (!run) return [];
    const summary = buildRecordingRunSummary(run);
    return [{
      launchId: jobId,
      source: "recording" as const,
      recordingId: run.recordingId,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      status: summary.status,
      huTitle: run.recordingTitle ? `Grabación: ${run.recordingTitle}` : "Grabación",
      appSlug: run.appSlug,
      scenarioCount: summary.summary.total,
      passed: summary.summary.passed,
      failed: summary.summary.failed,
    }];
  });
}

export function buildExecutionSummary(launchId: string): ExecutionSummary | null {
  const manifest = readManifest(launchId);
  if (!manifest) {
    const run = readRecordingRun(launchId);
    return run ? buildRecordingRunSummary(run) : null;
  }

  const scenarios = buildScenarioSummaries(manifest);
  const passed = scenarios.filter((s) => s.result === "passed").length;
  const failed = scenarios.filter((s) => s.result === "failed").length;
  const huKey = manifest.jira?.key;

  return {
    launchId,
    source: "launch",
    origin: huKey ? "jira" : "testrail",
    jobId: manifest.jobId,
    createdAt: manifest.createdAt,
    completedAt: manifest.completedAt,
    status: manifest.status,
    hu: { key: huKey, title: manifest.jira?.title },
    project: { appSlug: manifest.appSlug },
    testRail: {
      projectId: manifest.testRail?.projectId,
      suiteId: manifest.testRail?.suiteId,
      sectionId: manifest.testRail?.sectionId ?? manifest.sectionId,
      sectionName: manifest.sectionName,
      sectionSlug: manifest.sectionSlug,
      runId: manifest.testRail?.runId,
      runUrl: buildTestRailRunUrl(manifest.testRail?.runId),
    },
    scenarios,
    summary: {
      total: manifest.summary?.total ?? scenarios.length,
      passed: manifest.summary?.passed ?? passed,
      failed: manifest.summary?.failed ?? failed,
      synced: manifest.summary?.synced,
      syncFailed: manifest.summary?.syncFailed,
    },
    defects: buildDefectSummaries(huKey, manifest.jobId),
    evidenceAvailable: hasEvidenceDocx(manifest.jobId),
  };
}

/** Lists all executions (compact), newest first. */
export function listExecutionSummaries(): ExecutionSummaryListItem[] {
  let dirs: string[];
  try {
    dirs = fs
      .readdirSync(LAUNCH_ARTIFACTS_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }

  const items: ExecutionSummaryListItem[] = [];
  for (const launchId of dirs) {
    const m = readManifest(launchId);
    if (!m) continue;
    const scenarios = buildScenarioSummaries(m);
    items.push({
      launchId,
      source: "launch",
      createdAt: m.createdAt,
      completedAt: m.completedAt,
      status: m.status,
      huKey: m.jira?.key,
      huTitle: m.jira?.title,
      appSlug: m.appSlug,
      testRunId: m.testRail?.runId,
      scenarioCount: m.summary?.total ?? scenarios.length,
      passed: m.summary?.passed ?? scenarios.filter((s) => s.result === "passed").length,
      failed: m.summary?.failed ?? scenarios.filter((s) => s.result === "failed").length,
    });
  }

  // Recording replays live in their own folder; without them every execution started from
  // Grabación was missing from this list.
  items.push(...listRecordingRunSummaries());
  return items.sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")));
}
