import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import {
  appendJobLogs,
  countJobLogLines,
  deleteJob,
  insertJob,
  listRecentJobs,
  loadLogsForJobs,
  markInterruptedJobs,
  saveJob,
  pruneOldJobs,
} from "../../db/job-repository";

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
  /**
   * Per-scenario outcome of replaying a recorded web walkthrough.
   *
   * Kept here rather than in a store of its own because the panel already polls the job for
   * everything else it shows, and a replay has nothing to report once the job is gone.
   */
  recordingResults?: Array<{
    scenarioId: string;
    title: string;
    status: "passed" | "failed" | "partial" | "skipped";
    failedStep?: { index: number; description?: string; error?: string };
    evidenceDir?: string;
    specPath?: string;
    promotionError?: string;
  }>;
};

export type Job = {
  id: string;
  type: "sprint" | "discovery-batch" | "scenario-preview" | "mobile-emulator-boot" | "mobile-test-run" | "mobile-launch-execution" | "mobile-route-learning" | "session-recording" | "web-recording-execution";
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
};

export type JobInternal = Job & {
  process?: ChildProcess;
  emitter: EventEmitter;
};

/**
 * How much history is brought back into memory on boot. Everything stays in
 * SQLite; these caps only bound what a restart reloads, so a long-lived install
 * does not drag thousands of log lines into the process on every start.
 */
const HYDRATE_JOB_LIMIT = 200;
const HYDRATE_LOG_JOBS = 25;
const HYDRATE_LOG_LINES = 2000;

/** Log lines are flushed in batches rather than one write per line. */
const LOG_FLUSH_INTERVAL_MS = 500;
const LOG_FLUSH_THRESHOLD = 50;

// Exported so tests can build a second instance and simulate a restart.
export class JobStore {
  private readonly jobs = new Map<string, JobInternal>();

  /**
   * Write-behind persistence.
   *
   * The public API is synchronous and has ~150 call sites, so it stays that way:
   * mutations land in memory immediately and are queued for SQLite. Chaining the
   * writes keeps them ordered — an update must never overtake the insert that
   * created the row — and a failure is logged rather than thrown, because losing
   * the persisted copy must not break a running execution.
   */
  private writeChain: Promise<void> = Promise.resolve();
  private readonly pendingLogs = new Map<string, { startSeq: number; lines: string[] }>();
  private readonly persistedLogCount = new Map<string, number>();
  private flushTimer: NodeJS.Timeout | null = null;

  private enqueue(operation: () => Promise<void>, label: string): void {
    this.writeChain = this.writeChain.then(
      () =>
        operation().catch((err) => {
          console.error(`[job-store] no se pudo persistir (${label}):`, err instanceof Error ? err.message : err);
        }),
      () => undefined,
    );
  }

  create(type: "sprint" | "discovery-batch" | "scenario-preview" | "mobile-emulator-boot" | "mobile-test-run" | "mobile-launch-execution" | "mobile-route-learning" | "session-recording" | "web-recording-execution", params: Record<string, unknown>): Job {
    const id = randomUUID();
    const job: JobInternal = {
      id,
      type,
      status: "queued",
      params,
      createdAt: new Date().toISOString(),
      logs: [],
      emitter: new EventEmitter()
    };
    job.emitter.setMaxListeners(100);
    this.jobs.set(id, job);
    this.persistedLogCount.set(id, 0);
    const snapshot = this.serialize(job);
    this.enqueue(() => insertJob(snapshot), `create ${id}`);
    return snapshot;
  }

  get(id: string): Job | undefined {
    const job = this.jobs.get(id);
    return job ? this.serialize(job) : undefined;
  }

  getInternal(id: string): JobInternal | undefined {
    return this.jobs.get(id);
  }

  list(): Job[] {
    return Array.from(this.jobs.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((j) => this.serialize(j));
  }

  update(id: string, patch: Partial<Pick<JobInternal, "status" | "startedAt" | "completedAt" | "durationMs" | "exitCode" | "summary" | "process" | "currentCase" | "currentCaseId" | "currentCaseTitle" | "errorMessage" | "issueKey" | "checklistUrl" | "defectCount">>): void {
    const job = this.jobs.get(id);
    if (!job) return;
    Object.assign(job, patch);
    // Auto-compute durationMs when job completes (if not explicitly provided)
    if (patch.completedAt && job.startedAt && !patch.durationMs && !job.durationMs) {
      job.durationMs = new Date(patch.completedAt).getTime() - new Date(job.startedAt).getTime();
    }
    const snapshot = this.serialize(job);
    job.emitter.emit("update", snapshot);

    // A finished job must not leave its tail of logs unwritten.
    if (patch.completedAt || (patch.status && patch.status !== "running" && patch.status !== "queued")) {
      this.flushLogs();
    }
    this.enqueue(() => saveJob(snapshot), `update ${id}`);
  }

  appendLog(id: string, line: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.logs.push(line);
    job.emitter.emit("log", line);

    const pending = this.pendingLogs.get(id) ?? {
      startSeq: this.persistedLogCount.get(id) ?? 0,
      lines: [],
    };
    pending.lines.push(line);
    this.pendingLogs.set(id, pending);

    if (pending.lines.length >= LOG_FLUSH_THRESHOLD) {
      this.flushLogs();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushLogs(), LOG_FLUSH_INTERVAL_MS);
      // Never hold the process open just to flush logs.
      this.flushTimer.unref?.();
    }
  }

  /** Moves buffered log lines into the write queue. Safe to call at any time. */
  flushLogs(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingLogs.size === 0) return;

    const batches = [...this.pendingLogs.entries()];
    this.pendingLogs.clear();
    for (const [jobId, pending] of batches) {
      this.persistedLogCount.set(jobId, pending.startSeq + pending.lines.length);
      this.enqueue(
        () => appendJobLogs(jobId, pending.startSeq, pending.lines),
        `logs ${jobId}`,
      );
    }
  }

  /** Resolves once every queued write has been applied. For tests and shutdown. */
  async drain(): Promise<void> {
    this.flushLogs();
    await this.writeChain;
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

  /**
   * Rebuilds the in-memory map from SQLite at boot.
   *
   * Anything still marked queued or running belonged to the process that died,
   * so it is closed out as failed with an explicit reason — otherwise those runs
   * would sit "in progress" forever and nobody could tell them apart from live
   * ones.
   */
  async hydrate(options: { retentionDays?: number } = {}): Promise<{
    restored: number;
    interrupted: number;
    pruned: number;
  }> {
    const interrupted = await markInterruptedJobs();
    const pruned = options.retentionDays ? await pruneOldJobs(options.retentionDays) : 0;

    const persisted = await listRecentJobs(HYDRATE_JOB_LIMIT);
    const withLogs = persisted.slice(0, HYDRATE_LOG_JOBS).map((job) => job.id);
    const logsByJob = await loadLogsForJobs(withLogs, HYDRATE_LOG_LINES);

    for (const stored of persisted) {
      if (this.jobs.has(stored.id)) continue;
      const emitter = new EventEmitter();
      emitter.setMaxListeners(100);
      const job: JobInternal = {
        ...(stored as unknown as Job),
        status: stored.status as JobStatus,
        type: stored.type as Job["type"],
        logs: logsByJob.get(stored.id) ?? [],
        emitter,
      };
      this.jobs.set(stored.id, job);
      // Logs already on disk must not be written again by the next flush.
      this.persistedLogCount.set(stored.id, await countJobLogLines(stored.id));
    }

    return { restored: persisted.length, interrupted, pruned };
  }

  /** Removes a job from memory and from SQLite. */
  remove(id: string): void {
    this.jobs.delete(id);
    this.pendingLogs.delete(id);
    this.persistedLogCount.delete(id);
    this.enqueue(() => deleteJob(id), `delete ${id}`);
  }

  private serialize(job: JobInternal): Job {
    const { process: _proc, emitter: _em, ...pub } = job;
    return pub;
  }
}

export const jobStore = new JobStore();
