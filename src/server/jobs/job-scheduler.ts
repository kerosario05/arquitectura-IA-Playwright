import { jobStore } from "./job-store";

type PendingJob = { id: string; start: () => void | Promise<void>; unsubscribe: () => void };
const pending: PendingJob[] = [];
const active = new Set<string>();
const terminal = new Set(["done", "failed", "cancelled", "completed_with_failures", "completed_with_sync_errors"]);

function refreshPositions(): void {
  pending.forEach((entry, index) => jobStore.update(entry.id, { queuePosition: index + 1 }));
}

function concurrency(): number {
  const configured = Number(process.env.QA_LAB_MAX_CONCURRENT_JOBS ?? 4);
  return Number.isSafeInteger(configured) && configured > 0 ? configured : 4;
}

function drain(): void {
  while (pending.length && active.size < concurrency()) {
    const entry = pending.shift()!;
    const job = jobStore.getInternal(entry.id);
    if (!job || terminal.has(job.status) || job.cancellationRequested) {
      entry.unsubscribe();
      continue;
    }
    active.add(entry.id);
    const waitMs = Date.now() - new Date(job.createdAt).getTime();
    jobStore.update(entry.id, { status: "running", queuePosition: undefined, startedAt: new Date().toISOString() });
    refreshPositions();
    jobStore.appendLog(entry.id, `[job-queue] started waitMs=${Math.max(0, waitMs)} active=${active.size} limit=${concurrency()}`);
    setImmediate(() => {
      const current = jobStore.getInternal(entry.id);
      if (!current || current.cancellationRequested || terminal.has(current.status)) return;
      Promise.resolve().then(entry.start).catch((error: unknown) => {
        jobStore.appendLog(entry.id, `[job-queue] start failed: ${error instanceof Error ? error.message : String(error)}`);
        jobStore.update(entry.id, { status: "failed", completedAt: new Date().toISOString(), errorMessage: "No se pudo iniciar la ejecución" });
      });
    });
  }
}

/** Schedule a public job; its terminal state releases the slot even if its runner returns early. */
export function scheduleJob(id: string, start: () => void | Promise<void>): void {
  if (active.has(id) || pending.some((entry) => entry.id === id)) return;
  const job = jobStore.getInternal(id);
  if (!job || terminal.has(job.status)) return;
  const unsubscribe = jobStore.subscribe(id, {
    onLog: () => {},
    onUpdate: (updated) => {
      if (!terminal.has(updated.status)) return;
      const index = pending.findIndex((entry) => entry.id === id);
      if (index >= 0) pending.splice(index, 1);
      active.delete(id);
      unsubscribe();
      refreshPositions();
      drain();
    },
  });
  pending.push({ id, start, unsubscribe });
  refreshPositions();
  jobStore.appendLog(id, `[job-queue] queued position=${pending.length} active=${active.size} limit=${concurrency()}`);
  drain();
}
