/** Reporting failure must not cancel unrelated scheduled cases. */
export async function reportCaseFailureSafely(
  report: () => Promise<void>,
  onError: (error: unknown) => void,
  updateProgress: () => void,
): Promise<void> {
  try {
    await report();
  } catch (error) {
    onError(error);
  } finally {
    updateProgress();
  }
}

/** A failure anywhere in one scheduled case must not abort later cases. */
export async function runScheduledCaseSafely(
  run: () => Promise<void>,
  onError: (error: unknown) => void,
): Promise<void> {
  try {
    await run();
  } catch (error) {
    try {
      onError(error);
    } catch {
      // Keep the queue alive even when failure bookkeeping also fails.
    }
  }
}
