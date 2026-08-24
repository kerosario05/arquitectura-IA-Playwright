import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { resolveAndroidSdk } from "./android-sdk";

// Test seam: allows unit tests to replace spawn without spawning a real emulator.
let spawnFn: typeof nodeSpawn = nodeSpawn;
export function __setSpawnForTesting(fn: typeof nodeSpawn): void {
  spawnFn = fn;
}

export type AdbResult = { exitCode: number; stdout: string; stderr: string };
export type AdbRunner = (args: string[]) => Promise<AdbResult>;

function defaultAdbRunner(args: string[]): Promise<AdbResult> {
  const { adbPath } = resolveAndroidSdk();
  return new Promise((resolve) => {
    const child = spawnFn(adbPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const settle = (result: AdbResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    child.on("close", (code: number | null) => settle({ exitCode: code ?? 1, stdout, stderr }));
    child.on("error", (err: Error) => settle({ exitCode: 1, stdout, stderr: stderr + err.message }));
    const timer = setTimeout(() => {
      child.kill();
      settle({ exitCode: 1, stdout, stderr: `${stderr}adb_command_timeout after 10000ms`.trim() });
    }, 10000);
  });
}

// Test seam: allows unit tests to fake `adb` responses without a real device/emulator.
let adbRunner: AdbRunner = defaultAdbRunner;
export function __setAdbRunnerForTesting(fn: AdbRunner): void {
  adbRunner = fn;
}
export function __resetAdbRunnerForTesting(): void {
  adbRunner = defaultAdbRunner;
}

export type EmulatorState = {
  running: boolean;
  avdName?: string;
  bootCompleted: boolean;
  pid?: number;
  status: "stopped" | "starting" | "booting" | "ready" | "failed";
  deviceId?: string;
  external: boolean;
  lastError?: string;
};

export type StartEmulatorOptions = {
  headless?: boolean;
};

type TrackedEmulator = {
  process?: ChildProcess;
  avdName: string;
  pid?: number;
  deviceId?: string;
  external: boolean;
};

let currentEmulator: TrackedEmulator | null = null;
let bootCompleted = false;
let lifecycleStatus: EmulatorState["status"] = "stopped";
let lastError: string | undefined;

function parseConnectedEmulatorDeviceId(adbDevicesOutput: string): string | undefined {
  const lines = adbDevicesOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  for (const line of lines) {
    if (!line.startsWith("emulator-")) continue;
    if (!line.includes("\tdevice")) continue;
    const serial = line.split(/\s+/)[0];
    if (serial) return serial;
  }
  return undefined;
}

async function detectConnectedEmulatorDeviceId(): Promise<string | undefined> {
  const result = await adbRunner(["devices"]);
  if (result.exitCode !== 0) return undefined;
  return parseConnectedEmulatorDeviceId(result.stdout);
}

function clearTrackedState(nextStatus: EmulatorState["status"] = "stopped", errorMessage?: string): void {
  currentEmulator = null;
  bootCompleted = false;
  lifecycleStatus = nextStatus;
  lastError = errorMessage;
}

export async function startEmulator(
  avdName: string,
  opts: StartEmulatorOptions = {},
  onLog?: (line: string) => void
): Promise<{ pid?: number; deviceId?: string; reused: boolean; external: boolean }> {
  if (currentEmulator && (lifecycleStatus === "starting" || lifecycleStatus === "booting" || lifecycleStatus === "ready")) {
    onLog?.(`[emulator] reusing existing state status=${lifecycleStatus} avd=${currentEmulator.avdName} pid=${currentEmulator.pid ?? "external"} deviceId=${currentEmulator.deviceId ?? "unknown"}`);
    return {
      pid: currentEmulator.pid,
      deviceId: currentEmulator.deviceId,
      reused: true,
      external: currentEmulator.external,
    };
  }

  const connectedDeviceId = await detectConnectedEmulatorDeviceId();
  if (connectedDeviceId) {
    onLog?.(`[emulator] detected connected emulator via adb devices (${connectedDeviceId}), reusing existing instance`);
    currentEmulator = {
      avdName,
      deviceId: connectedDeviceId,
      external: true,
    };
    lifecycleStatus = "booting";
    lastError = undefined;
    return {
      pid: undefined,
      deviceId: connectedDeviceId,
      reused: true,
      external: true,
    };
  }

  const { emulatorPath, sdkHome } = resolveAndroidSdk();

  const args = ["-avd", avdName, "-no-audio", "-no-boot-anim"];
  if (opts.headless ?? true) {
    args.push("-no-window");
  }

  onLog?.(`[emulator] spawning: ${emulatorPath} ${args.join(" ")}`);
  lifecycleStatus = "starting";
  lastError = undefined;

  const child = spawnFn(emulatorPath, args, {
    cwd: sdkHome,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (!child.pid) {
    throw new Error("Failed to spawn Android emulator process (no pid returned).");
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trim();
    if (text) onLog?.(`[emulator:stdout] ${text}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trim();
    if (text) onLog?.(`[emulator:stderr] ${text}`);
  });
  child.on("exit", (code: number | null, signal: string | null) => {
    onLog?.(`[emulator] process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    clearTrackedState("failed", `Emulator process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
  });
  child.on("error", (err: Error) => {
    onLog?.(`[emulator] process error: ${err.message}`);
    lifecycleStatus = "failed";
    lastError = err.message;
  });

  currentEmulator = { process: child, avdName, pid: child.pid, external: false };
  bootCompleted = false;

  return { pid: child.pid, reused: false, external: false };
}

export async function waitForBoot(timeoutMs: number, onLog?: (line: string) => void): Promise<void> {
  if (!currentEmulator) {
    throw new Error("No emulator has been started. Call startEmulator first.");
  }
  if (bootCompleted) {
    lifecycleStatus = "ready";
    return;
  }

  const deadline = Date.now() + timeoutMs;
  lifecycleStatus = "booting";
  lastError = undefined;
  const deviceId = currentEmulator.deviceId;

  onLog?.(`[emulator] waiting for device to attach${deviceId ? ` (${deviceId})` : ""}...`);
  await adbRunner(deviceId ? ["-s", deviceId, "wait-for-device"] : ["wait-for-device"]);
  onLog?.("[emulator] device attached, polling boot status...");

  while (Date.now() < deadline) {
    if (!currentEmulator) {
      throw new Error("Emulator process exited before finishing boot.");
    }
    const result = await adbRunner(
      deviceId
        ? ["-s", deviceId, "shell", "getprop", "sys.boot_completed"]
        : ["shell", "getprop", "sys.boot_completed"]
    );
    if (result.stdout.trim() === "1") {
      bootCompleted = true;
      lifecycleStatus = "ready";
      lastError = undefined;
      if (!currentEmulator.deviceId) {
        currentEmulator.deviceId = await detectConnectedEmulatorDeviceId();
      }
      onLog?.("[emulator] boot completed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  lifecycleStatus = "failed";
  lastError = `Emulator did not finish booting within ${timeoutMs}ms`;
  throw new Error(`Emulator did not finish booting within ${timeoutMs}ms`);
}

export function getStatus(): EmulatorState {
  return {
    running: currentEmulator !== null && (lifecycleStatus === "starting" || lifecycleStatus === "booting" || lifecycleStatus === "ready"),
    avdName: currentEmulator?.avdName,
    bootCompleted,
    pid: currentEmulator?.pid,
    status: lifecycleStatus,
    deviceId: currentEmulator?.deviceId,
    external: currentEmulator?.external ?? false,
    lastError,
  };
}

export async function stopEmulator(
  onLog?: (line: string) => void,
  options?: { caller?: string; runId?: string },
): Promise<void> {
  if (!currentEmulator) {
    onLog?.("[emulator] stop requested but no emulator is running");
    return;
  }

  const proc = currentEmulator.process;
  const deviceId = currentEmulator.deviceId;
  const caller = options?.caller ?? "unknown";
  const runId = options?.runId ?? "n/a";
  if (currentEmulator.external) {
    onLog?.(
      `[mobile:infra] emulatorCleanup action=preserve reason=reused_external_emulator caller=${caller} runId=${runId} deviceId=${deviceId ?? "unknown"} emulatorStartedByRunner=false ownership=external_reused`,
    );
    return;
  }
  onLog?.(
    `[mobile:infra] emulatorCleanup action=shutdown reason=started_and_owned_by_runner caller=${caller} runId=${runId} deviceId=${deviceId ?? "unknown"} emulatorStartedByRunner=true ownership=runner`,
  );

  onLog?.("[emulator] requesting graceful shutdown via 'adb emu kill'");
  try {
    const result = await adbRunner(deviceId ? ["-s", deviceId, "emu", "kill"] : ["emu", "kill"]);
    onLog?.(`[mobile:infra] emulatorCleanup adbEmuKill exitCode=${result.exitCode} stderr=${(result.stderr || "").slice(0, 160)}`);
  } catch {
    // Ignore — fall through to process signals below.
    onLog?.("[mobile:infra] emulatorCleanup adbEmuKill failed reason=runner_exception");
  }

  if (!proc) {
    clearTrackedState("stopped");
    onLog?.("[emulator] cleared tracked external emulator state");
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const killTimer = setTimeout(() => {
      onLog?.("[emulator] graceful shutdown timed out, sending SIGKILL");
      try {
        proc.kill("SIGKILL");
      } catch {
        // Process already gone.
      }
      finish();
    }, 8000);

    proc.once("exit", () => {
      clearTimeout(killTimer);
      finish();
    });

    try {
      proc.kill("SIGTERM");
    } catch {
      clearTimeout(killTimer);
      finish();
    }
  });

  clearTrackedState("stopped");
  onLog?.("[emulator] stopped");
}

export function __resetEmulatorStateForTesting(): void {
  clearTrackedState("stopped");
}

export type AdbHealthResult = {
  healthy: boolean;
  deviceId?: string;
  reason?: string;
  stage?: "devices" | "shell" | "settings";
};

/**
 * Lightweight ADB preflight: confirms the device is listed, ADB shell responds, and
 * the settings service is reachable. Intended to run after emulator boot but before
 * Appium session creation so that Broken-pipe errors are caught early and classified
 * as infrastructure failures rather than functional test failures.
 */
export async function probeAdbHealth(
  deviceId?: string,
): Promise<AdbHealthResult> {
  // 1. Confirm device is listed and reachable.
  const devicesResult = await adbRunner(["devices"]);
  if (devicesResult.exitCode !== 0) {
    return { healthy: false, reason: "adb_devices_failed", stage: "devices" };
  }
  const connectedId = parseConnectedEmulatorDeviceId(devicesResult.stdout);
  if (!connectedId) {
    return { healthy: false, reason: "device_not_listed", stage: "devices" };
  }
  const targetId = deviceId || connectedId;

  // 2. Verify ADB shell is responsive with a minimal command.
  const shellResult = await adbRunner(["-s", targetId, "shell", "echo", "adb_ok"]);
  if (shellResult.exitCode !== 0 || !shellResult.stdout.includes("adb_ok")) {
    const output = (shellResult.stderr + " " + shellResult.stdout).toLowerCase();
    const brokenPipe = output.includes("broken pipe") || shellResult.exitCode === 224;
    return {
      healthy: false,
      deviceId: targetId,
      reason: brokenPipe ? "adb_broken_pipe" : "adb_shell_unresponsive",
      stage: "shell",
    };
  }

  // 3. Verify settings service (this is what fails with Broken pipe during Appium session init).
  const settingsResult = await adbRunner(["-s", targetId, "shell", "settings", "get", "global", "adb_enabled"]);
  if (settingsResult.exitCode !== 0) {
    const output = (settingsResult.stderr + " " + settingsResult.stdout).toLowerCase();
    const brokenPipe = output.includes("broken pipe") || settingsResult.exitCode === 224;
    return {
      healthy: false,
      deviceId: targetId,
      reason: brokenPipe ? "adb_broken_pipe" : "settings_service_unavailable",
      stage: "settings",
    };
  }

  return { healthy: true, deviceId: targetId };
}
