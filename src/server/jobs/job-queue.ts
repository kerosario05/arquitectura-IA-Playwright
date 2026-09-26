import { jobStore } from "./job-store";

/**
 * Admission control for work that costs real machine resources.
 *
 * Every execution spawns a browser (or an emulator), and each one peaks around
 * 1–1.5 GB. Without a limit, five people launching at once take the server down
 * for all five. The queue turns that into a wait for the fourth person instead.
 *
 * Batch work and interactive work are deliberately treated differently:
 *
 *  - **Batch** (discovery, sprint, previews, replays) waits its turn. Nobody is
 *    watching, and the job already shows up as `queued` — a status the UI
 *    renders today, so waiting needs no new concept.
 *  - **Recording** is a person about to drive a browser by hand. Making them
 *    stare at a screen where nothing happens is worse than telling them to come
 *    back: the route asks `hasCapacity` first and refuses outright.
 */

export type SlotKind = "execution" | "recording" | "emulator";

function readLimit(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 64) return fallback;
  return parsed;
}

/** Sized for a 16 GB server: ~3 GB for Windows/IIS, ~1 GB for Node, the rest for browsers. */
export function limitFor(kind: SlotKind): number {
  switch (kind) {
    case "execution":
      return readLimit("MAX_CONCURRENT_EXECUTIONS", 3);
    case "recording":
      return readLimit("MAX_CONCURRENT_RECORDINGS", 2);
    case "emulator":
      return readLimit("MAX_CONCURRENT_EMULATORS", 1);
  }
}

type Waiting = {
  jobId: string;
  kind: SlotKind;
  work: () => void | Promise<void>;
  enqueuedAt: number;
};

class JobQueue {
  private readonly running = new Map<SlotKind, number>();
  private readonly waiting: Waiting[] = [];

  private count(kind: SlotKind): number {
    return this.running.get(kind) ?? 0;
  }

  /** Whether a slot of this kind is free right now. */
  hasCapacity(kind: SlotKind): boolean {
    return this.count(kind) < limitFor(kind);
  }

  /**
   * Runs `work` as soon as a slot frees. Until then the job stays `queued`.
   *
   * Replaces the bare `setImmediate(() => startXJob(id))` the runners used, so
   * the only behavioural change is *when* the work starts, never whether it does.
   */
  schedule(jobId: string, kind: SlotKind, work: () => void | Promise<void>): void {
    this.waiting.push({ jobId, kind, work, enqueuedAt: Date.now() });
    this.pump();
  }

  private pump(): void {
    for (let i = 0; i < this.waiting.length; i++) {
      const entry = this.waiting[i];
      if (!this.hasCapacity(entry.kind)) continue;

      this.waiting.splice(i, 1);
      i--;

      // A job cancelled or deleted while waiting must not start late.
      const job = jobStore.get(entry.jobId);
      if (!job || (job.status !== "queued" && job.status !== "running")) continue;

      const waitedMs = Date.now() - entry.enqueuedAt;
      if (waitedMs > 1000) {
        jobStore.appendLog(
          entry.jobId,
          `[cola] arranca tras esperar ${Math.round(waitedMs / 1000)}s por un espacio libre`,
        );
      }

      this.running.set(entry.kind, this.count(entry.kind) + 1);
      void this.runAndRelease(entry);
    }
  }

  private async runAndRelease(entry: Waiting): Promise<void> {
    try {
      await entry.work();
    } catch (err) {
      console.error(
        `[job-queue] el trabajo ${entry.jobId} lanzó una excepción:`,
        err instanceof Error ? err.message : err,
      );
      // The runners report their own failures; this only guards the slot.
      jobStore.update(entry.jobId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.running.set(entry.kind, Math.max(0, this.count(entry.kind) - 1));
      // Freeing a slot is what lets the next one in.
      this.pump();
    }
  }

  /** Position in line, 1-based. Zero means it is not waiting. */
  positionOf(jobId: string): number {
    const index = this.waiting.findIndex((entry) => entry.jobId === jobId);
    return index === -1 ? 0 : index + 1;
  }

  /** Drops a waiting job so a cancellation takes effect before it ever starts. */
  cancel(jobId: string): boolean {
    const index = this.waiting.findIndex((entry) => entry.jobId === jobId);
    if (index === -1) return false;
    this.waiting.splice(index, 1);
    return true;
  }

  stats(): {
    limits: Record<SlotKind, number>;
    running: Record<SlotKind, number>;
    queued: number;
  } {
    return {
      limits: {
        execution: limitFor("execution"),
        recording: limitFor("recording"),
        emulator: limitFor("emulator"),
      },
      running: {
        execution: this.count("execution"),
        recording: this.count("recording"),
        emulator: this.count("emulator"),
      },
      queued: this.waiting.length,
    };
  }
}

export const jobQueue = new JobQueue();
