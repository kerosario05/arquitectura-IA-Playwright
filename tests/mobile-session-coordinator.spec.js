"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test_1 = require("@playwright/test");
const appium_session_coordinator_1 = require("../src/mobile/appium-session-coordinator");
const appium_session_1 = require("../src/mobile/appium-session");
const job_store_1 = require("../src/server/jobs/job-store");
const mobile_launch_execution_runner_1 = require("../src/server/jobs/mobile-launch-execution-runner");
function fakeBrowser(sessionId = "session-1") {
    return { sessionId, deleteSession: async () => undefined };
}
function key(host, port, deviceId, systemPort) {
    return `${host}:${port}|${deviceId}|${systemPort}`;
}
test_1.test.afterEach(() => {
    (0, appium_session_coordinator_1.__resetCoordinatorForTesting)();
    delete process.env.APPIUM_SESSION_CREATE_TIMEOUT_MS;
    delete process.env.APPIUM_SESSION_RECONCILIATION_WINDOW_MS;
    delete process.env.APPIUM_SESSION_RETRY_BACKOFF_MS;
    delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
});
test_1.test.describe("session coordinator configuration + classifier", () => {
    (0, test_1.test)("timeout/reconciliation/retry-backoff bounds", () => {
        (0, test_1.expect)((0, appium_session_1.resolveSessionCreateTimeoutMs)()).toBe(90000);
        (0, test_1.expect)((0, appium_session_coordinator_1.resolveReconciliationWindowMs)()).toBe(8000);
        (0, test_1.expect)((0, appium_session_coordinator_1.resolveSessionCreateRetryBackoffMs)()).toBe(1250);
        process.env.APPIUM_SESSION_CREATE_TIMEOUT_MS = "1";
        process.env.APPIUM_SESSION_RECONCILIATION_WINDOW_MS = "999999";
        process.env.APPIUM_SESSION_RETRY_BACKOFF_MS = "100";
        (0, test_1.expect)((0, appium_session_1.resolveSessionCreateTimeoutMs)()).toBe(15000);
        (0, test_1.expect)((0, appium_session_coordinator_1.resolveReconciliationWindowMs)()).toBe(30000);
        (0, test_1.expect)((0, appium_session_coordinator_1.resolveSessionCreateRetryBackoffMs)()).toBe(250);
    });
    (0, test_1.test)("mobile_session_state_unknown is non-recoverable", () => {
        const c = (0, appium_session_1.classifyMobileSessionFailure)("mobile_session_state_unknown: request timed_out_unknown");
        (0, test_1.expect)(c.reasonCode).toBe("mobile_session_state_unknown");
        (0, test_1.expect)(c.recoverable).toBe(false);
    });
});
(0, test_1.test)("POST /session late response is reconciled and reused (no second POST)", async () => {
    let calls = 0;
    const factory = () => new Promise((resolve) => {
        calls++;
        setTimeout(() => resolve(fakeBrowser("late-session-1")), 40);
    });
    const acquired = await (0, appium_session_coordinator_1.acquireSession)({
        runId: "run-late-1",
        lockOwner: "run-late-1:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emulator-5554",
        systemPort: 8200,
        factory,
        timeoutMsOverride: 20,
        reconciliationWindowMsOverride: 120,
        retryBackoffMsOverride: 0,
    });
    (0, test_1.expect)(acquired.sessionId).toBe("late-session-1");
    (0, test_1.expect)(calls).toBe(1);
    const stats = (0, appium_session_coordinator_1.__getCoordinatorStatsForTesting)();
    (0, test_1.expect)(stats.maxPostByKey[key("127.0.0.1", 4723, "emulator-5554", 8200)]).toBe(1);
    (0, appium_session_coordinator_1.releaseSessionLock)({
        lockKey: acquired.lockKey,
        lockOwner: "run-late-1:scenario-1",
        runId: "run-late-1",
    });
});
(0, test_1.test)("timeout with unknown final state blocks with mobile_session_state_unknown and no retry", async () => {
    let calls = 0;
    const hangingFactory = () => {
        calls++;
        return new Promise(() => undefined);
    };
    await (0, test_1.expect)((0, appium_session_coordinator_1.acquireSession)({
        runId: "run-unknown",
        lockOwner: "run-unknown:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emulator-5554",
        systemPort: 8200,
        factory: hangingFactory,
        timeoutMsOverride: 20,
        reconciliationWindowMsOverride: 20,
        retryBackoffMsOverride: 0,
    })).rejects.toThrow(/mobile_session_state_unknown/i);
    (0, test_1.expect)(calls).toBe(1);
});
(0, test_1.test)("GET /sessions 404 is irrelevant: unknown state still blocks retry", async () => {
    let deleteCalls = 0;
    const deleteFn = async () => {
        deleteCalls++;
        return { deleted: false, error: "sessions_list_http_404" };
    };
    (0, appium_session_coordinator_1.__setDeleteSessionFnForTesting)(deleteFn);
    let calls = 0;
    const hangingFactory = () => {
        calls++;
        return new Promise(() => undefined);
    };
    await (0, test_1.expect)((0, appium_session_coordinator_1.acquireSession)({
        runId: "run-404",
        lockOwner: "run-404:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emulator-5554",
        systemPort: 8200,
        factory: hangingFactory,
        timeoutMsOverride: 20,
        reconciliationWindowMsOverride: 20,
        retryBackoffMsOverride: 0,
    })).rejects.toThrow(/mobile_session_state_unknown/i);
    (0, test_1.expect)(calls).toBe(1);
    (0, test_1.expect)(deleteCalls).toBe(0);
});
(0, test_1.test)("retry allowed only after definitive failure + healthy gate", async () => {
    let calls = 0;
    const factory = async () => {
        calls++;
        if (calls === 1)
            throw new Error("mobile_session_transient_unavailable: ECONNRESET");
        return fakeBrowser("session-after-retry");
    };
    const acquired = await (0, appium_session_coordinator_1.acquireSession)({
        runId: "run-retry-ok",
        lockOwner: "run-retry-ok:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emu-a",
        systemPort: 8200,
        factory,
        timeoutMsOverride: 40,
        reconciliationWindowMsOverride: 40,
        retryBackoffMsOverride: 0,
        canRetry: async () => ({ allowed: true, reason: "infra_healthy" }),
    });
    (0, test_1.expect)(acquired.sessionId).toBe("session-after-retry");
    (0, test_1.expect)(calls).toBe(2);
    (0, appium_session_coordinator_1.releaseSessionLock)({
        lockKey: acquired.lockKey,
        lockOwner: "run-retry-ok:scenario-1",
        runId: "run-retry-ok",
    });
});
(0, test_1.test)("retry denied if health gate fails", async () => {
    let calls = 0;
    const factory = async () => {
        calls++;
        throw new Error("mobile_session_transient_unavailable: socket hang up");
    };
    await (0, test_1.expect)((0, appium_session_coordinator_1.acquireSession)({
        runId: "run-retry-denied",
        lockOwner: "run-retry-denied:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emu-a",
        systemPort: 8200,
        factory,
        timeoutMsOverride: 40,
        reconciliationWindowMsOverride: 40,
        retryBackoffMsOverride: 0,
        canRetry: async () => ({ allowed: false, reason: "uiautomator2_unhealthy" }),
    })).rejects.toThrow(/mobile_session_state_unknown/i);
    (0, test_1.expect)(calls).toBe(1);
});
(0, test_1.test)("cleanup uses exact late sessionId before retry", async () => {
    const deleted = [];
    (0, appium_session_coordinator_1.__setDeleteSessionFnForTesting)(async ({ sessionId }) => {
        deleted.push(sessionId);
        return { deleted: true };
    });
    let calls = 0;
    const factory = async () => {
        calls++;
        if (calls === 1) {
            throw new Error("failed to create session; sessionId=abc-123-def");
        }
        return fakeBrowser("session-final");
    };
    const acquired = await (0, appium_session_coordinator_1.acquireSession)({
        runId: "run-cleanup",
        lockOwner: "run-cleanup:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emu-clean",
        systemPort: 8200,
        factory,
        timeoutMsOverride: 40,
        reconciliationWindowMsOverride: 40,
        retryBackoffMsOverride: 0,
        canRetry: async () => ({ allowed: true }),
    });
    (0, test_1.expect)(deleted).toEqual(["abc-123-def"]);
    (0, test_1.expect)(acquired.sessionId).toBe("session-final");
    (0, test_1.expect)(calls).toBe(2);
    (0, appium_session_coordinator_1.releaseSessionLock)({
        lockKey: acquired.lockKey,
        lockOwner: "run-cleanup:scenario-1",
        runId: "run-cleanup",
    });
});
(0, test_1.test)("same device+endpoint+systemPort prevents concurrent POST /session (max concurrency = 1)", async () => {
    let inFlight = 0;
    let observedMax = 0;
    const slowFactory = async () => {
        inFlight++;
        observedMax = Math.max(observedMax, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 50));
        inFlight--;
        return fakeBrowser("session-same-key");
    };
    const p1 = (0, appium_session_coordinator_1.acquireSession)({
        runId: "run-a",
        lockOwner: "run-a:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emu-same",
        systemPort: 8200,
        factory: slowFactory,
        timeoutMsOverride: 200,
        reconciliationWindowMsOverride: 50,
        retryBackoffMsOverride: 0,
    });
    const p2 = (0, appium_session_coordinator_1.acquireSession)({
        runId: "run-b",
        lockOwner: "run-b:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emu-same",
        systemPort: 8200,
        factory: slowFactory,
        timeoutMsOverride: 200,
        reconciliationWindowMsOverride: 50,
        retryBackoffMsOverride: 0,
    });
    const [r1, r2] = await Promise.allSettled([p1, p2]);
    (0, test_1.expect)(r1.status).toBe("fulfilled");
    (0, test_1.expect)(r2.status).toBe("rejected");
    (0, test_1.expect)(observedMax).toBe(1);
    const stats = (0, appium_session_coordinator_1.__getCoordinatorStatsForTesting)();
    (0, test_1.expect)(stats.maxPostByKey[key("127.0.0.1", 4723, "emu-same", 8200)]).toBe(1);
    if (r1.status === "fulfilled") {
        (0, appium_session_coordinator_1.releaseSessionLock)({
            lockKey: r1.value.lockKey,
            lockOwner: "run-a:scenario-1",
            runId: "run-a",
        });
    }
});
(0, test_1.test)("different devices are independent", async () => {
    const a = (0, appium_session_coordinator_1.acquireSession)({
        runId: "run-a",
        lockOwner: "run-a:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emu-a",
        systemPort: 8200,
        factory: async () => fakeBrowser("s-a"),
        timeoutMsOverride: 80,
        reconciliationWindowMsOverride: 40,
    });
    const b = (0, appium_session_coordinator_1.acquireSession)({
        runId: "run-b",
        lockOwner: "run-b:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emu-b",
        systemPort: 8201,
        factory: async () => fakeBrowser("s-b"),
        timeoutMsOverride: 80,
        reconciliationWindowMsOverride: 40,
    });
    const [ra, rb] = await Promise.all([a, b]);
    (0, test_1.expect)(ra.sessionId).toBe("s-a");
    (0, test_1.expect)(rb.sessionId).toBe("s-b");
    (0, appium_session_coordinator_1.releaseSessionLock)({ lockKey: ra.lockKey, lockOwner: "run-a:scenario-1", runId: "run-a" });
    (0, appium_session_coordinator_1.releaseSessionLock)({ lockKey: rb.lockKey, lockOwner: "run-b:scenario-1", runId: "run-b" });
});
(0, test_1.test)("release lock requires ownership match", async () => {
    const acquired = await (0, appium_session_coordinator_1.acquireSession)({
        runId: "run-owner",
        lockOwner: "run-owner:scenario-1",
        appiumHost: "127.0.0.1",
        appiumPort: 4723,
        deviceId: "emu-owner",
        systemPort: 8200,
        factory: async () => fakeBrowser("s-owner"),
        timeoutMsOverride: 80,
        reconciliationWindowMsOverride: 40,
    });
    const lock = (0, appium_session_coordinator_1.__getCoordinatorLockForTesting)(acquired.lockKey);
    (0, test_1.expect)(lock).toBeTruthy();
    (0, appium_session_coordinator_1.releaseSessionLock)({
        lockKey: acquired.lockKey,
        lockOwner: "different-owner",
        runId: "run-owner",
    });
    (0, test_1.expect)((0, appium_session_coordinator_1.__getCoordinatorLockForTesting)(acquired.lockKey)).toBeTruthy();
    (0, appium_session_coordinator_1.releaseSessionLock)({
        lockKey: acquired.lockKey,
        lockOwner: "run-owner:scenario-1",
        runId: "run-owner",
    });
    (0, test_1.expect)((0, appium_session_coordinator_1.__getCoordinatorLockForTesting)(acquired.lockKey)).toBeUndefined();
});
(0, test_1.test)("mobile_automation_channel_lost blocks execution run and skips remaining scenarios", async () => {
    let runScenarioCalls = 0;
    let syncCalls = 0;
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-uia2-lost",
        testRunId: 4900,
        appSlug: "app-mobile",
        publishedCases: [
            { caseId: 70001, scenarioId: "MOBILE-AA-99-001" },
            { caseId: 70002, scenarioId: "MOBILE-AA-99-002" },
        ],
        scenarios: [
            { scenarioId: "MOBILE-AA-99-001", title: "Escenario 1", steps: [{ action: "launchApp", description: "Abrir app" }] },
            { scenarioId: "MOBILE-AA-99-002", title: "Escenario 2", steps: [{ action: "launchApp", description: "Abrir app" }] },
        ],
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => ({
            deviceId: "emulator-5554",
            emulatorStartedByRunner: false,
            ownership: "external_reused",
            ownershipReason: "already_running_reused",
        }),
        runOneScenarioFn: async () => {
            runScenarioCalls++;
            throw new Error("mobile_automation_channel_lost: instrumentation process is not running (probably crashed)");
        },
        syncResultFn: async () => {
            syncCalls++;
            return { statusId: 5, syncStatus: "synced", syncedAt: new Date().toISOString() };
        },
        consolidateEvidenceFn: async () => undefined,
    });
    const updated = job_store_1.jobStore.get(job.id);
    (0, test_1.expect)(updated?.status).toBe("failed");
    (0, test_1.expect)(updated?.summary?.reasonCode).toBe("mobile_automation_channel_lost");
    (0, test_1.expect)(runScenarioCalls).toBe(1);
    (0, test_1.expect)(syncCalls).toBe(0);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("functionalDefectSyncSkipped=true"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("testRailFunctionalStatusSkipped=true"))).toBe(true);
    (0, test_1.expect)(updated?.logs.some((line) => line.includes("skipped_infrastructure_blocked"))).toBe(true);
});
(0, test_1.test)("launch execution forwards requiredData and dataOverrides so OTP steps can resolve an identity", async () => {
    const seen = [];
    // Mirrors the manifest of run 4471e1f8, which failed with otp_identity_unresolved: the OTP
    // step carries no identityField, so the identity can only come from requiredData +
    // dataOverrides reaching the step executor.
    const job = job_store_1.jobStore.create("mobile-launch-execution", {
        launchId: "launch-otp-context",
        testRunId: 4207,
        appSlug: "app-conversacional",
        publishedCases: [{ caseId: 44801, scenarioId: "MOBILE-AA-94-001" }],
        scenarios: [
            {
                scenarioId: "MOBILE-AA-94-001",
                title: "Confirmación de datos con OTP",
                steps: [
                    { action: "fill", description: "Completar el número de documento del cliente" },
                    { action: "fill", description: "Validar el código OTP recibido.", otp: { required: true } },
                ],
                requiredData: [
                    {
                        key: "completar_el_numero_de_documento_del_cliente",
                        label: "Completar el número de documento del cliente",
                        kind: "text",
                        stepIndex: 0,
                        exampleValue: "40229993734",
                        sensitive: true,
                    },
                ],
            },
        ],
        dataOverrides: { "MOBILE-AA-94-001": { 0: "40229993734" } },
    });
    await (0, mobile_launch_execution_runner_1.startMobileLaunchExecutionJobWithDeps)(job.id, {
        ensureMobileInfraFn: async () => ({
            deviceId: "emulator-5554",
            emulatorStartedByRunner: false,
            ownership: "external_reused",
            ownershipReason: "already_running_reused",
        }),
        runOneScenarioFn: async (opts) => {
            seen.push(opts);
            return { passed: 2, failed: 0, blocked: 0, artifactsDir: "", results: [] };
        },
        syncResultFn: async () => ({ statusId: 1, syncStatus: "synced", syncedAt: new Date().toISOString() }),
        consolidateEvidenceFn: async () => undefined,
    });
    (0, test_1.expect)(seen).toHaveLength(1);
    (0, test_1.expect)(seen[0].appSlug).toBe("app-conversacional");
    // Both are required: the identity value lives in dataOverrides, keyed by the stepIndex that
    // only requiredData can map back to a field.
    (0, test_1.expect)(seen[0].dataOverrides).toEqual({ 0: "40229993734" });
    (0, test_1.expect)(seen[0].requiredData?.[0]?.key).toBe("completar_el_numero_de_documento_del_cliente");
});
