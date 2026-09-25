"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveReconciliationWindowMs = resolveReconciliationWindowMs;
exports.resolveSessionCreateRetryBackoffMs = resolveSessionCreateRetryBackoffMs;
exports.buildLockKey = buildLockKey;
exports.acquireSession = acquireSession;
exports.releaseSessionLock = releaseSessionLock;
exports.__resetCoordinatorForTesting = __resetCoordinatorForTesting;
exports.__setDeleteSessionFnForTesting = __setDeleteSessionFnForTesting;
exports.__setNowForTesting = __setNowForTesting;
exports.__getCoordinatorLockForTesting = __getCoordinatorLockForTesting;
exports.__getCoordinatorStatsForTesting = __getCoordinatorStatsForTesting;
const appium_session_1 = require("./appium-session");
const locks = new Map();
const activePostByKey = new Map();
const maxPostByKey = new Map();
let deleteSessionFn = defaultDeleteSession;
let nowFn = () => Date.now();
function resolveReconciliationWindowMs() {
    const raw = process.env.APPIUM_SESSION_RECONCILIATION_WINDOW_MS;
    if (!raw?.trim())
        return 8000;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
        return 8000;
    if (n < 1000)
        return 1000;
    if (n > 30000)
        return 30000;
    return n;
}
function resolveSessionCreateRetryBackoffMs() {
    const raw = process.env.APPIUM_SESSION_RETRY_BACKOFF_MS;
    if (!raw?.trim())
        return 1250;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n))
        return 1250;
    if (n < 250)
        return 250;
    if (n > 10000)
        return 10000;
    return n;
}
function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
/** Exported so callers can release a lock even when acquireSession() threw before
 *  returning a handle — on error the coordinator marks the entry resolved_error but
 *  leaves it in place, and only the caller can decide the acquisition is over. */
function buildLockKey(appiumHost, appiumPort, deviceId, systemPort) {
    return `${appiumHost}:${appiumPort}|${deviceId}|${systemPort}`;
}
function sanitizeReason(value) {
    return value.replace(/[^\x20-\x7E]/g, "").slice(0, 300);
}
function nextRequestId(lockOwner) {
    return `${lockOwner}-${nowFn()}-${Math.random().toString(36).slice(2, 8)}`;
}
function incConcurrent(key) {
    const next = (activePostByKey.get(key) ?? 0) + 1;
    activePostByKey.set(key, next);
    const currentMax = maxPostByKey.get(key) ?? 0;
    if (next > currentMax)
        maxPostByKey.set(key, next);
}
function decConcurrent(key) {
    const current = activePostByKey.get(key) ?? 0;
    if (current <= 1) {
        activePostByKey.delete(key);
        return;
    }
    activePostByKey.set(key, current - 1);
}
async function defaultDeleteSession(opts) {
    const url = `http://${opts.appiumHost}:${opts.appiumPort}/session/${encodeURIComponent(opts.sessionId)}`;
    try {
        const controller = new AbortController();
        const timeout = opts.timeoutMs && opts.timeoutMs > 0
            ? setTimeout(() => controller.abort(), opts.timeoutMs)
            : undefined;
        const res = await fetch(url, { method: "DELETE", signal: controller.signal });
        if (timeout)
            clearTimeout(timeout);
        if (!res.ok) {
            const body = await res.text().catch(() => "");
            return { deleted: false, error: `DELETE /session HTTP ${res.status}: ${body.slice(0, 200)}` };
        }
        return { deleted: true };
    }
    catch (err) {
        return { deleted: false, error: err instanceof Error ? err.message : String(err) };
    }
}
async function acquireSession(opts) {
    const log = (line) => opts.onLog?.(`[session-coordinator] ${line}`);
    const lockKey = buildLockKey(opts.appiumHost, opts.appiumPort, opts.deviceId, opts.systemPort);
    const existing = locks.get(lockKey);
    if (existing && existing.requestState !== "released") {
        throw new Error(`mobile_session_state_unknown: lock already held lockKey=${lockKey} lockOwner=${existing.lockOwner} requestState=${existing.requestState}`);
    }
    const sessionCreateTimeoutMs = Number.isInteger(opts.timeoutMsOverride) && Number(opts.timeoutMsOverride) > 0
        ? Number(opts.timeoutMsOverride)
        : (0, appium_session_1.resolveSessionCreateTimeoutMs)();
    const baseEntry = {
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
    log(`status=started runId=${opts.runId} lockOwner=${opts.lockOwner} sessionCreateRequestId=${baseEntry.sessionCreateRequestId} deviceId=${opts.deviceId} systemPort=${opts.systemPort} startedAt=${new Date(baseEntry.startedAt).toISOString()} timeoutAt=${new Date(baseEntry.timeoutAt).toISOString()} emulatorStartedByRunner=${opts.emulatorStartedByRunner === true}`);
    const first = await runAttempt(baseEntry, opts, 1, sessionCreateTimeoutMs, log);
    if (first.kind === "success") {
        baseEntry.requestState = "resolved_success";
        baseEntry.sessionId = first.sessionId;
        log(`status=resolved sessionId=${first.sessionId ?? "unknown"} attempt=1`);
        return { browser: first.browser, lockKey, sessionId: first.sessionId };
    }
    if (first.kind === "timeout_unknown") {
        baseEntry.requestState = "blocked_unknown";
        throw new Error(`mobile_session_state_unknown: sessionCreateRequestId=${baseEntry.sessionCreateRequestId} deviceId=${opts.deviceId} systemPort=${opts.systemPort} requestState=timed_out_unknown`);
    }
    const retryGate = await evaluateRetryGate(baseEntry, opts, log);
    if (!retryGate.allowed) {
        baseEntry.requestState = "blocked_unknown";
        throw new Error(`mobile_session_state_unknown: retry_not_allowed reason=${sanitizeReason(retryGate.reason ?? "unknown")}`);
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
        throw new Error(`mobile_session_state_unknown: sessionCreateRequestId=${baseEntry.sessionCreateRequestId} deviceId=${opts.deviceId} systemPort=${opts.systemPort} requestState=timed_out_unknown attempt=2`);
    }
    baseEntry.requestState = "resolved_error";
    throw second.error;
}
async function runAttempt(entry, opts, attempt, timeoutMs, log) {
    const requestId = nextRequestId(opts.lockOwner);
    entry.sessionCreateRequestId = requestId;
    entry.startedAt = nowFn();
    entry.timeoutAt = nowFn() + timeoutMs;
    entry.requestState = "creating";
    entry.cleanupStatus = "not_started";
    const inflight = (async () => {
        incConcurrent(entry.lockKey);
        try {
            const browser = await opts.factory();
            return { kind: "success", browser };
        }
        catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            return { kind: "error", error };
        }
        finally {
            decConcurrent(entry.lockKey);
        }
    })();
    entry.inflightPromise = inflight;
    log(`status=creating attempt=${attempt} runId=${opts.runId} lockOwner=${opts.lockOwner} sessionCreateRequestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort}`);
    const timeoutRace = new Promise((resolve) => {
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
    log(`status=timed_out_unknown attempt=${attempt} sessionCreateRequestId=${requestId} timeoutMs=${timeoutMs} awaitingReconciliation=true`);
    const reconMs = resolveReconciliationWindowMs();
    const effectiveReconMs = Number.isInteger(opts.reconciliationWindowMsOverride) && Number(opts.reconciliationWindowMsOverride) > 0
        ? Number(opts.reconciliationWindowMsOverride)
        : reconMs;
    const reconciliationRace = new Promise((resolve) => {
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
function installLateSessionObserver(params) {
    const { entry, opts, requestId, attempt, inflight, log } = params;
    void inflight.then((outcome) => {
        if (outcome.kind === "error") {
            const name = outcome.error.name ?? "Error";
            log(`status=late_outcome attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} lateOutcome=error error.name=${name} error.message=${sanitizeReason(outcome.error.message)}`);
            return;
        }
        if (outcome.kind === "success") {
            const sessionId = extractSessionId(outcome.browser);
            if (!sessionId) {
                log(`status=late_outcome attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} lateOutcome=session_created cleanup=skipped sessionId=missing`);
                return;
            }
            log(`status=late_outcome attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} lateOutcome=session_created cleanup=attempted sessionId=${sessionId}`);
            void deleteSessionFn({
                appiumHost: opts.appiumHost,
                appiumPort: opts.appiumPort,
                sessionId,
                timeoutMs: 6000,
            })
                .then((del) => {
                log(`status=late_cleanup attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} cleanupResult=${del.deleted ? "success" : "failed"}${del.error ? ` error=${sanitizeReason(del.error)}` : ""}`);
            })
                .catch((err) => {
                log(`status=late_cleanup attempt=${attempt} requestId=${requestId} deviceId=${entry.deviceId} systemPort=${entry.systemPort} cleanupResult=failed error=${sanitizeReason(err instanceof Error ? err.message : String(err))}`);
            });
        }
    }, () => {
        // inflight captures its own errors and always resolves; this rejection
        // handler only guards against unexpected rejects to avoid unhandled rejections.
    });
}
async function evaluateRetryGate(entry, opts, log) {
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
    }
    else {
        entry.cleanupStatus = "none_required";
    }
    if (opts.canRetry) {
        const check = await opts.canRetry();
        if (!check.allowed)
            return { allowed: false, reason: check.reason ?? "health_check_failed" };
    }
    return { allowed: true, reason: "terminal_failure_and_cleanup_confirmed" };
}
function releaseSessionLock(params) {
    const log = (line) => params.onLog?.(`[session-coordinator] ${line}`);
    const entry = locks.get(params.lockKey);
    if (!entry)
        return;
    if (entry.lockOwner !== params.lockOwner || entry.runId !== params.runId) {
        log(`release_skipped reason=ownership_mismatch lockOwner=${params.lockOwner} storedOwner=${entry.lockOwner} runId=${params.runId} storedRunId=${entry.runId}`);
        return;
    }
    entry.requestState = "released";
    locks.delete(params.lockKey);
    log(`status=released lockKey=${params.lockKey}`);
}
function extractSessionId(browser) {
    const candidate = browser;
    return candidate.sessionId || candidate.options?.sessionId || undefined;
}
function extractSessionIdFromError(message) {
    const fromNamed = message.match(/session(?:id)?[=:"\s]+([A-Za-z0-9-]{6,})/i)?.[1];
    if (fromNamed)
        return fromNamed;
    const generic = message.match(/\b([a-f0-9]{8}-[a-f0-9-]{8,})\b/i)?.[1];
    return generic;
}
function __resetCoordinatorForTesting() {
    locks.clear();
    activePostByKey.clear();
    maxPostByKey.clear();
    deleteSessionFn = defaultDeleteSession;
    nowFn = () => Date.now();
}
function __setDeleteSessionFnForTesting(fn) {
    deleteSessionFn = fn;
}
function __setNowForTesting(fn) {
    nowFn = fn;
}
function __getCoordinatorLockForTesting(lockKey) {
    return locks.get(lockKey);
}
function __getCoordinatorStatsForTesting() {
    return {
        activePostByKey: Object.fromEntries(activePostByKey.entries()),
        maxPostByKey: Object.fromEntries(maxPostByKey.entries()),
    };
}
