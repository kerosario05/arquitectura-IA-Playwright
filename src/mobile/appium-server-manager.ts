import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import * as net from "node:net";
import { config } from "../config/env";

// Test seam: allows unit tests to replace spawn without spawning a real Appium server.
let spawnFn: typeof nodeSpawn = nodeSpawn;
export function __setSpawnForTesting(fn: typeof nodeSpawn): void {
  spawnFn = fn;
}
export function __resetSpawnForTesting(): void {
  spawnFn = nodeSpawn;
}

export type HttpStatusChecker = (url: string) => Promise<{ ok: boolean; status: number; error?: string }>;
export type AppiumTraceChunkHandler = (chunk: { stream: "stdout" | "stderr"; text: string; bytes: number }) => void;

async function defaultHttpStatusChecker(url: string): Promise<{ ok: boolean; status: number; error?: string }> {
  try {
    const res = await fetch(url, { method: "GET" });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err instanceof Error ? err.message : String(err) };
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
  status: "stopped" | "starting" | "ready" | "failed";
  external: boolean;
  lastError?: string;
};

export type AppiumStartResult = {
  pid?: number;
  port: number;
  reused: boolean;
  external: boolean;
  preferredPort: number;
  selectedPort: number;
};

export type AppiumPortResolution = {
  preferredPort: number;
  selectedPort: number;
  reusable: boolean;
  available: boolean;
  reason: string;
  attemptedPorts: number[];
};

export type ResolvedAppiumEndpoint = {
  host: string;
  port?: number;
  url?: string;
  ready: boolean;
  external: boolean;
  running: boolean;
};

type TrackedAppiumServer = {
  process?: ChildProcess;
  port: number;
  pid?: number;
  external: boolean;
  stdoutTail: string;
  stderrTail: string;
  readinessAttempts: number;
  lastReadinessError?: string;
  startedAtMs: number;
};

let currentServer: TrackedAppiumServer | null = null;
let ready = false;
let lifecycleStatus: AppiumServerState["status"] = "stopped";
let lastError: string | undefined;
let startInFlight: Promise<AppiumStartResult> | null = null;
let platformOverride: NodeJS.Platform | undefined;
let readinessPollIntervalMs = 1500;
let portProbeForTesting: ((host: string, port: number, timeoutMs: number) => Promise<boolean>) | undefined;

const DEFAULT_APPIUM_START_TIMEOUT_MS = 60000;
const MIN_APPIUM_START_TIMEOUT_MS = 5000;
const MAX_APPIUM_START_TIMEOUT_MS = 300000;
const APPIUM_OUTPUT_TAIL_MAX_CHARS = 2048;
const APPIUM_OUTPUT_PREVIEW_MAX_CHARS = 240;
const DEFAULT_APPIUM_PORT_SCAN_LIMIT = 5;
const MAX_APPIUM_PORT_SCAN_LIMIT = 20;

function resolveAppiumHost(): string {
  const configured = process.env.APPIUM_SERVER_HOST?.trim();
  return configured || "127.0.0.1";
}

type AppiumCommandKind = "native" | "cmd" | "bat";
type AppiumSpawnPlan = {
  platform: NodeJS.Platform;
  resolvedExecutable: string;
  commandKind: AppiumCommandKind;
  effectiveLauncher: string;
  spawnCommand: string;
  spawnArgs: string[];
};

function runtimePlatform(): NodeJS.Platform {
  return platformOverride ?? process.platform;
}

function trimAndUnquote(input: string): string {
  const trimmed = input.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function commandKindForExecutable(executable: string): AppiumCommandKind {
  const lower = executable.toLowerCase();
  if (lower.endsWith(".cmd")) return "cmd";
  if (lower.endsWith(".bat")) return "bat";
  return "native";
}

function quoteForCmd(argument: string): string {
  const escaped = argument
    .replace(/"/g, "\"\"")
    .replace(/%/g, "%%");
  if (!escaped) return "\"\"";
  if (/[ \t&|<>^]/.test(argument) || escaped !== argument) {
    return `"${escaped}"`;
  }
  return escaped;
}

function sanitizeOutput(value: string): string {
  return value
    .replace(/([A-Za-z0-9_]*(?:password|token|secret|apikey)[A-Za-z0-9_]*)\s*[:=]\s*([^\s]+)/gi, "$1=[redacted]")
    .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, "")
    .trim();
}

function appendTail(current: string, nextChunk: string, maxChars: number): string {
  const combined = current + nextChunk;
  if (combined.length <= maxChars) return combined;
  return combined.slice(combined.length - maxChars);
}

function previewText(value: string, maxChars = APPIUM_OUTPUT_PREVIEW_MAX_CHARS): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}...`;
}

function classifyPortError(error?: string): string {
  if (!error) return "unknown";
  const normalized = error.toLowerCase();
  if (normalized.includes("econnrefused")) return "ECONNREFUSED";
  if (normalized.includes("etimedout") || normalized.includes("timed out")) return "ETIMEDOUT";
  if (normalized.includes("ehostunreach")) return "EHOSTUNREACH";
  if (normalized.includes("enotfound")) return "ENOTFOUND";
  return error;
}

function isChildAlive(child: ChildProcess | undefined): boolean {
  if (!child) return false;
  const anyChild = child as ChildProcess & { exitCode?: number | null; killed?: boolean };
  if (typeof anyChild.exitCode === "number") return false;
  if (anyChild.killed) return false;
  return true;
}

async function defaultPortProbe(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (result: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.once("close", () => finish(false));
  });
}

async function isPortListening(host: string, port: number, timeoutMs: number): Promise<boolean> {
  if (portProbeForTesting) {
    return portProbeForTesting(host, port, timeoutMs);
  }
  return defaultPortProbe(host, port, timeoutMs);
}

function spawnProcessTreeKiller(pid: number, onLog?: (line: string) => void): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    let killer: ChildProcess;
    try {
      killer = spawnFn("taskkill", ["/PID", String(pid), "/T", "/F"], {
        env: process.env,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch (err) {
      onLog?.(`[appium] event=tree_kill_error pid=${pid} error="${sanitizeOutput(err instanceof Error ? err.message : String(err))}"`);
      finish(false);
      return;
    }
    killer.once("error", (err) => {
      onLog?.(`[appium] event=tree_kill_error pid=${pid} error="${sanitizeOutput(err.message)}"`);
      finish(false);
    });
    killer.once("exit", (code) => {
      onLog?.(`[appium] event=tree_kill_result pid=${pid} exitCode=${code ?? "null"}`);
      finish(code === 0);
    });
  });
}

async function killStartedProcessTree(proc: ChildProcess, onLog?: (line: string) => void): Promise<boolean> {
  const pid = proc.pid;
  if (!pid) return true;
  if (runtimePlatform() === "win32") {
    return spawnProcessTreeKiller(pid, onLog);
  }
  try {
    proc.kill("SIGTERM");
  } catch {
    // ignore
  }
  return true;
}

async function waitForPortRelease(host: string, port: number, timeoutMs: number, onLog?: (line: string) => void): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await isPortListening(host, port, 800))) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const final = await isPortListening(host, port, 800);
  if (!final) return true;
  onLog?.(`[appium] event=port_still_listening_after_cleanup port=${port}`);
  return false;
}

export function resolveAppiumPortScanLimit(rawValue = process.env.APPIUM_PORT_SCAN_LIMIT): number {
  if (!rawValue || !rawValue.trim()) return DEFAULT_APPIUM_PORT_SCAN_LIMIT;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return DEFAULT_APPIUM_PORT_SCAN_LIMIT;
  }
  return Math.min(parsed, MAX_APPIUM_PORT_SCAN_LIMIT);
}

// Resolves a usable Appium port starting at preferredPort. For each candidate it
// first checks /status (an existing ready Appium is reused), then whether the port
// is listening (an occupied-but-not-ready port is skipped in favor of the next
// candidate). Never spawns on an occupied preferred port.
export async function resolveAvailableAppiumPort(
  host: string,
  preferredPort: number,
  onLog?: (line: string) => void,
): Promise<AppiumPortResolution> {
  const limit = resolveAppiumPortScanLimit();
  const attemptedPorts: number[] = [];
  for (let offset = 0; offset < limit; offset++) {
    const candidate = preferredPort + offset;
    attemptedPorts.push(candidate);
    const statusUrl = `http://${host}:${candidate}/status`;
    const status = await httpStatusChecker(statusUrl);
    if (status.ok) {
      const reason = offset === 0 ? "preferred_ready" : "fallback_ready";
      onLog?.(`[appium] port candidate port=${candidate} statusReady=true`);
      return { preferredPort, selectedPort: candidate, reusable: true, available: true, reason, attemptedPorts };
    }
    const listening = await isPortListening(host, candidate, 500);
    if (!listening) {
      const reason = offset === 0 ? "preferred_free" : "preferred_occupied";
      onLog?.(`[appium] port candidate port=${candidate} statusReady=false portListening=false`);
      return { preferredPort, selectedPort: candidate, reusable: false, available: true, reason, attemptedPorts };
    }
    onLog?.(`[appium] port candidate port=${candidate} statusReady=false portListening=true`);
  }
  return { preferredPort, selectedPort: preferredPort, reusable: false, available: false, reason: "no_available_port", attemptedPorts };
}

// Exposes the resolved Appium endpoint (host/port/url/ready/external) so session
// creation always connects to the port the manager actually resolved — never a
// hardcoded preferred port.
export function getCurrentAppiumServer(): ResolvedAppiumEndpoint | null {
  if (!currentServer) return null;
  const host = resolveAppiumHost();
  return {
    host,
    port: currentServer.port,
    url: `http://${host}:${currentServer.port}`,
    ready,
    external: currentServer.external,
    running: lifecycleStatus === "starting" || lifecycleStatus === "ready",
  };
}

export function getAppiumServerUrl(): string | undefined {
  return getCurrentAppiumServer()?.url;
}

export function resolveAppiumStartTimeoutMs(rawValue = process.env.APPIUM_START_TIMEOUT_MS): number {
  if (!rawValue || !rawValue.trim()) return DEFAULT_APPIUM_START_TIMEOUT_MS;
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return DEFAULT_APPIUM_START_TIMEOUT_MS;
  }
  if (parsed < MIN_APPIUM_START_TIMEOUT_MS) return MIN_APPIUM_START_TIMEOUT_MS;
  if (parsed > MAX_APPIUM_START_TIMEOUT_MS) return MAX_APPIUM_START_TIMEOUT_MS;
  return parsed;
}

export function resolveAppiumSpawnPlan(
  executableRaw: string,
  args: string[],
  options: { platform?: NodeJS.Platform; comSpec?: string } = {}
): AppiumSpawnPlan {
  const platform = options.platform ?? runtimePlatform();
  const resolvedExecutable = trimAndUnquote(executableRaw);
  const commandKind = commandKindForExecutable(resolvedExecutable);
  if (platform === "win32" && (commandKind === "cmd" || commandKind === "bat")) {
    const effectiveLauncher = options.comSpec?.trim() || process.env.ComSpec?.trim() || "cmd.exe";
    const commandLine = [resolvedExecutable, ...args].map(quoteForCmd).join(" ");
    return {
      platform,
      resolvedExecutable,
      commandKind,
      effectiveLauncher,
      spawnCommand: effectiveLauncher,
      spawnArgs: ["/d", "/s", "/c", commandLine],
    };
  }
  return {
    platform,
    resolvedExecutable,
    commandKind,
    effectiveLauncher: resolvedExecutable,
    spawnCommand: resolvedExecutable,
    spawnArgs: args,
  };
}

function classifySpawnError(
  err: unknown,
  context: { executable: string; launcher: string }
): string {
  const e = err as NodeJS.ErrnoException | undefined;
  const code = e?.code;
  const message = e?.message ?? String(err);
  if (code === "ENOENT") {
    return `appium_binary_not_found: Unable to start Appium binary (${context.executable}) via launcher ${context.launcher}.`;
  }
  if (code === "EINVAL" || /spawn EINVAL/i.test(message)) {
    return `appium_spawn_invalid_argument: Invalid spawn arguments while launching ${context.executable} via ${context.launcher}.`;
  }
  return `appium_spawn_failed: ${message}`;
}

function attachProcessStreams(
  child: ChildProcess,
  context: { executable: string; launcher: string },
  onLog?: (line: string) => void,
  onTraceChunk?: AppiumTraceChunkHandler,
): void {
  onLog?.(
    `[appium] event=process_spawned pid=${child.pid ?? "unknown"} launcher=${context.launcher} executable=${context.executable}`,
  );
  child.stdout?.on("data", (chunk: Buffer) => {
    const raw = chunk.toString("utf-8");
    onTraceChunk?.({ stream: "stdout", text: raw, bytes: raw.length });
    const text = sanitizeOutput(raw);
    if (!text) return;
    if (currentServer?.process === child) {
      currentServer.stdoutTail = appendTail(currentServer.stdoutTail, `${text}\n`, APPIUM_OUTPUT_TAIL_MAX_CHARS);
    }
    onLog?.(`[appium] event=process_output stream=stdout bytes=${raw.length} preview="${previewText(text)}"`);
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    const raw = chunk.toString("utf-8");
    onTraceChunk?.({ stream: "stderr", text: raw, bytes: raw.length });
    const text = sanitizeOutput(raw);
    if (!text) return;
    if (currentServer?.process === child) {
      currentServer.stderrTail = appendTail(currentServer.stderrTail, `${text}\n`, APPIUM_OUTPUT_TAIL_MAX_CHARS);
    }
    onLog?.(`[appium] event=process_output stream=stderr bytes=${raw.length} preview="${previewText(text)}"`);
  });
  let exitInfo: { code: number | null; signal: string | null } | null = null;
  let cleanupDone = false;
  const finalize = (code: number | null, signal: string | null): void => {
    if (cleanupDone) return;
    cleanupDone = true;
    const exitCode = exitInfo?.code ?? code;
    const exitSignal = exitInfo?.signal ?? signal;
    const stdoutSummary = sanitizeOutput(currentServer?.process === child ? (currentServer.stdoutTail || "") : "");
    const stderrSummary = sanitizeOutput(currentServer?.process === child ? (currentServer.stderrTail || "") : "");
    const outputDetail = [
      stdoutSummary ? `stdout="${previewText(stdoutSummary, 320)}"` : "",
      stderrSummary ? `stderr="${previewText(stderrSummary, 320)}"` : "",
    ].filter(Boolean).join(" ");
    onLog?.(
      `[appium] event=process_close exitCode=${exitCode ?? "null"} signal=${exitSignal ?? "null"}${outputDetail ? ` ${outputDetail}` : ""}`,
    );
    currentServer = null;
    ready = false;
    lifecycleStatus = "failed";
    lastError = `appium_process_exited: Appium process exited code=${exitCode ?? "null"} signal=${exitSignal ?? "null"}${outputDetail ? ` ${outputDetail}` : ""}`;
  };
  child.on("exit", (code: number | null, signal: string | null) => {
    exitInfo = { code, signal };
    const tailStdout = sanitizeOutput(currentServer?.process === child ? (currentServer.stdoutTail || "") : "");
    const tailStderr = sanitizeOutput(currentServer?.process === child ? (currentServer.stderrTail || "") : "");
    const exitLog = [
      `[appium] event=process_exit exitCode=${code ?? "null"} signal=${signal ?? "null"}`,
      `stdoutTail="${previewText(tailStdout.replace(/[\r\n]+/g, " "), 1500) || "empty"}"`,
      `stderrTail="${previewText(tailStderr.replace(/[\r\n]+/g, " "), 1500) || "empty"}"`,
    ].join(" ");
    onLog?.(exitLog);
  });
  child.on("close", (code: number | null, signal: string | null) => {
    finalize(code, signal);
  });
  child.on("error", (err: Error) => {
    const classified = classifySpawnError(err, context);
    onLog?.(`[appium] event=process_error error="${sanitizeOutput(classified)}"`);
    finalize(null, null);
    lastError = classified;
  });
}

export async function startAppiumServer(
  port: number,
  onLog?: (line: string) => void,
  options?: { onTraceChunk?: AppiumTraceChunkHandler },
): Promise<AppiumStartResult> {
  if (currentServer && (lifecycleStatus === "starting" || lifecycleStatus === "ready")) {
    onLog?.(`[appium] reusing existing state status=${lifecycleStatus} port=${currentServer.port} pid=${currentServer.pid ?? "external"}`);
    return { pid: currentServer.pid, port: currentServer.port, reused: true, external: currentServer.external, preferredPort: port, selectedPort: currentServer.port };
  }
  if (startInFlight) {
    onLog?.("[appium] start already in progress, reusing in-flight launcher");
    return startInFlight;
  }
  if (currentServer && lifecycleStatus === "failed" && isChildAlive(currentServer.process)) {
    onLog?.("[appium] cleaning up stale failed process before new start attempt");
    try {
      currentServer.process?.kill("SIGTERM");
    } catch {
      // ignore best effort
    }
    currentServer = null;
    ready = false;
  }

  const launch = (async (): Promise<AppiumStartResult> => {
    const host = resolveAppiumHost();
    const resolution = await resolveAvailableAppiumPort(host, port, onLog);
    const selectedPort = resolution.selectedPort;
    onLog?.(`[appium] port selected preferred=${port} selected=${selectedPort} reason=${resolution.reason}`);

    if (resolution.reusable) {
      currentServer = {
        port: selectedPort,
        external: true,
        stdoutTail: "",
        stderrTail: "",
        readinessAttempts: 0,
        lastReadinessError: undefined,
        startedAtMs: Date.now(),
      };
      ready = true;
      lifecycleStatus = "ready";
      lastError = undefined;
      onLog?.(`[appium] reusing already-running external server on host=${host} port=${selectedPort}`);
      return { pid: undefined, port: selectedPort, reused: true, external: true, preferredPort: port, selectedPort };
    }

    if (!resolution.available) {
      const attempted = resolution.attemptedPorts.join(",");
      const classified = `appium_no_available_port: No free Appium port within scan limit (preferredPort=${port}, attemptedPorts=${attempted})`;
      lifecycleStatus = "failed";
      lastError = classified;
      throw new Error(classified);
    }

    const bin = config.integrations.android?.appiumBin || "appium";
    const args = ["--port", String(selectedPort)];
    const plan = resolveAppiumSpawnPlan(bin, args, {
      platform: runtimePlatform(),
      comSpec: process.env.ComSpec,
    });
    onLog?.(
      `[appium] launch plan platform=${plan.platform} resolvedExecutable=${plan.resolvedExecutable} commandKind=${plan.commandKind} effectiveLauncher=${plan.effectiveLauncher} port=${selectedPort}`,
    );
    onLog?.(`[appium] spawning: ${plan.spawnCommand} ${plan.spawnArgs.join(" ")}`);
    lastError = undefined;
    lifecycleStatus = "starting";

    let child: ChildProcess;
    try {
      child = spawnFn(plan.spawnCommand, plan.spawnArgs, {
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      const classified = classifySpawnError(err, {
        executable: plan.resolvedExecutable,
        launcher: plan.effectiveLauncher,
      });
      lifecycleStatus = "failed";
      lastError = classified;
      throw new Error(classified);
    }

    currentServer = {
      process: child,
      port: selectedPort,
      pid: child.pid,
      external: false,
      stdoutTail: "",
      stderrTail: "",
      readinessAttempts: 0,
      lastReadinessError: undefined,
      startedAtMs: Date.now(),
    };
    ready = false;
    attachProcessStreams(child, {
      executable: plan.resolvedExecutable,
      launcher: plan.effectiveLauncher,
    }, onLog, options?.onTraceChunk);

    const startupError = await new Promise<Error | null>((resolve) => {
      let settled = false;
      const onSpawn = () => finish(null);
      const onError = (err: Error) => finish(err);
      const cleanup = () => {
        child.off("spawn", onSpawn);
        child.off("error", onError);
      };
      const finish = (value: Error | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(value);
      };
      child.once("spawn", onSpawn);
      child.once("error", onError);
      setTimeout(() => finish(null), 50);
    });
    if (startupError) {
      const classified = classifySpawnError(startupError, {
        executable: plan.resolvedExecutable,
        launcher: plan.effectiveLauncher,
      });
      currentServer = null;
      ready = false;
      lifecycleStatus = "failed";
      lastError = classified;
      throw new Error(classified);
    }

    if (!child.pid) {
      const classified = "appium_spawn_invalid_argument: Failed to spawn Appium process (no pid returned).";
      currentServer = null;
      ready = false;
      lifecycleStatus = "failed";
      lastError = classified;
      throw new Error(classified);
    }

    return { pid: child.pid, port: selectedPort, reused: false, external: false, preferredPort: port, selectedPort };
  })();

  startInFlight = launch;
  try {
    return await launch;
  } finally {
    startInFlight = null;
  }
}

export async function waitForReady(timeoutMs: number, onLog?: (line: string) => void): Promise<void> {
  if (!currentServer) {
    throw new Error(lastError ?? "appium_process_exited: No Appium server has been started. Call startAppiumServer first.");
  }
  if (ready) return;
  lifecycleStatus = "starting";

  const requestedTimeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_APPIUM_START_TIMEOUT_MS;
  const boundedTimeoutMs = Math.max(MIN_APPIUM_START_TIMEOUT_MS, Math.min(MAX_APPIUM_START_TIMEOUT_MS, requestedTimeoutMs));
  const host = resolveAppiumHost();
  const deadline = Date.now() + boundedTimeoutMs;
  const statusUrl = `http://${host}:${currentServer.port}/status`;
  const processRef = currentServer.process;
  if (processRef && !isChildAlive(processRef)) {
    throw new Error(lastError ?? "appium_process_exited: Appium process exited before readiness checks started.");
  }
  const startedAt = Date.now();
  let attempts = 0;
  let lastReadinessError = "";
  let exitDetails: { code?: number | null; signal?: string | null } = {};

  onLog?.(`[appium] polling ${statusUrl} for readiness...`);
  let exitResolve: (() => void) | undefined;
  const exitPromise = processRef
    ? new Promise<void>((resolve) => {
      exitResolve = resolve;
      processRef.once("exit", (code: number | null, signal: string | null) => {
        exitDetails = { code, signal };
        resolve();
      });
      processRef.once("error", () => {
        resolve();
      });
    })
    : null;

  while (Date.now() < deadline) {
    const remaining = Math.max(1, deadline - Date.now());
    const waitSlice = Math.min(readinessPollIntervalMs, remaining);
    if (exitPromise) {
      const race = await Promise.race([
        exitPromise.then(() => "exit" as const),
        new Promise<"tick">((resolve) => setTimeout(() => resolve("tick"), waitSlice)),
      ]);
      if (race === "exit") {
        const stdoutSummary = sanitizeOutput(currentServer?.stdoutTail ?? "");
        const stderrSummary = sanitizeOutput(currentServer?.stderrTail ?? "");
        const exitCode = exitDetails.code ?? processRef?.exitCode ?? null;
        const signal = exitDetails.signal ?? null;
        const message = `appium_process_exited: Appium process exited before readiness. exitCode=${exitCode ?? "null"} signal=${signal ?? "null"} stderr="${previewText(stderrSummary || "-", 320)}"`;
        currentServer = null;
        ready = false;
        lifecycleStatus = "failed";
        lastError = message;
        onLog?.(
          `[appium] event=process_exit exitCode=${exitCode ?? "null"} signal=${signal ?? "null"} before_ready=true ` +
          `stdoutTail="${previewText(stdoutSummary.replace(/[\r\n]+/g, " "), 1500) || "empty"}" ` +
          `stderrTail="${previewText(stderrSummary.replace(/[\r\n]+/g, " "), 1500) || "empty"}"`,
        );
        throw new Error(message);
      }
    } else {
      await new Promise((resolve) => setTimeout(resolve, waitSlice));
    }

    if (!currentServer) {
      throw new Error(lastError ?? "appium_process_exited: Appium server process exited before becoming ready.");
    }

    attempts++;
    currentServer.readinessAttempts = attempts;
    const result = await httpStatusChecker(statusUrl);
    if (result.ok) {
      ready = true;
      lifecycleStatus = "ready";
      lastError = undefined;
      currentServer.lastReadinessError = undefined;
      onLog?.(`[appium] event=readiness_attempts attempts=${attempts} readiness_elapsed_ms=${Date.now() - startedAt} last_readiness_error=-`);
      onLog?.("[appium] server ready");
      if (exitResolve) exitResolve();
      return;
    }
    lastReadinessError = classifyPortError(result.error || (result.status ? `HTTP_${result.status}` : "connection_error"));
    currentServer.lastReadinessError = lastReadinessError;
  }

  const elapsedMs = Date.now() - startedAt;
  // Snapshot everything BEFORE any cleanup: the child's "exit" handler nulls
  // currentServer asynchronously (it fires when the spawned process dies, e.g.
  // exitCode=1 before readiness). This failure path must never read
  // currentServer.* after the snapshot below.
  const failedProcessRef = currentServer?.process;
  const wrapperPid = failedProcessRef?.pid;
  const failedPort = currentServer?.port ?? port;
  const stdoutTail = sanitizeOutput(currentServer?.stdoutTail ?? "");
  const stderrTail = sanitizeOutput(currentServer?.stderrTail ?? "");
  const processAlive = isChildAlive(failedProcessRef);
  let observedExitCode: number | null | undefined = typeof failedProcessRef?.exitCode === "number" ? failedProcessRef.exitCode : undefined;
  if (failedProcessRef && observedExitCode === undefined) {
    failedProcessRef.once("exit", (code) => { observedExitCode = code; });
  }
  let portListening = await isPortListening(host, failedPort, 800);
  onLog?.(`[appium] event=readiness_attempts attempts=${attempts} readiness_elapsed_ms=${elapsedMs} last_readiness_error=${lastReadinessError || "unknown"}`);
  onLog?.(`[appium] event=process_alive_at_timeout process_alive_at_timeout=${processAlive}`);
  onLog?.(`[appium] event=port_listening_at_timeout port_listening_at_timeout=${portListening}`);

  const finalStatusReady = (await httpStatusChecker(statusUrl)).ok;
  if (finalStatusReady) {
    ready = true;
    lifecycleStatus = "ready";
    lastError = undefined;
    if (currentServer) currentServer.lastReadinessError = undefined;
    onLog?.("[appium] server ready (final status check)");
    return;
  }
  onLog?.("[appium] event=final_status_check finalStatusReady=false");

  let cleanupAttempted = false;
  let cleanupSucceeded = false;

  if (failedProcessRef && currentServer?.external !== true) {
    cleanupAttempted = true;
    await killStartedProcessTree(failedProcessRef, onLog);
    portListening = await waitForPortRelease(host, failedPort, 3000, onLog);
    cleanupSucceeded = !portListening;
    onLog?.(`[appium] event=cleanup_result cleanupAttempted=${cleanupAttempted} cleanupSucceeded=${cleanupSucceeded} portListening=${portListening}`);
  } else {
    onLog?.("[appium] event=cleanup_skipped reason=external_or_orphaned");
  }

  currentServer = null;
  ready = false;
  lifecycleStatus = "failed";
  const primaryCause = observedExitCode !== undefined
    ? `Appium process exited before becoming ready (exitCode=${observedExitCode})`
    : `Appium /status did not become ready within ${boundedTimeoutMs}ms`;
  lastError = `appium_readiness_timeout: ${primaryCause} (elapsedMs=${elapsedMs}, attempts=${attempts}, wrapperPid=${wrapperPid ?? "none"}, port=${failedPort}, exitCode=${observedExitCode ?? "none"}, finalStatusReady=${finalStatusReady}, portListening=${portListening}, cleanupAttempted=${cleanupAttempted}, cleanupSucceeded=${cleanupSucceeded}${stdoutTail ? `, stdoutTail="${previewText(stdoutTail, 320)}"` : ""}${stderrTail ? `, stderrTail="${previewText(stderrTail, 320)}"` : ""})`;
  throw new Error(lastError);
}

export function getStatus(): AppiumServerState {
  return {
    running: currentServer !== null && (lifecycleStatus === "starting" || lifecycleStatus === "ready"),
    port: currentServer?.port,
    ready,
    pid: currentServer?.pid,
    status: lifecycleStatus,
    external: currentServer?.external ?? false,
    lastError,
  };
}

export async function refreshStatus(port?: number): Promise<AppiumServerState> {
  const targetPort = port ?? currentServer?.port ?? config.integrations.android?.appiumPort ?? 4723;
  const statusUrl = `http://${resolveAppiumHost()}:${targetPort}/status`;
  const probe = await httpStatusChecker(statusUrl);
  if (probe.ok) {
    if (!currentServer) {
      currentServer = {
        port: targetPort,
        external: true,
        stdoutTail: "",
        stderrTail: "",
        readinessAttempts: 0,
        lastReadinessError: undefined,
        startedAtMs: Date.now(),
      };
    } else if (currentServer.port !== targetPort) {
      currentServer = {
        port: targetPort,
        external: true,
        stdoutTail: "",
        stderrTail: "",
        readinessAttempts: 0,
        lastReadinessError: undefined,
        startedAtMs: Date.now(),
      };
    }
    ready = true;
    lifecycleStatus = "ready";
    lastError = undefined;
  } else if (currentServer?.external && lifecycleStatus === "ready") {
    currentServer = null;
    ready = false;
    lifecycleStatus = "stopped";
    lastError = undefined;
  }
  return getStatus();
}

export async function stopAppiumServer(onLog?: (line: string) => void): Promise<void> {
  if (!currentServer) {
    onLog?.("[appium] stop requested but no server is running");
    return;
  }

  const proc = currentServer.process;
  if (!proc) {
    onLog?.("[appium] clearing tracked external server state (no process owned by this runtime)");
    currentServer = null;
    ready = false;
    lifecycleStatus = "stopped";
    lastError = undefined;
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
      if (runtimePlatform() === "win32") {
        onLog?.("[appium] graceful shutdown timed out, killing process tree");
        void killStartedProcessTree(proc, onLog).finally(() => finish());
      } else {
        onLog?.("[appium] graceful shutdown timed out, sending SIGKILL");
        try {
          proc.kill("SIGKILL");
        } catch {
          // Process already gone.
        }
        finish();
      }
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
  lifecycleStatus = "stopped";
  lastError = undefined;
  onLog?.("[appium] stopped");
}

export function __resetAppiumServerStateForTesting(): void {
  currentServer = null;
  ready = false;
  lifecycleStatus = "stopped";
  lastError = undefined;
  startInFlight = null;
  platformOverride = undefined;
  readinessPollIntervalMs = 1500;
  portProbeForTesting = undefined;
  spawnFn = nodeSpawn;
}

export function __setPlatformForTesting(platform: NodeJS.Platform | undefined): void {
  platformOverride = platform;
}

export function __setReadinessPollIntervalForTesting(intervalMs: number): void {
  readinessPollIntervalMs = intervalMs > 0 ? intervalMs : 1;
}

export function __setPortProbeForTesting(
  probe: ((host: string, port: number, timeoutMs: number) => Promise<boolean>) | undefined
): void {
  portProbeForTesting = probe;
}
