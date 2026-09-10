import { randomUUID } from "crypto";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";

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
};

export type Job = {
  id: string;
  type: "sprint" | "discovery-batch" | "scenario-preview" | "mobile-emulator-boot" | "mobile-test-run" | "mobile-launch-execution";
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

class JobStore {
  private readonly jobs = new Map<string, JobInternal>();

  create(type: "sprint" | "discovery-batch" | "scenario-preview" | "mobile-emulator-boot" | "mobile-test-run" | "mobile-launch-execution", params: Record<string, unknown>): Job {
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
    return this.serialize(job);
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
    job.emitter.emit("update", this.serialize(job));
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
