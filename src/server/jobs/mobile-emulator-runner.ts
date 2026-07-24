import { jobStore } from "./job-store";
import { config } from "../../config/env";
import { startEmulator, waitForBoot } from "../../mobile/emulator-manager";

export type MobileEmulatorBootParams = {
  avdName?: string;
  headless?: boolean;
};

export async function startMobileEmulatorBootJob(jobId: string): Promise<void> {
  const job = jobStore.getInternal(jobId);
  if (!job) return;

  const params = job.params as MobileEmulatorBootParams;
  const avdName = params.avdName?.trim() || config.integrations.android?.avdName || "Pixel_7_Pro";
  const headless = params.headless ?? config.integrations.android?.headless ?? true;
  const bootTimeoutMs = config.integrations.android?.bootTimeoutMs ?? 120000;

  jobStore.update(jobId, { status: "running", startedAt: new Date().toISOString() });
  jobStore.appendLog(jobId, `[mobile:emulator] starting avd=${avdName} headless=${headless}`);

  const onLog = (line: string) => jobStore.appendLog(jobId, line);

  try {
    const { pid } = await startEmulator(avdName, { headless }, onLog);
    jobStore.appendLog(jobId, `[mobile:emulator] process spawned pid=${pid}`);

    await waitForBoot(bootTimeoutMs, onLog);

    jobStore.update(jobId, {
      status: "done",
      completedAt: new Date().toISOString()
    });
    jobStore.appendLog(jobId, `[mobile:emulator] ready avd=${avdName} pid=${pid}`);
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
