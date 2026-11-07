import type { Page } from "playwright";

export type PostFillSettleResult = { requestsStarted: number; settled: boolean; waitedMs: number };

/**
 * Forms often compute dependent fields (rates, totals, lookups) from a request that starts a
 * moment AFTER the field loses focus. A next click that lands before those requests finish is
 * silently rejected by the app. This waits, without any app/field/URL knowledge, for requests
 * triggered by the blur: up to `startWindowMs` for the first one to start, then until the
 * in-flight set drains (bounded by `endTimeoutMs`). No request started in the window = no wait.
 */
export async function settleDependentRequestsAfterFill(
  page: Page,
  options: { startWindowMs?: number; endTimeoutMs?: number; quietMs?: number } = {},
): Promise<PostFillSettleResult> {
  const startWindowMs = options.startWindowMs ?? 1500;
  const endTimeoutMs = options.endTimeoutMs ?? 8000;
  const quietMs = options.quietMs ?? 300;
  const began = Date.now();
  const inFlight = new Set<unknown>();
  let started = 0;
  let lastActivity = Date.now();
  const isData = (request: { resourceType(): string }) => ["fetch", "xhr"].includes(request.resourceType());
  const onRequest = (request: { resourceType(): string }) => {
    if (!isData(request)) return;
    inFlight.add(request);
    started += 1;
    lastActivity = Date.now();
  };
  const onDone = (request: { resourceType(): string }) => {
    if (inFlight.delete(request)) lastActivity = Date.now();
  };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  try {
    while (Date.now() - began < startWindowMs && started === 0) {
      await page.waitForTimeout(50).catch(() => undefined);
    }
    if (started === 0) return { requestsStarted: 0, settled: true, waitedMs: Date.now() - began };
    while (Date.now() - began < startWindowMs + endTimeoutMs) {
      if (inFlight.size === 0 && Date.now() - lastActivity >= quietMs) {
        return { requestsStarted: started, settled: true, waitedMs: Date.now() - began };
      }
      await page.waitForTimeout(50).catch(() => undefined);
    }
    return { requestsStarted: started, settled: false, waitedMs: Date.now() - began };
  } finally {
    page.off("request", onRequest);
    page.off("requestfinished", onDone);
    page.off("requestfailed", onDone);
  }
}
