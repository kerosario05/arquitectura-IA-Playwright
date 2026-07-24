import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { config } from "../config/env";

// Test seam: allows unit tests to replace spawn without spawning a real Appium server.
let spawnFn: typeof nodeSpawn = nodeSpawn;
export function __setSpawnForTesting(fn: typeof nodeSpawn): void {
  spawnFn = fn;
}

export type HttpStatusChecker = (url: string) => Promise<{ ok: boolean; status: number }>;

async function defaultHttpStatusChecker(url: string): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(url, { method: "GET" });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

// Test seam: allows unit tests to fake the /status health check without a real server.
let httpStatusChecker: HttpStatusChecker = defaultHttpStatusChecker;
export function __setHttpStatusCheckerForTesting(fn: HttpStatusChecker): void {
  httpStatusChecker = fn;
}
export function __resetHttpStatusCheckerForTesting(): void {
  httpStatusChecker = defaultHttpStatusChecker;
}

export type AppiumServerState = {
  running: boolean;
  port?: number;
  ready: boolean;
  pid?: number;
};

type TrackedAppiumServer = {
  process: ChildProcess;
  port: number;
  pid: number;
};

let currentServer: TrackedAppiumServer | null = null;
let ready = false;

export async function startAppiumServer(
  port: number,
  onLog?: (line: string) => void
): Promise<{ pid: number; port: number }> {
  if (currentServer) {
    throw new Error(
      `Appium server already running (port=${currentServer.port}, pid=${currentServer.pid}). Stop it first.`
    );
  }

  const bin = config.integrations.android?.appiumBin || "appium";
  const args = ["--port", String(port)];

  onLog?.(`[appium] spawning: ${bin} ${args.join(" ")}`);

  const child = spawnFn(bin, args, {
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  if (!child.pid) {
    throw new Error("Failed to spawn Appium server process (no pid returned). Is Appium installed and on PATH?");
  }

  child.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trim();
    if (text) onLog?.(`[appium:stdout] ${text}`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8").trim();
    if (text) onLog?.(`[appium:stderr] ${text}`);
  });
  child.on("exit", (code: number | null, signal: string | null) => {
    onLog?.(`[appium] process exited code=${code ?? "null"} signal=${signal ?? "null"}`);
    currentServer = null;
    ready = false;
  });
  child.on("error", (err: Error) => {
    onLog?.(`[appium] process error: ${err.message}`);
  });

  currentServer = { process: child, port, pid: child.pid };
  ready = false;

  return { pid: child.pid, port };
}

export async function waitForReady(timeoutMs: number, onLog?: (line: string) => void): Promise<void> {
  if (!currentServer) {
    throw new Error("No Appium server has been started. Call startAppiumServer first.");
  }

  const deadline = Date.now() + timeoutMs;
  const statusUrl = `http://localhost:${currentServer.port}/status`;

  onLog?.(`[appium] polling ${statusUrl} for readiness...`);

  while (Date.now() < deadline) {
    if (!currentServer) {
      throw new Error("Appium server process exited before becoming ready.");
    }
    const result = await httpStatusChecker(statusUrl);
    if (result.ok) {
      ready = true;
      onLog?.("[appium] server ready");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  throw new Error(`Appium server did not become ready within ${timeoutMs}ms`);
}

export function getStatus(): AppiumServerState {
  return {
    running: currentServer !== null,
    port: currentServer?.port,
    ready,
    pid: currentServer?.pid
  };
}

export async function stopAppiumServer(onLog?: (line: string) => void): Promise<void> {
  if (!currentServer) {
    onLog?.("[appium] stop requested but no server is running");
    return;
  }

  const proc = currentServer.process;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    const killTimer = setTimeout(() => {
      onLog?.("[appium] graceful shutdown timed out, sending SIGKILL");
      try {
        proc.kill("SIGKILL");
      } catch {
        // Process already gone.
      }
      finish();
    }, 5000);

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

  currentServer = null;
  ready = false;
  onLog?.("[appium] stopped");
}
