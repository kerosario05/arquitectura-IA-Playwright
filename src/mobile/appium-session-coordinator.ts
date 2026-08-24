import { resolveSessionCreateTimeoutMs } from "./appium-session";

export type SessionFactoryFn = () => Promise<WebdriverIO.Browser>;

export type SessionDeleteFn = (opts: {
  appiumHost: string;
  appiumPort: number;
  sessionId: string;
  timeoutMs?: number;
}) => Promise<{ deleted: boolean; error?: string }>;

type SessionAttemptOutcome =
  | { kind: "success"; browser: WebdriverIO.Browser }
  | { kind: "error"; error: Error }
  | { kind: "timeout_unknown" };

export type SessionRequestState =
  | "creating"
  | "timed_out_unknown"
  | "resolved_success"
  | "resolved_error"
  | "cleanup_pending"
  | "cleanup_confirmed"
  | "cleanup_failed"
  | "released"
  | "blocked_unknown";

export type SessionCleanupStatus =
  | "not_started"
  | "none_required"
  | "pending"
  | "confirmed"
  | "failed";

export type SessionLockEntry = {
  runId: string;
  lockOwner: string;
  lockKey: string;
  sessionCreateRequestId: string;
  appiumEndpoint: string;
  deviceId: string;
  systemPort: number;
  startedAt: number;
  timeoutAt: number;
  requestState: SessionRequestState;
  sessionId?: string;
  cleanupStatus: SessionCleanupStatus;
  emulatorStartedByRunner?: boolean;
  inflightPromise: Promise<SessionAttemptOutcome>;
};

const locks = new Map<string, SessionLockEntry>();
const activePostByKey = new Map<string, number>();
const maxPostByKey = new Map<string, number>();

let deleteSessionFn: SessionDeleteFn = defaultDeleteSession;
let nowFn: () => number = () => Date.now();

export function resolveReconciliationWindowMs(): number {
  const raw = process.env.APPIUM_SESSION_RECONCILIATION_WINDOW_MS;
  if (!raw?.trim()) return 8000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return 8000;
  if (n < 1000) return 1000;
  if (n > 30000) return 30000;
  return n;
}

export function resolveSessionCreateRetryBackoffMs(): number {
  const raw = process.env.APPIUM_SESSION_RETRY_BACKOFF_MS;
  if (!raw?.trim()) return 1250;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return 1250;
  if (n < 250) return 250;
  if (n > 10000) return 10000;
  return n;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildLockKey(appiumHost: string, appiumPort: number, deviceId: string, systemPort: number): string {
  return `${appiumHost}:${appiumPort}|${deviceId}|${systemPort}`;
}

function sanitizeReason(value: string): string {
  return value.replace(/[^\x20-\x7E]/g, "").slice(0, 300);
}

function nextRequestId(lockOwner: string): string {
  return `${lockOwner}-${nowFn()}-${Math.random().toString(36).slice(2, 8)}`;
}

function incConcurrent(key: string): void {
  const next = (activePostByKey.get(key) ?? 0) + 1;
  activePostByKey.set(key, next);
  const currentMax = maxPostByKey.get(key) ?? 0;
  if (next > currentMax) maxPostByKey.set(key, next);
}

function decConcurrent(key: string): void {
  const current = activePostByKey.get(key) ?? 0;
  if (current <= 1) {
    activePostByKey.delete(key);
    return;
  }
  activePostByKey.set(key, current - 1);
}

async function defaultDeleteSession(opts: {
  appiumHost: string;
  appiumPort: number;
  sessionId: string;
  timeoutMs?: number;
}): Promise<{ deleted: boolean; error?: string }> {
  const url = `http://${opts.appiumHost}:${opts.appiumPort}/session/${encodeURIComponent(opts.sessionId)}`;
  try {
    const controller = new AbortController();
    const timeout = opts.timeoutMs && opts.timeoutMs > 0
      ? setTimeout(() => controller.abort(), opts.timeoutMs)
      : undefined;
    const res = await fetch(url, { method: "DELETE", signal: controller.signal });
    if (timeout) clearTimeout(timeout);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { deleted: false, error: `DELETE /session HTTP ${res.status}: ${body.slice(0, 200)}` };
    }
    return { deleted: true };
  } catch (err) {
    return { deleted: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type AcquireSessionOptions = {
  runId: string;
  lockOwner: string;
  appiumHost: string;
  appiumPort: number;
  deviceId: string;
  systemPort: number;
  factory: SessionFactoryFn;
  onLog?: (line: string) => void;
  emulatorStartedByRunner?: boolean;
  canRetry?: () => Promise<{ allowed: boolean; reason?: string }>;
  timeoutMsOverride?: number;
  reconciliationWindowMsOverride?: number;
  retryBackoffMsOverride?: number;
};

export type AcquireSessionResult = {
  browser: WebdriverIO.Browser;
  lockKey: string;
  sessionId?: string;
};

export async function acquireSession(opts: AcquireSessionOptions): Promise<AcquireSessionResult> {
  const log = (line: string) => opts.onLog?.(`[session-coordinator] ${line}`);
  const lockKey = buildLockKey(opts.appiumHost, opts.appiumPort, opts.deviceId, opts.systemPort);
  const existing = locks.get(lockKey);
  if (existing && existing.requestState !== "released") {
    throw new Error(
      `mobile_session_state_unknown: lock already held lockKey=${lockKey} lockOwner=${existing.lockOwner} requestState=${existing.requestState}`,
    );
  }

  const sessionCreateTimeoutMs = Number.isInteger(opts.timeoutMsOverride) && Number(opts.timeoutMsOverride) > 0
    ? Number(opts.timeoutMsOverride)
    : resolveSessionCreateTimeoutMs();
  const baseEntry: SessionLockEntry = {
    runId: opts.runId,
    lockOwner: opts.lockOwner,
    lockKey,
    sessionCreateRequestId: nextRequestId(opts.lockOwner),
    appiumEndpoint: `${opts.appiumHost}:${opts.appiumPort}`,
    deviceId: opts.deviceId,
    systemPort: opts.systemPort,
    startedAt: nowFn(),
    timeoutAt: nowFn() + sessionCreateTimeoutMs,
    requestState: "creating",
    cleanupStatus: "not_started",
    emulatorStartedByRunner: opts.emulatorStartedByRunner,
    inflightPromise: Promise.resolve({ kind: "timeout_unknown" }),
  };
  locks.set(lockKey, baseEntry);
  log(
    `status=started runId=${opts.runId} lockOwner=${opts.lockOwner} sessionCreateRequestId=${baseEntry.sessionCreateRequestId} deviceId=${opts.deviceId} systemPort=${opts.systemPort} startedAt=${new Date(baseEntry.startedAt).toISOString()} timeoutAt=${new Date(baseEntry.timeoutAt).toISOString()} emulatorStartedByRunner=${opts.emulatorStartedByRunner === true}`,
  );

  const first = await runAttempt(baseEntry, opts, 1, sessionCreateTimeoutMs, log);
  if (first.kind === "success") {
    baseEntry.requestState = "resolved_success";
    baseEntry.sessionId = first.sessionId;
    log(`status=resolved sessionId=${first.sessionId ?? "unknown"} attempt=1`);
    return { browser: first.browser, lockKey, sessionId: first.sessionId };
  }
  if (first.kind === "timeout_unknown") {
    baseEntry.requestState = "blocked_unknown";
    throw new Error(
      `mobile_session_state_unknown: sessionCreateRequestId=${baseEntry.sessionCreateRequestId} deviceId=${opts.deviceId} systemPort=${opts.systemPort} requestState=timed_out_unknown`,
    );
  }

  const retryGate = await evaluateRetryGate(baseEntry, opts, log);
  if (!retryGate.allowed) {
    baseEntry.requestState = "blocked_unknown";
    throw new Error(
      `mobile_session_state_unknown: retry_not_allowed reason=${sanitizeReason(retryGate.reason ?? "unknown")}`,
    );
  }

  const backoffMs = Number.isInteger(opts.retryBackoffMsOverride) && Number(opts.retryBackoffMsOverride) >= 0
    ? Number(opts.retryBackoffMsOverride)
    : resolveSessionCreateRetryBackoffMs();
  log(`status=retry_wait backoffMs=${backoffMs} reason=${retryGate.reason ?? "allowed"}`);
  await wait(backoffMs);

  const second = await runAttempt(baseEntry, opts, 2, sessionCreateTimeoutMs, log);
  if (second.kind === "success") {
    baseEntry.requestState = "resolved_success";
    baseEntry.sessionId = second.sessionId;
    log(`status=resolved sessionId=${second.sessionId ?? "unknown"} attempt=2`);
    return { browser: second.browser, lockKey, sessionId: second.sessionId };
  }
  if (second.kind === "timeout_unknown") {
    baseEntry.requestState = "blocked_unknown";
    throw new Error(
      `mobile_session_state_unknown: sessionCreateRequestId=${baseEntry.sessionCreateRequestId} deviceId=${opts.deviceId} systemPort=${opts.systemPort} requestState=timed_out_unknown attempt=2`,
    );
  }

  baseEntry.requestState = "resolved_error";
  throw second.error;
}

type AttemptResult =
  | { kind: "success"; browser: WebdriverIO.Browser; sessionId?: string }
  | { kind: "error"; error: Error }
  | { kind: "timeout_unknown" };

async function runAttempt(
  entry: SessionLockEntry,
  opts: AcquireSessionOptions,
  attempt: 1 | 2,
  timeoutMs: number,
  log: (line: string) => void,
): Promise<AttemptResult> {
  const requestId = nextRequestId(opts.lockOwner);
  entry.sessionCreateRequestId = requestId;
  entry.startedAt = nowFn();
  entry.timeoutAt = nowFn() + timeoutMs;
  entry.requestState = "creating";
  entry.cleanupStatus = "not_started";

  const inflight = (async (): Promise<SessionAttemptOutcome> => {
    incConcurrent(entry.lockKey);
    try {
      const browser = await opts.factory();
      return { kind: "success", browser };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return { kind: "error", error };
    } finally {
      decConcurrent(entry.lockKey);
    }
  })();
  entry.inflightPromise = inflight;

  log(
    `status=creating attempt=${attempt} runId=${opts.runId} lockOwner=${opts.lockOwner} sessionCreateRequestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort}`,
  );

  const timeoutRace = new Promise<SessionAttemptOutcome>((resolve) => {
    setTimeout(() => resolve({ kind: "timeout_unknown" }), timeoutMs);
  });

  const immediate = await Promise.race([inflight, timeoutRace]);
  if (immediate.kind === "success") {
    const sessionId = extractSessionId(immediate.browser);
    entry.sessionId = sessionId;
    entry.requestState = "resolved_success";
    return { kind: "success", browser: immediate.browser, sessionId };
  }
  if (immediate.kind === "error") {
    entry.sessionId = extractSessionIdFromError(immediate.error.message) ?? entry.sessionId;
    entry.requestState = "resolved_error";
    return { kind: "error", error: immediate.error };
  }

  entry.requestState = "timed_out_unknown";
  log(
    `status=timed_out_unknown attempt=${attempt} sessionCreateRequestId=${requestId} timeoutMs=${timeoutMs} awaitingReconciliation=true`,
  );

  const reconMs = resolveReconciliationWindowMs();
  const effectiveReconMs = Number.isInteger(opts.reconciliationWindowMsOverride) && Number(opts.reconciliationWindowMsOverride) > 0
    ? Number(opts.reconciliationWindowMsOverride)
    : reconMs;
  const reconciliationRace = new Promise<SessionAttemptOutcome>((resolve) => {
    setTimeout(() => resolve({ kind: "timeout_unknown" }), effectiveReconMs);
  });
  const late = await Promise.race([inflight, reconciliationRace]);

  if (late.kind === "success") {
    const sessionId = extractSessionId(late.browser);
    entry.sessionId = sessionId;
    entry.requestState = "resolved_success";
    log(`status=recovered_late_session attempt=${attempt} sessionId=${sessionId ?? "unknown"}`);
    return { kind: "success", browser: late.browser, sessionId };
  }
  if (late.kind === "error") {
    entry.sessionId = extractSessionIdFromError(late.error.message) ?? entry.sessionId;
    entry.requestState = "resolved_error";
    log(`status=resolved_error_after_timeout attempt=${attempt} error=${sanitizeReason(late.error.message)}`);
    return { kind: "error", error: late.error };
  }

  log(`status=failed matches=0 reason=timed_out_unknown attempt=${attempt}`);
  installLateSessionObserver({ entry, opts, requestId, attempt, inflight, log });
  return { kind: "timeout_unknown" };
}

function installLateSessionObserver(params: {
  entry: SessionLockEntry;
  opts: AcquireSessionOptions;
  requestId: string;
  attempt: 1 | 2;
  inflight: Promise<SessionAttemptOutcome>;
  log: (line: string) => void;
}): void {
  const { entry, opts, requestId, attempt, inflight, log } = params;
  void inflight.then(
    (outcome) => {
      if (outcome.kind === "error") {
        const name = outcome.error.name ?? "Error";
        log(
          `status=late_outcome attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} lateOutcome=error error.name=${name} error.message=${sanitizeReason(outcome.error.message)}`,
        );
        return;
      }
      if (outcome.kind === "success") {
        const sessionId = extractSessionId(outcome.browser);
        if (!sessionId) {
          log(
            `status=late_outcome attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} lateOutcome=session_created cleanup=skipped sessionId=missing`,
          );
          return;
        }
        log(
          `status=late_outcome attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} lateOutcome=session_created cleanup=attempted sessionId=${sessionId}`,
        );
        void deleteSessionFn({
          appiumHost: opts.appiumHost,
          appiumPort: opts.appiumPort,
          sessionId,
          timeoutMs: 6000,
        })
          .then((del) => {
            log(
              `status=late_cleanup attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} cleanupResult=${del.deleted ? "success" : "failed"}${del.error ? ` error=${sanitizeReason(del.error)}` : ""}`,
            );
          })
          .catch((err) => {
            log(
              `status=late_cleanup attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} cleanupResult=failed error=${sanitizeReason(err instanceof Error ? err.message : String(err))}`,
            );
          });
      }
    },
    () => {
      // inflight captures its own errors and always resolves; this rejection
      // handler only guards against unexpected rejects to avoid unhandled rejections.
    },
  );
}

async function evaluateRetryGate(
  entry: SessionLockEntry,
  opts: AcquireSessionOptions,
  log: (line: string) => void,
): Promise<{ allowed: boolean; reason?: string }> {
  if (entry.requestState === "timed_out_unknown" || entry.requestState === "blocked_unknown") {
    return { allowed: false, reason: "request_state_unknown" };
  }
  if (entry.sessionId) {
    entry.cleanupStatus = "pending";
    entry.requestState = "cleanup_pending";
    log(`status=cleanup_pending sessionId=${entry.sessionId}`);
    const del = await deleteSessionFn({
      appiumHost: opts.appiumHost,
      appiumPort: opts.appiumPort,
      sessionId: entry.sessionId,
      timeoutMs: 6000,
    });
    if (!del.deleted) {
      entry.cleanupStatus = "failed";
      entry.requestState = "cleanup_failed";
      log(`status=cleanup_failed sessionId=${entry.sessionId} reason=${sanitizeReason(del.error ?? "unknown")}`);
      return { allowed: false, reason: `cleanup_failed:${sanitizeReason(del.error ?? "unknown")}` };
    }
    entry.cleanupStatus = "confirmed";
    entry.requestState = "cleanup_confirmed";
    log(`status=cleanup_confirmed sessionId=${entry.sessionId}`);
  } else {
    entry.cleanupStatus = "none_required";
  }
  if (opts.canRetry) {
    const check = await opts.canRetry();
    if (!check.allowed) return { allowed: false, reason: check.reason ?? "health_check_failed" };
  }
  return { allowed: true, reason: "terminal_failure_and_cleanup_confirmed" };
}

export function releaseSessionLock(params: {
  lockKey: string;
  lockOwner: string;
  runId: string;
  onLog?: (line: string) => void;
}): void {
  const log = (line: string) => params.onLog?.(`[session-coordinator] ${line}`);
  const entry = locks.get(params.lockKey);
  if (!entry) return;
  if (entry.lockOwner !== params.lockOwner || entry.runId !== params.runId) {
    log(
      `release_skipped reason=ownership_mismatch lockOwner=${params.lockOwner} storedOwner=${entry.lockOwner} runId=${params.runId} storedRunId=${entry.runId}`,
    );
    return;
  }
  entry.requestState = "released";
  locks.delete(params.lockKey);
  log(`status=released lockKey=${params.lockKey}`);
}

function extractSessionId(browser: WebdriverIO.Browser): string | undefined {
  const candidate = browser as unknown as { sessionId?: string; options?: { sessionId?: string } };
  return candidate.sessionId || candidate.options?.sessionId || undefined;
}

function extractSessionIdFromError(message: string): string | undefined {
  const fromNamed = message.match(/session(?:id)?[=:"\s]+([A-Za-z0-9-]{6,})/i)?.[1];
  if (fromNamed) return fromNamed;
  const generic = message.match(/\b([a-f0-9]{8}-[a-f0-9-]{8,})\b/i)?.[1];
  return generic;
}

export function __resetCoordinatorForTesting(): void {
  locks.clear();
  activePostByKey.clear();
  maxPostByKey.clear();
  deleteSessionFn = defaultDeleteSession;
  nowFn = () => Date.now();
}

export function __setDeleteSessionFnForTesting(fn: SessionDeleteFn): void {
  deleteSessionFn = fn;
}

export function __setNowForTesting(fn: () => number): void {
  nowFn = fn;
}

export function __getCoordinatorLockForTesting(lockKey: string): SessionLockEntry | undefined {
  return locks.get(lockKey);
}

export function __getCoordinatorStatsForTesting(): {
  activePostByKey: Record<string, number>;
  maxPostByKey: Record<string, number>;
} {
  return {
    activePostByKey: Object.fromEntries(activePostByKey.entries()),
    maxPostByKey: Object.fromEntries(maxPostByKey.entries()),
  };
}
