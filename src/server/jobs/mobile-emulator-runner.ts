import { jobStore } from "./job-store";
import { config } from "../../config/env";
import { startEmulator, waitForBoot } from "../../mobile/emulator-manager";
import {
  getStatus as getAppiumStatus,
  startAppiumServer,
  waitForReady as waitForAppiumReady,
  resolveAppiumStartTimeoutMs,
} from "../../mobile/appium-server-manager";

export type MobileEmulatorBootParams = {
  avdName?: string;
  headless?: boolean;
};

export type AppiumInfraResult = {
  ready: boolean;
  reused: boolean;
  external: boolean;
  port?: number;
};

// Ensures Appium is ready by reusing the existing server when /status is already
// ready, otherwise starting it through the Appium manager (same launcher used by
// mobile-test-runner). Reuses all existing fixes: external reuse, readiness
// polling, final status check, process-tree cleanup and diagnostics.
export async function ensureAppiumReady(onLog: (line: string) => void): Promise<AppiumInfraResult> {
  const appiumPort = config.integrations.android?.appiumPort ?? 4723;
  const appiumStatus = getAppiumStatus();
  const appiumStartTimeoutMs = resolveAppiumStartTimeoutMs();
  if (appiumStatus.ready) {
    onLog(`[mobile:infra] appium server already ready status=${appiumStatus.status}, reusing`);
    return {
      ready: true,
      reused: true,
      external: appiumStatus.external,
      port: appiumStatus.port ?? appiumPort,
    };
  }
  onLog(`[mobile:infra] appium server not ready, starting on port=${appiumPort} timeoutMs=${appiumStartTimeoutMs}`);
  const started = await startAppiumServer(appiumPort, onLog);
  onLog(`[mobile:infra] appium start result reused=${started.reused} external=${started.external} pid=${started.pid ?? "external"}`);
  await waitForAppiumReady(appiumStartTimeoutMs, onLog);
  const finalStatus = getAppiumStatus();
  onLog(`[mobile:infra] appium ready=${finalStatus.ready} reused=${started.reused} external=${finalStatus.external} port=${finalStatus.port ?? appiumPort}`);
  return {
    ready: finalStatus.ready,
    reused: started.reused,
    external: finalStatus.external,
    port: finalStatus.port ?? appiumPort,
  };
}

export async function startMobileEmulatorBootJob(jobId: string): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  const params = job.params as MobileEmulatorBootParams;
  const requestedAvdName = params.avdName?.trim() || undefined;
  const requestedHeadless = params.headless;
  const avdName = requestedAvdName || config.integrations.android?.avdName;
  if (!avdName) {
    const message = "Missing Android AVD name. Provide avdName in request payload or configure ANDROID_AVD_NAME.";
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: message,
    });
    jobStore.appendLog(jobId, `[mobile:emulator] failed: ${message}`);
    return;
  }
  const headless = params.headless ?? config.integrations.android?.headless ?? true;
  const bootTimeoutMs = config.integrations.android?.bootTimeoutMs ?? 120000;

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });
  jobStore.appendLog(
    jobId,
    `[mobile:emulator] start request avdName=${requestedAvdName ?? "auto"} headless=${requestedHeadless === undefined ? "auto" : requestedHeadless} effectiveAvdName=${avdName} effectiveHeadless=${headless}`,
  );

  const onLog = (line: string) => jobStore.appendLog(jobId, line);

  try {
    const start = await startEmulator(avdName, { headless }, onLog);
    jobStore.appendLog(jobId, `[mobile:emulator] start result reused=${start.reused} external=${start.external} pid=${start.pid ?? "external"} deviceId=${start.deviceId ?? "pending"}`);

    await waitForBoot(bootTimeoutMs, onLog);

    const appium = await ensureAppiumReady(onLog);

    jobStore.update(jobId, {
      status: "done",
      completedAt: new Date().toISOString(),
      summary: JSON.stringify({ appium }),
    });
    jobStore.appendLog(jobId, `[mobile:emulator] ready avd=${avdName} pid=${start.pid ?? "external"} deviceId=${start.deviceId ?? "detected"} appium.ready=${appium.ready} appium.reused=${appium.reused} appium.external=${appium.external} appium.port=${appium.port ?? "unknown"}`);
    jobStore.appendLog(jobId, `[mobile:infra] infrastructure ready emulator.ready=true appium.ready=${appium.ready}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobStore.appendLog(jobId, `[mobile:emulator] failed: ${message}`);
    jobStore.update(jobId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      errorMessage: message
    });
  }
}
