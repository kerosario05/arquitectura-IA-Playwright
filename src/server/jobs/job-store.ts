import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "completed_with_failures" | "completed_with_sync_errors";

export type JobSummary = {
  sprintLabel?: string;
  totalStories: number;
  synced: number;
  syncFailed?: number;
  passed: number;
  failed: number;
  skipped?: number;
  completed?: number;
  requested?: number;
  executed?: number;
  progressPercent?: number;
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

const RUN_HISTORY_DIR = path.resolve(process.cwd(), ".artifacts", "qa-lab-run-history");
const TERMINAL_STATUSES = new Set<JobStatus>([
  "done", "failed", "cancelled", "completed_with_failures", "completed_with_sync_errors",
]);
const PERSISTED_PARAM_KEYS = [
  "appSlug", "projectSlug", "targetAppSlug", "launchId", "huTitle", "scenarioTitle", "title",
  "testrailProjectId", "testrailSuiteId", "testrailSectionId", "sectionId", "sectionName", "testRunId",
] as const;
const PERSISTED_SUMMARY_KEYS = [
  "totalStories", "synced", "syncFailed", "passed", "failed", "skipped", "completed", "requested", "executed",
  "progressPercent", "passRate", "scenarioCount", "currentCaseIndex", "totalCases", "requestedCases", "executedCases",
  "notExecutableCases", "testRailRunId", "testRailRunUrl", "reasonCode", "errorMessage",
] as const;

function isTerminalStatus(status: string): status is JobStatus {
  return TERMINAL_STATUSES.has(status as JobStatus);
}

function persistedSnapshot(job: JobInternal): Job {
  const params: Record<string, unknown> = {};
  for (const key of PERSISTED_PARAM_KEYS) {
    const value = job.params[key];
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") params[key] = value;
  }

  const summary: Record<string, unknown> = {};
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
  };
}

function isPersistedJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const job = value as Partial<Job>;
  return typeof job.id === "string"
    && typeof job.type === "string"
    && typeof job.status === "string"
    && isTerminalStatus(job.status)
    && typeof job.createdAt === "string"
    && Boolean(job.params && typeof job.params === "object");
}

class JobStore {
  private readonly jobs = new Map<string, JobInternal>();
  private readonly persistedJobs = new Map<string, Job>();

  constructor() {
    this.loadPersistedJobs();
  }

  create(
    type: "sprint" | "discovery-batch" | "scenario-preview" | "mobile-emulator-boot" | "mobile-test-run" | "mobile-launch-execution" | "mobile-route-learning" | "session-recording",
    params: Record<string, unknown>,
    options?: { parentJobId?: string },
  ): Job {
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
    return this.serialize(job);
  }

  get(id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job ? this.serialize(job) : undefined;
  }

  getPersisted(id: string): Job | undefined {
    return this.persistedJobs.get(id);
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
      for (const job of this.persistedJobs.values()) jobsById.set(job.id, job);
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
    if (!job.parentJobId && isTerminalStatus(job.status)) this.persistJob(job);
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
        if (isPersistedJob(parsed)) this.persistedJobs.set(parsed.id, parsed);
      } catch {
        // Ignore incomplete/corrupt records so historical data cannot block startup.
      }
    }
  }

  private persistJob(job: JobInternal): void {
    try {
      fs.mkdirSync(RUN_HISTORY_DIR, { recursive: true });
      const snapshot = persistedSnapshot(job);
      const target = path.join(RUN_HISTORY_DIR, `${job.id}.json`);
      const temporary = `${target}.${process.pid}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(snapshot), "utf-8");
      fs.renameSync(temporary, target);
      this.persistedJobs.set(job.id, snapshot);
    } catch {
      // Best effort: history persistence must not alter the run's final status.
    }
  }

  clearTransientParams(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    delete job.params.runtimeEntriesByCase;
    delete job.params.dataOverrides;
  }

  appendLog(id: string, line: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.logs.push(line);
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
