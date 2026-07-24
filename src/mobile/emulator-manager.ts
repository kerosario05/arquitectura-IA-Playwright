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
    child.stdout?.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
    child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });
    child.on("close", (code: number | null) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    child.on("error", (err: Error) => resolve({ exitCode: 1, stdout, stderr: stderr + err.message }));
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
};

export type StartEmulatorOptions = {
  headless?: boolean;
};

type TrackedEmulator = {
  process: ChildProcess;
  avdName: string;
  pid: number;
};

let currentEmulator: TrackedEmulator | null = null;
let bootCompleted = false;

export async function startEmulator(
  avdName: string,
  opts: StartEmulatorOptions = {},
  onLog?: (line: string) => void
): Promise<{ pid: number }> {
  if (currentEmulator) {
    throw new Error(
      `Emulator already running (avd=${currentEmulator.avdName}, pid=${currentEmulator.pid}). Stop it first.`
    );
  }

  const { emulatorPath, sdkHome } = resolveAndroidSdk();

  const args = ["-avd", avdName, "-no-audio", "-no-boot-anim"];
  if (opts.headless ?? true) {
    args.push("-no-window");
  }

  onLog?.(`[emulator] spawning: ${emulatorPath} ${args.join(" ")}`);

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
    currentEmulator = null;
    bootCompleted = false;
  });
  child.on("error", (err: Error) => {
    onLog?.(`[emulator] process error: ${err.message}`);
  });

  currentEmulator = { process: child, avdName, pid: child.pid };
  bootCompleted = false;

  return { pid: child.pid };
}

export async function waitForBoot(timeoutMs: number, onLog?: (line: string) => void): Promise<void> {
  if (!currentEmulator) {
    throw new Error("No emulator has been started. Call startEmulator first.");
  }

  const deadline = Date.now() + timeoutMs;

  onLog?.("[emulator] waiting for device to attach...");
  await adbRunner(["wait-for-device"]);
  onLog?.("[emulator] device attached, polling boot status...");

  while (Date.now() < deadline) {
    if (!currentEmulator) {
      throw new Error("Emulator process exited before finishing boot.");
    }
    const result = await adbRunner(["shell", "getprop", "sys.boot_completed"]);
    if (result.stdout.trim() === "1") {
      bootCompleted = true;
      onLog?.("[emulator] boot completed");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  throw new Error(`Emulator did not finish booting within ${timeoutMs}ms`);
}

export function getStatus(): EmulatorState {
  return {
    running: currentEmulator !== null,
    avdName: currentEmulator?.avdName,
    bootCompleted,
    pid: currentEmulator?.pid
  };
}

export async function stopEmulator(onLog?: (line: string) => void): Promise<void> {
  if (!currentEmulator) {
    onLog?.("[emulator] stop requested but no emulator is running");
    return;
  }

  const proc = currentEmulator.process;

  onLog?.("[emulator] requesting graceful shutdown via 'adb emu kill'");
  try {
    await adbRunner(["emu", "kill"]);
  } catch {
    // Ignore — fall through to process signals below.
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

  currentEmulator = null;
  bootCompleted = false;
  onLog?.("[emulator] stopped");
}
