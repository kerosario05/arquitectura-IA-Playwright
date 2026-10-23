import { randomUUID } from "crypto";
import { currentReportAnalyst } from "../../auth/report-attribution";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { redactJiraScenarioInputs } from "../../jira/jira-rerun-manifest";
import type { JiraScenarioInput } from "../../jira/jira-semantic-executor";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "completed_with_failures" | "completed_with_sync_errors";

export type JobSummary = {
  sprintLabel?: string;
  totalStories?: number;
  synced?: number;
  syncFailed?: number;
  passed: number;
  failed: number;
  skipped?: number;
  completed?: number;
  requested?: number;
  executed?: number;
  progressPercent?: number;
  progress?: number;
  passRate?: number | null;
  errorMessage?: string;
  testRailRunId?: number;
  testRailRunUrl?: string;
  caseIds?: number[];
  command?: string;
  artifactsDir?: string;
  scenarioCount?: number;
  currentCaseIndex?: number;
  totalCases?: number;
  requestedCases?: number;
  executedCases?: number;
  notExecutableCases?: number;
  caseResults?: Array<{
    caseId: number;
    status: "passed" | "failed" | "skipped";
    completedAt: string;
    durationMs: number;
  }>;
  evidenceInitializationFailures?: number;
  reasonCode?: string;
  documentAttempted?: boolean;
  documentGenerated?: boolean;
  documentPathPresent?: boolean;
  documentPath?: string;
  scenariosSkipped?: number;
  blocked?: number;
  totalScenarios?: number;
  appium?: unknown;
  scenarioEvidenceCount?: number;
  evidenceResults?: number;
  documentError?: string;
  /** Directory holding this run's own evidence-run.json/evidencia.docx, once consolidated. */
  evidenceDir?: string;
};

export type Job = {
  id: string;
  type: "sprint" | "discovery-batch" | "scenario-preview" | "mobile-emulator-boot" | "mobile-test-run" | "mobile-launch-execution" | "mobile-route-learning" | "session-recording";
  status: JobStatus;
  params: Record<string, unknown>;
  issueKey?: string;
  checklistUrl?: string;
  defectCount?: number;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  logs: string[];
  summary?: JobSummary;
  currentCase?: string | null;
  currentCaseId?: string | null;
  currentCaseTitle?: string | null;
  errorMessage?: string;
  /**
   * Set only on an internal child job (e.g. a mixed-rerun subset execution) that a parent job
   * orchestrates but the parent alone should represent publicly. A job with this set is excluded
   * from `list()` by default — see `list({ includeInternal: true })` — but remains fully
   * addressable via `get(id)`, `subscribe(id, ...)`, and its own independent process/status/logs.
   */
  parentJobId?: string;
};

export type JobInternal = Job & {
  process?: ChildProcess;
  emitter: EventEmitter;
};

/**
 * Where every job is persisted (and read back after a restart). QA_RUN_HISTORY_DIR overrides it.
 * A test process gets its own temporary folder, so fixture jobs never land in the real history
 * the panel lists (tests run either through `tsx --test` or as plain `tsx x.test.ts`).
 */
export function resolveRunHistoryDir(): string {
  if (process.env.QA_RUN_HISTORY_DIR) return path.resolve(process.env.QA_RUN_HISTORY_DIR);
  if (process.env.NODE_TEST_CONTEXT || /\.test\.[cm]?[jt]s$/.test(process.argv[1] ?? "")) {
    const dir = path.join(os.tmpdir(), `qa-lab-run-history-test-${process.pid}`);
    process.once("exit", () => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
  }
  return path.resolve(process.cwd(), ".artifacts", "qa-lab-run-history");
}

const RUN_HISTORY_DIR = resolveRunHistoryDir();
const TERMINAL_STATUSES = new Set<JobStatus>([
  "done", "failed", "cancelled", "completed_with_failures", "completed_with_sync_errors",
]);
const PERSISTED_PARAM_KEYS = [
  "analystName",
  "executionEngine",
  "appSlug", "projectSlug", "targetAppSlug", "launchId", "huKey", "huTitle", "jiraKey", "jiraTitle", "scenarioTitle", "title",
  "testrailProjectId", "testrailProjectName", "testrailSuiteId", "testrailSuiteName", "testrailSectionId", "sectionId", "sectionName", "sectionSlug", "testRunId",
] as const;
const PERSISTED_SUMMARY_KEYS = [
  "totalStories", "synced", "syncFailed", "passed", "failed", "skipped", "completed", "requested", "executed",
  "progressPercent", "passRate", "scenarioCount", "currentCaseIndex", "totalCases", "requestedCases", "executedCases",
  "notExecutableCases", "testRailRunId", "testRailRunUrl", "reasonCode", "errorMessage",
] as const;

/** summary.reasonCode of a job that was still running when the server process stopped. */
export const INTERRUPTED_REASON_CODE = "interrupted_by_restart";
const INTERRUPTED_MESSAGE = "Interrumpida: el servidor se reinició (despliegue) mientras la ejecución corría. Puedes volver a ejecutarla.";
/** Non-terminal snapshots are rewritten at most this often (status changes always persist). */
const PROGRESS_PERSIST_INTERVAL_MS = 2_000;

function isTerminalStatus(status: string): status is JobStatus {
  return TERMINAL_STATUSES.has(status as JobStatus);
}

function logFilePath(id: string): string {
  return path.join(RUN_HISTORY_DIR, `${id}.log`);
}

function readPersistedLogs(id: string): string[] {
  try {
    const text = fs.readFileSync(logFilePath(id), "utf-8");
    return text.length ? text.replace(/\n$/, "").split("\n") : [];
  } catch {
    return [];
  }
}

function persistedSnapshot(job: JobInternal): Job {
  const params: Record<string, unknown> = {};
  for (const key of PERSISTED_PARAM_KEYS) {
    const value = job.params[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") params[key] = value;
  }

  const summary: Record<string, unknown> = {};
  if (job.params.executionEngine === "jira_semantic") {
    const origin = job.params.scenarioOrigin as { kind?: string; jiraKey?: string } | undefined;
    if (origin?.kind === "jira_generated" && typeof origin.jiraKey === "string") params.scenarioOrigin = { kind: origin.kind, jiraKey: origin.jiraKey };
  }
  for (const key of PERSISTED_SUMMARY_KEYS) {
    const value = job.summary?.[key as keyof JobSummary];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) summary[key] = value;
  }

  return {
    id: job.id,
    type: job.type,
    status: job.status,
    params,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    durationMs: job.durationMs,
    exitCode: job.exitCode,
    logs: [],
    summary: summary as JobSummary,
    currentCase: job.currentCase,
    currentCaseId: job.currentCaseId,
    currentCaseTitle: job.currentCaseTitle,
    errorMessage: job.errorMessage,
    ...(job.parentJobId ? { parentJobId: job.parentJobId } : {}),
  };
}

/**
 * Any well-formed snapshot, terminal or not: a job is persisted from its creation on, so one
 * still `queued`/`running` on disk at startup is a run the previous process never finished.
 */
function isPersistedJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<Job>;
  return typeof job.id === "string"
    && typeof job.type === "string"
    && typeof job.status === "string"
    && typeof job.createdAt === "string"
    && Boolean(job.params && typeof job.params === "object");
}

class JobStore {
  private readonly jobs = new Map<string, JobInternal>();
  private readonly persistedJobs = new Map<string, Job>();
  /** Last snapshot write per job, to throttle progress-only updates. */
  private readonly lastPersistAt = new Map<string, { at: number; status: JobStatus }>();

  constructor() {
    this.loadPersistedJobs();
  }

  create(
    type: "sprint" | "discovery-batch" | "scenario-preview" | "mobile-emulator-boot" | "mobile-test-run" | "mobile-launch-execution" | "mobile-route-learning" | "session-recording",
    params: Record<string, unknown>,
    options?: { parentJobId?: string },
  ): Job {
    const analystName = currentReportAnalyst();
    if (analystName) params = { ...params, analystName };
    const id = randomUUID();
    const job: JobInternal = {
      id,
      type,
      status: "queued",
      params,
      createdAt: new Date().toISOString(),
      logs: [],
      emitter: new EventEmitter(),
      parentJobId: options?.parentJobId,
    };
    job.emitter.setMaxListeners(100);
    this.jobs.set(id, job);
    this.persistJob(job);
    return this.serialize(job);
  }

  get(id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job ? this.serialize(job) : undefined;
  }

  /** A job from a previous server process, with the logs it wrote to disk. */
  getPersisted(id: string): Job | undefined {
    const job = this.persistedJobs.get(id);
    return job ? { ...job, logs: readPersistedLogs(id) } : undefined;
  }

  /** The live job when this process runs it, otherwise the persisted record. */
  getAny(id: string): Job | undefined {
    return this.get(id) ?? this.getPersisted(id);
  }

  getInternal(id: string): JobInternal | undefined {
    return this.jobs.get(id);
  }

  /**
   * Defaults to public/top-level jobs only (excludes any job with `parentJobId` set — an
   * internal child execution a parent orchestrates). Pass `{ includeInternal: true }` for
   * infrastructure that must see every job regardless of ownership (e.g. device-busy checks).
   */
  list(options?: { includeInternal?: boolean }): Job[] {
    const jobsById = new Map<string, Job>();
    if (!options?.includeInternal) {
      for (const job of this.persistedJobs.values()) {
        if (!job.parentJobId) jobsById.set(job.id, job);
      }
    }
    const runtimeJobs = options?.includeInternal
      ? Array.from(this.jobs.values())
      : Array.from(this.jobs.values()).filter((job) => !job.parentJobId);
    for (const job of runtimeJobs) jobsById.set(job.id, this.serialize(job));
    return Array.from(jobsById.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  update(id: string, patch: Partial<Pick<JobInternal, "status" | "startedAt" | "completedAt" | "durationMs" | "exitCode" | "summary" | "process" | "currentCase" | "currentCaseId" | "currentCaseTitle" | "errorMessage" | "issueKey" | "checklistUrl" | "defectCount">>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
    // Auto-compute durationMs when job completes (if not explicitly provided)
    if (patch.completedAt && job.startedAt && !patch.durationMs && !job.durationMs) {
      job.durationMs = new Date(patch.completedAt).getTime() - new Date(job.startedAt).getTime();
    }
    const last = this.lastPersistAt.get(id);
    if (
      isTerminalStatus(job.status)
      || !last
      || last.status !== job.status
      || Date.now() - last.at >= PROGRESS_PERSIST_INTERVAL_MS
    ) {
      this.persistJob(job);
    }
    job.emitter.emit("update", this.serialize(job));
  }

  private loadPersistedJobs(): void {
    let files: string[];
    try {
      files = fs.readdirSync(RUN_HISTORY_DIR).filter((name) => name.endsWith(".json"));
    } catch {
      return;
    }
    for (const name of files) {
      try {
        const parsed: unknown = JSON.parse(fs.readFileSync(path.join(RUN_HISTORY_DIR, name), "utf-8"));
        if (!isPersistedJob(parsed)) continue;
        // Nothing in this new process runs it: the previous process stopped (a deploy restarts
        // the services) mid-run. Close it as failed so it shows up and can be rerun.
        this.persistedJobs.set(parsed.id, isTerminalStatus(parsed.status) ? parsed : this.markInterrupted(parsed));
      } catch {
        // Ignore incomplete/corrupt records so historical data cannot block startup.
      }
    }
  }

  private markInterrupted(job: Job): Job {
    const completedAt = new Date().toISOString();
    const interrupted: Job = {
      ...job,
      status: "failed",
      completedAt,
      durationMs: job.startedAt ? Date.parse(completedAt) - Date.parse(job.startedAt) : job.durationMs,
      errorMessage: INTERRUPTED_MESSAGE,
      summary: { passed: 0, failed: 0, ...job.summary, reasonCode: INTERRUPTED_REASON_CODE, errorMessage: INTERRUPTED_MESSAGE },
      logs: [],
    };
    this.writeSnapshot(interrupted);
    try {
      fs.appendFileSync(logFilePath(job.id), `[server] ${INTERRUPTED_MESSAGE}\n`, "utf-8");
    } catch {
      // The record itself already says it was interrupted.
    }
    return interrupted;
  }

  private persistJob(job: JobInternal): void {
    const snapshot = persistedSnapshot(job);
    if (!this.writeSnapshot(snapshot)) return;
    this.lastPersistAt.set(job.id, { at: Date.now(), status: job.status });
    this.persistedJobs.set(job.id, snapshot);
  }

  private writeSnapshot(snapshot: Job): boolean {
    try {
      fs.mkdirSync(RUN_HISTORY_DIR, { recursive: true });
      const target = path.join(RUN_HISTORY_DIR, `${snapshot.id}.json`);
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(snapshot), "utf-8");
      fs.renameSync(temporary, target);
      return true;
    } catch {
      // Best effort: history persistence must not alter the run's final status.
      return false;
    }
  }

  clearTransientParams(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    delete job.params.runtimeEntriesByCase;
    delete job.params.dataOverrides;
    delete job.params.jiraSemanticScenarios;
    if (job.params.executionEngine === "jira_semantic" && Array.isArray(job.params.scenarios)) {
      job.params.scenarios = (job.params.scenarios as JiraScenarioInput[]).map(redactJiraScenarioInputs);
    }
  }

  appendLog(id: string, line: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.logs.push(line);
    try {
      fs.appendFileSync(logFilePath(id), `${line.replace(/\r?\n/g, " ")}\n`, "utf-8");
    } catch {
      // Best effort: the in-memory log still serves this process.
    }
    job.emitter.emit("log", line);
  }

  subscribe(
    id: string,
    handlers: { onLog: (line: string) => void; onUpdate: (job: Job) => void }
  ): () => void {
    const job = this.jobs.get(id);
    if (!job) return () => {};
    job.emitter.on("log", handlers.onLog);
    job.emitter.on("update", handlers.onUpdate);
    return () => {
      job.emitter.off("log", handlers.onLog);
      job.emitter.off("update", handlers.onUpdate);
    };
  }

  private serialize(job: JobInternal): Job {
    const { process: _proc, emitter: _em, ...pub } = job;
    const params = { ...pub.params };
    if (params.executionEngine === "jira_semantic") {
      if (params.dataOverrides && typeof params.dataOverrides === "object") params.dataOverrides = Object.fromEntries(Object.keys(params.dataOverrides).map(key => [key, "[REDACTED]"]));
      if (Array.isArray(params.scenarios)) params.scenarios = (params.scenarios as JiraScenarioInput[]).map(redactJiraScenarioInputs);
    }
    const runtimeEntriesByCase = params.runtimeEntriesByCase;
    if (runtimeEntriesByCase && typeof runtimeEntriesByCase === "object" && !Array.isArray(runtimeEntriesByCase)) {
      params.runtimeEntriesByCase = Object.fromEntries(
        Object.entries(runtimeEntriesByCase as Record<string, unknown>).map(([caseId, entries]) => [
          caseId,
          Array.isArray(entries)
            ? entries.map((entry) => {
                const value = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
                return {
                  key: value.key,
                  source: value.source,
                  sensitive: value.sensitive === true,
                  present: typeof value.value === "string" && value.value.length > 0,
                };
              })
            : [],
        ]),
      );
    }
    return { ...pub, params };
  }
}

export const jobStore = new JobStore();
