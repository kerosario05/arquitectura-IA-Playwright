import { expect, test } from "@playwright/test";
import {
  __getCoordinatorLockForTesting,
  __getCoordinatorStatsForTesting,
  __resetCoordinatorForTesting,
  __setDeleteSessionFnForTesting,
  acquireSession,
  releaseSessionLock,
  resolveReconciliationWindowMs,
  resolveSessionCreateRetryBackoffMs,
  type SessionDeleteFn,
  type SessionFactoryFn,
} from "../src/mobile/appium-session-coordinator";
import { classifyMobileSessionFailure, resolveSessionCreateTimeoutMs } from "../src/mobile/appium-session";
import { jobStore } from "../src/server/jobs/job-store";
import { startMobileLaunchExecutionJobWithDeps } from "../src/server/jobs/mobile-launch-execution-runner";

function fakeBrowser(sessionId = "session-1"): WebdriverIO.Browser {
  return { sessionId, deleteSession: async () => undefined } as unknown as WebdriverIO.Browser;
}

function key(host: string, port: number, deviceId: string, systemPort: number): string {
  return `${host}:${port}|${deviceId}|${systemPort}`;
}

test.afterEach(() => {
  __resetCoordinatorForTesting();
  delete process.env.APPIUM_SESSION_CREATE_TIMEOUT_MS;
  delete process.env.APPIUM_SESSION_RECONCILIATION_WINDOW_MS;
  delete process.env.APPIUM_SESSION_RETRY_BACKOFF_MS;
  delete process.env.TESTRAIL_STATUS_BLOCKED_ID;
});

test.describe("session coordinator configuration + classifier", () => {
  test("timeout/reconciliation/retry-backoff bounds", () => {
    expect(resolveSessionCreateTimeoutMs()).toBe(90000);
    expect(resolveReconciliationWindowMs()).toBe(8000);
    expect(resolveSessionCreateRetryBackoffMs()).toBe(1250);

    process.env.APPIUM_SESSION_CREATE_TIMEOUT_MS = "1";
    process.env.APPIUM_SESSION_RECONCILIATION_WINDOW_MS = "999999";
    process.env.APPIUM_SESSION_RETRY_BACKOFF_MS = "100";
    expect(resolveSessionCreateTimeoutMs()).toBe(15000);
    expect(resolveReconciliationWindowMs()).toBe(30000);
    expect(resolveSessionCreateRetryBackoffMs()).toBe(250);
  });

  test("mobile_session_state_unknown is non-recoverable", () => {
    const c = classifyMobileSessionFailure("mobile_session_state_unknown: request timed_out_unknown");
    expect(c.reasonCode).toBe("mobile_session_state_unknown");
    expect(c.recoverable).toBe(false);
  });
});

test("POST /session late response is reconciled and reused (no second POST)", async () => {
  let calls = 0;
  const factory: SessionFactoryFn = () => new Promise((resolve) => {
    calls++;
    setTimeout(() => resolve(fakeBrowser("late-session-1")), 40);
  });

  const acquired = await acquireSession({
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

  expect(acquired.sessionId).toBe("late-session-1");
  expect(calls).toBe(1);
  const stats = __getCoordinatorStatsForTesting();
  expect(stats.maxPostByKey[key("127.0.0.1", 4723, "emulator-5554", 8200)]).toBe(1);

  releaseSessionLock({
    lockKey: acquired.lockKey,
    lockOwner: "run-late-1:scenario-1",
    runId: "run-late-1",
  });
});

test("timeout with unknown final state blocks with mobile_session_state_unknown and no retry", async () => {
  let calls = 0;
  const hangingFactory: SessionFactoryFn = () => {
    calls++;
    return new Promise<WebdriverIO.Browser>(() => undefined);
  };

  await expect(
    acquireSession({
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
    }),
  ).rejects.toThrow(/mobile_session_state_unknown/i);

  expect(calls).toBe(1);
});

test("GET /sessions 404 is irrelevant: unknown state still blocks retry", async () => {
  let deleteCalls = 0;
  const deleteFn: SessionDeleteFn = async () => {
    deleteCalls++;
    return { deleted: false, error: "sessions_list_http_404" };
  };
  __setDeleteSessionFnForTesting(deleteFn);

  let calls = 0;
  const hangingFactory: SessionFactoryFn = () => {
    calls++;
    return new Promise<WebdriverIO.Browser>(() => undefined);
  };

  await expect(
    acquireSession({
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
    }),
  ).rejects.toThrow(/mobile_session_state_unknown/i);

  expect(calls).toBe(1);
  expect(deleteCalls).toBe(0);
});

test("retry allowed only after definitive failure + healthy gate", async () => {
  let calls = 0;
  const factory: SessionFactoryFn = async () => {
    calls++;
    if (calls === 1) throw new Error("mobile_session_transient_unavailable: ECONNRESET");
    return fakeBrowser("session-after-retry");
  };

  const acquired = await acquireSession({
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

  expect(acquired.sessionId).toBe("session-after-retry");
  expect(calls).toBe(2);

  releaseSessionLock({
    lockKey: acquired.lockKey,
    lockOwner: "run-retry-ok:scenario-1",
    runId: "run-retry-ok",
  });
});

test("retry denied if health gate fails", async () => {
  let calls = 0;
  const factory: SessionFactoryFn = async () => {
    calls++;
    throw new Error("mobile_session_transient_unavailable: socket hang up");
  };

  await expect(
    acquireSession({
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
    }),
  ).rejects.toThrow(/mobile_session_state_unknown/i);

  expect(calls).toBe(1);
});

test("cleanup uses exact late sessionId before retry", async () => {
  const deleted: string[] = [];
  __setDeleteSessionFnForTesting(async ({ sessionId }) => {
    deleted.push(sessionId);
    return { deleted: true };
  });

  let calls = 0;
  const factory: SessionFactoryFn = async () => {
    calls++;
    if (calls === 1) {
      throw new Error("failed to create session; sessionId=abc-123-def");
    }
    return fakeBrowser("session-final");
  };

  const acquired = await acquireSession({
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

  expect(deleted).toEqual(["abc-123-def"]);
  expect(acquired.sessionId).toBe("session-final");
  expect(calls).toBe(2);
  releaseSessionLock({
    lockKey: acquired.lockKey,
    lockOwner: "run-cleanup:scenario-1",
    runId: "run-cleanup",
  });
});

test("same device+endpoint+systemPort prevents concurrent POST /session (max concurrency = 1)", async () => {
  let inFlight = 0;
  let observedMax = 0;
  const slowFactory: SessionFactoryFn = async () => {
    inFlight++;
    observedMax = Math.max(observedMax, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 50));
    inFlight--;
    return fakeBrowser("session-same-key");
  };

  const p1 = acquireSession({
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
  const p2 = acquireSession({
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
  expect(r1.status).toBe("fulfilled");
  expect(r2.status).toBe("rejected");
  expect(observedMax).toBe(1);

  const stats = __getCoordinatorStatsForTesting();
  expect(stats.maxPostByKey[key("127.0.0.1", 4723, "emu-same", 8200)]).toBe(1);

  if (r1.status === "fulfilled") {
    releaseSessionLock({
      lockKey: r1.value.lockKey,
      lockOwner: "run-a:scenario-1",
      runId: "run-a",
    });
  }
});

test("different devices are independent", async () => {
  const a = acquireSession({
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
  const b = acquireSession({
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
  expect(ra.sessionId).toBe("s-a");
  expect(rb.sessionId).toBe("s-b");
  releaseSessionLock({ lockKey: ra.lockKey, lockOwner: "run-a:scenario-1", runId: "run-a" });
  releaseSessionLock({ lockKey: rb.lockKey, lockOwner: "run-b:scenario-1", runId: "run-b" });
});

test("release lock requires ownership match", async () => {
  const acquired = await acquireSession({
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
  const lock = __getCoordinatorLockForTesting(acquired.lockKey);
  expect(lock).toBeTruthy();

  releaseSessionLock({
    lockKey: acquired.lockKey,
    lockOwner: "different-owner",
    runId: "run-owner",
  });
  expect(__getCoordinatorLockForTesting(acquired.lockKey)).toBeTruthy();

  releaseSessionLock({
    lockKey: acquired.lockKey,
    lockOwner: "run-owner:scenario-1",
    runId: "run-owner",
  });
  expect(__getCoordinatorLockForTesting(acquired.lockKey)).toBeUndefined();
});

test("mobile_automation_channel_lost blocks execution run and skips remaining scenarios", async () => {
  let runScenarioCalls = 0;
  let syncCalls = 0;
  const job = jobStore.create("mobile-launch-execution", {
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

  await startMobileLaunchExecutionJobWithDeps(job.id, {
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

  const updated = jobStore.get(job.id);
  expect(updated?.status).toBe("failed");
  expect(updated?.summary?.reasonCode).toBe("mobile_automation_channel_lost");
  expect(runScenarioCalls).toBe(1);
  expect(syncCalls).toBe(0);
  expect(updated?.logs.some((line) => line.includes("functionalDefectSyncSkipped=true"))).toBe(true);
  expect(updated?.logs.some((line) => line.includes("testRailFunctionalStatusSkipped=true"))).toBe(true);
  expect(updated?.logs.some((line) => line.includes("skipped_infrastructure_blocked"))).toBe(true);
});
