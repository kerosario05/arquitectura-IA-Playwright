/**
 * Waits for recorder ingestion to go quiet before a recording is finalized.
 *
 * FIRST_LOSS fix (recording 3db40782): `stop()` awaited the ingestion queue only as it was when
 * Stop was pressed. Browser messages still in flight chained a NEW tail that was never awaited,
 * ran after `stopped = true` and were silently dropped -- the "Atrás" click and the final
 * "Generar Turno" never reached the trace. The wait also had no bound, so a hung capture kept
 * the Stop request open indefinitely.
 *
 * Quiet means: the queue tail settled, nothing is pending, and no new work arrived during a short
 * settle window (a binding call that had already left the browser gets the chance to land).
 */
export type IngestionDrainSource = {
  /** Current tail of the serialized ingestion queue; re-read on every loop (it is replaced as work is chained). */
  tail(): Promise<unknown>;
  /** Work accepted but not yet applied (queued or in flight). */
  pending(): number;
  /**
   * Monotonic count of work ever accepted. "Nothing new arrived" is judged by this counter, never
   * by promise identity: a tail built per call (e.g. `Promise.all([...])`) is a new object every
   * time, which made every Stop wait out the whole budget (found by the remote-recording check).
   */
  generation(): number;
};

export type IngestionDrainResult = {
  drained: boolean;
  /** Work still pending when the budget ran out (0 when drained). */
  pendingAtDeadline: number;
  waitedMs: number;
  /** Times new work arrived while draining (evidence the extra rounds mattered). */
  extraRounds: number;
};

export type IngestionDrainOptions = {
  timeoutMs: number;
  settleMs: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function drainIngestionUntilQuiet(
  source: IngestionDrainSource,
  options: IngestionDrainOptions,
): Promise<IngestionDrainResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const startedAt = now();
  const deadline = startedAt + Math.max(0, options.timeoutMs);
  let extraRounds = 0;

  for (;;) {
    const tail = source.tail();
    const generation = source.generation();
    const remaining = deadline - now();
    if (remaining <= 0) break;
    const settled = await Promise.race([
      tail.then(() => true, () => true),
      sleep(remaining).then(() => false),
    ]);
    if (!settled) break;

    await sleep(Math.min(options.settleMs, Math.max(0, deadline - now())));
    if (source.generation() === generation && source.pending() === 0) {
      return { drained: true, pendingAtDeadline: 0, waitedMs: now() - startedAt, extraRounds };
    }
    extraRounds += 1;
  }

  return { drained: false, pendingAtDeadline: source.pending(), waitedMs: now() - startedAt, extraRounds };
}
