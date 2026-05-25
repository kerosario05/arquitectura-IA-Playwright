export type QueueItemContext = {
  index: number;
  total: number;
  label: string;
};

export type CaseExecutionQueueOptions = {
  concurrency?: number;
  stopOnFailure?: boolean;
  label?: string;
};

export type CaseExecutionQueueItemResult<T> = {
  index: number;
  value?: T;
  error?: Error;
  durationMs: number;
};

export type CaseExecutionQueueResult<T> = {
  items: CaseExecutionQueueItemResult<T>[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  totalDurationMs: number;
};

type InternalQueueItem<TInput, TResult> = {
  input: TInput;
  index: number;
};

function defaultLog(message: string): void {
  console.log(message);
}

export type QueueLogger = {
  log: (message: string) => void;
};

export async function runCaseExecutionQueue<TInput, TResult>(
  items: TInput[],
  worker: (item: TInput, context: QueueItemContext) => Promise<TResult>,
  options?: CaseExecutionQueueOptions,
  logger?: QueueLogger
): Promise<CaseExecutionQueueResult<TResult>> {
  const concurrency = Math.max(1, options?.concurrency ?? 1);
  const stopOnFailure = options?.stopOnFailure ?? false;
  const label = options?.label ?? "queue";
  const log = logger?.log ?? defaultLog;

  const total = items.length;
  const startTime = Date.now();

  log(`[case-queue] Starting queue: ${label}. cases=${total} concurrency=${concurrency}`);

  if (total === 0) {
    return { items: [], total: 0, passed: 0, failed: 0, skipped: 0, totalDurationMs: 0 };
  }

  const queue: InternalQueueItem<TInput, TResult>[] = items.map((input, index) => ({ input, index }));
  const results: CaseExecutionQueueItemResult<TResult>[] = [];
  let shouldStop = false;

  if (concurrency === 1) {
    for (const entry of queue) {
      if (shouldStop) {
        results.push({
          index: entry.index,
          durationMs: 0,
        });
        continue;
      }

      const caseNum = entry.index + 1;
      log(`[case-queue] Starting case ${caseNum}/${total}: index=${entry.index}`);
      const caseStartTime = Date.now();

      try {
        const value = await worker(entry.input, {
          index: entry.index,
          total,
          label,
        });
        const durationMs = Date.now() - caseStartTime;
        results.push({ index: entry.index, value, durationMs });
        log(`[case-queue] Finished case ${caseNum}/${total}: index=${entry.index} status=passed durationMs=${durationMs}`);
      } catch (error) {
        const durationMs = Date.now() - caseStartTime;
        const err = error instanceof Error ? error : new Error(String(error));
        results.push({ index: entry.index, error: err, durationMs });
        log(`[case-queue] Case failed: index=${entry.index} reason=${err.message}`);

        if (stopOnFailure) {
          log(`[case-queue] Stopping queue because stopOnFailure=true`);
          shouldStop = true;
        } else {
          log(`[case-queue] Continuing because stopOnFailure=false`);
        }
      }
    }
  } else {
    let runningCount = 0;

    while (queue.length > 0 || runningCount > 0) {
      const batch: Promise<CaseExecutionQueueItemResult<TResult>>[] = [];

      while (batch.length < concurrency && queue.length > 0 && !shouldStop) {
        const entry = queue.shift()!;
        runningCount += 1;
        const caseNum = entry.index + 1;
        log(`[case-queue] Starting case ${caseNum}/${total}: index=${entry.index}`);
        const caseStartTime = Date.now();

        batch.push(
          worker(entry.input, {
            index: entry.index,
            total,
            label,
          })
            .then((value) => {
              const durationMs = Date.now() - caseStartTime;
              log(`[case-queue] Finished case ${caseNum}/${total}: index=${entry.index} status=passed durationMs=${durationMs}`);
              return { index: entry.index, value, durationMs };
            })
            .catch((error) => {
              const durationMs = Date.now() - caseStartTime;
              const err = error instanceof Error ? error : new Error(String(error));
              log(`[case-queue] Case failed: index=${entry.index} reason=${err.message}`);

              if (stopOnFailure) {
                log(`[case-queue] Stopping queue because stopOnFailure=true`);
                shouldStop = true;
              } else {
                log(`[case-queue] Continuing because stopOnFailure=false`);
              }
              return { index: entry.index, error: err, durationMs };
            })
            .finally(() => {
              runningCount -= 1;
            })
        );
      }

      if (batch.length > 0) {
        const settled = await Promise.allSettled(batch);
        for (const s of settled) {
          if (s.status === "fulfilled") {
            results.push(s.value);
          }
        }
      } else if (runningCount > 0) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  results.sort((a, b) => a.index - b.index);

  const passed = results.filter((r) => r.value !== undefined).length;
  const failed = results.filter((r) => r.error !== undefined).length;
  const skipped = results.filter((r) => r.value === undefined && r.error === undefined).length;
  const totalDurationMs = Date.now() - startTime;

  log(`[case-queue] Queue completed. total=${total} executionPassed=${passed} executionFailed=${failed} executionSkipped=${skipped}`);

  return {
    items: results,
    total,
    passed,
    failed,
    skipped,
    totalDurationMs,
  };
}
