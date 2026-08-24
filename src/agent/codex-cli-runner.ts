import fs from "node:fs";
import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { spawn as nodeSpawn } from "node:child_process";
import type { SpawnOptionsWithoutStdio } from "node:child_process";
import type { CodexCliRunnerInput, CodexCliRunnerResult, CodexCliUsage } from "../types/codex-auto-repair.types";

const SAFE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "TEMP",
  "TMP",
  "NODE_PATH",
  "NPM_CONFIG_PREFIX",
  "CODEX_CONFIG_DIR",
  "CODEX_STATE_DIR"
];

// Test seam: Playwright tests don't include a built-in module mocking system like Jest.
// This allows unit tests to replace the process runner without spawning real processes.
let spawnFn: typeof nodeSpawn = nodeSpawn;
export function __setSpawnForTesting(fn: typeof nodeSpawn): void {
  spawnFn = fn;
}

// Test seam for platform detection — lets unit tests simulate win32/linux.
let currentPlatform: string | undefined;
export function __setPlatformForTesting(p: string | undefined): void {
  currentPlatform = p;
}

let lastRunnerInput: CodexCliRunnerInput | undefined;
export function __getLastRunnerInputForTesting(): CodexCliRunnerInput | undefined {
  return lastRunnerInput;
}

// Resolved spawn descriptor returned by resolveSpawnCommand.
export interface ResolvedSpawnCommand {
  spawnCommand: string;
  spawnArgs: string[];
  displayCommand: string;
}

/**
 * Returns true when the command must be launched via cmd.exe on Windows.
 * .cmd / .bat files cannot be spawned directly by Node.js child_process.spawn on win32.
 * The platform parameter is a test seam (defaults to process.platform).
 */
export function needsCmdExe(command: string, platform: string = currentPlatform ?? process.platform): boolean {
  if (platform !== "win32") return false;
  return command.endsWith(".cmd") || command.endsWith(".bat");
}

/**
 * Resolves the platform-appropriate spawn command and arguments.
 * On Windows, .cmd/.bat files are executed through `cmd.exe /d /s /c`.
 * On other platforms the command is used directly.
 * The platform parameter is a test seam (defaults to process.platform).
 */
export function resolveSpawnCommand(input: CodexCliRunnerInput, platform: string = currentPlatform ?? process.platform): ResolvedSpawnCommand {
  const displayCommand = buildCommand(input);
  const { command, args } = buildCommandArgs(input);

  if (needsCmdExe(command, platform)) {
    // /d — disable AutoRun, /s — strip outer quotes, /c — run and terminate
    const quotedCommand = command.includes(" ") ? `"${command}"` : command;
    return {
      spawnCommand: "cmd.exe",
      spawnArgs: ["/d", "/s", "/c", quotedCommand, ...args],
      displayCommand
    };
  }

  return {
    spawnCommand: command,
    spawnArgs: args,
    displayCommand
  };
}

function buildSafeEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) {
      safe[key] = value;
    }
  }
  return safe;
}

export function escapeDoubleQuotes(s: string): string {
  return s.replace(/"/g, '\\"');
}

export function buildCommandArgs(input: CodexCliRunnerInput): { command: string; args: string[] } {
  const hasJsonFlag = input.extraArgs.some(arg => arg === "--json");
  const extraArgs = hasJsonFlag ? [...input.extraArgs] : [...input.extraArgs, "--json"];
  const contextIsolationArgs = input.purpose === "spec_generation"
    ? ["-c", "project_doc_max_bytes=0"]
    : [];
  // codex.cmd / codex -> "exec" "<prompt>"
  return {
    command: input.command,
    args: ["exec", ...contextIsolationArgs, ...extraArgs, input.prompt]
  };
}

// Back-compat helper used by tests and error formatting.
export function buildCommand(input: CodexCliRunnerInput): string {
  const commandPart = input.command.includes(" ") ? `"${escapeDoubleQuotes(input.command)}"` : input.command;
  const { args } = buildCommandArgs(input);
  const commandArgs = args.map((arg, index) => {
    if (index === args.length - 1) {
      return `"${escapeDoubleQuotes(arg)}"`;
    }
    return arg.includes(" ") ? `"${escapeDoubleQuotes(arg)}"` : arg;
  });
  const parts = [commandPart, ...commandArgs];
  return parts.join(" ");
}

export function truncateForLog(text: string, maxLen = 500): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... [truncated, ${text.length - maxLen} more chars]`;
}

export function buildErrorSuggestions(stderr: string, _command?: string): string {
  const suggestions: string[] = [];
  const lower = stderr.toLowerCase();

  if (lower.includes("trusted directory") || lower.includes("not inside a trusted")) {
    suggestions.push("Add --skip-git-repo-check to CODEX_CLI_EXTRA_ARGS.");
  }
  if (
    lower.includes("read-only") ||
    lower.includes("sandbox") ||
    lower.includes("cannot write") ||
    lower.includes("permission denied") ||
    lower.includes("eacces") ||
    lower.includes("eperm")
  ) {
    suggestions.push("Add --sandbox workspace-write to CODEX_CLI_EXTRA_ARGS.");
  }
  if (
    lower.includes("not found") ||
    lower.includes("no such file") ||
    lower.includes("command not found") ||
    lower.includes("not recognized") ||
    lower.includes("is not a recognized")
  ) {
    suggestions.push("If codex is not found, set CODEX_CLI_COMMAND to your codex.cmd path.");
  }

  return suggestions.length > 0 ? `\nSuggestions:\n${suggestions.map((s) => `  - ${s}`).join("\n")}` : "";
}

function ensureLogPath(p?: string, fallbackDir?: string, name?: string): string | undefined {
  if (p) return p;
  if (fallbackDir && name) return path.join(fallbackDir, name);
  return undefined;
}

type CodexJsonlEvent = {
  type?: string;
  model?: string;
  usage?: Record<string, unknown>;
  item?: Record<string, unknown>;
};

type ParsedJsonlState = {
  lastAgentMessage?: string;
  lastTurnCompleted?: CodexJsonlEvent;
  invalidJsonLines: number;
  parsedJsonLines: number;
};

function asObject(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function readNumberField(obj: Record<string, unknown>, camelName: string, snakeName: string): number {
  const value = obj[camelName] ?? obj[snakeName];
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function readStringField(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function extractAgentMessageText(item: Record<string, unknown>): string | undefined {
  const direct = readStringField(item, "text")
    ?? readStringField(item, "output_text")
    ?? readStringField(item, "message");
  if (direct) return direct;

  const itemMessage = asObject(item.message);
  const messageContent = Array.isArray(itemMessage?.content) ? itemMessage.content : undefined;
  const itemContent = Array.isArray(item.content) ? item.content : undefined;
  const blocks = messageContent ?? itemContent;
  if (!blocks) return undefined;

  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block === "string") {
      if (block.trim().length > 0) parts.push(block);
      continue;
    }
    const blockObj = asObject(block);
    if (!blockObj) continue;

    const text = readStringField(blockObj, "text") ?? readStringField(blockObj, "content");
    if (text) {
      parts.push(text);
      continue;
    }

    if (Array.isArray(blockObj.content)) {
      for (const nested of blockObj.content) {
        const nestedObj = asObject(nested);
        const nestedText = nestedObj ? (readStringField(nestedObj, "text") ?? readStringField(nestedObj, "content")) : undefined;
        if (nestedText) {
          parts.push(nestedText);
        }
      }
    }
  }

  if (parts.length === 0) return undefined;
  return parts.join("\n").trim() || undefined;
}

function parseCodexJsonl(stdout: string): ParsedJsonlState {
  const state: ParsedJsonlState = {
    invalidJsonLines: 0,
    parsedJsonLines: 0
  };

  const lines = stdout.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as CodexJsonlEvent;
      state.parsedJsonLines += 1;
      if (parsed.type === "item.completed") {
        const item = asObject(parsed.item);
        if (item && readStringField(item, "type") === "agent_message") {
          const text = extractAgentMessageText(item);
          if (text) {
            state.lastAgentMessage = text;
          }
        }
      } else if (parsed.type === "turn.completed") {
        state.lastTurnCompleted = parsed;
      }
    } catch {
      state.invalidJsonLines += 1;
    }
  }

  return state;
}

function resolveModelFromArgs(extraArgs: string[]): string {
  for (let i = 0; i < extraArgs.length; i += 1) {
    if ((extraArgs[i] === "--model" || extraArgs[i] === "-m") && typeof extraArgs[i + 1] === "string" && extraArgs[i + 1].trim()) {
      return extraArgs[i + 1].trim();
    }
  }
  return "unknown";
}

function buildUsageSnapshot(
  input: CodexCliRunnerInput,
  parsedJsonl: ParsedJsonlState,
  exitCode: number,
  timedOut: boolean,
  durationMs: number
): CodexCliUsage {
  const turnObj = parsedJsonl.lastTurnCompleted ? asObject(parsedJsonl.lastTurnCompleted) : undefined;
  const usageObj = turnObj?.usage ? asObject(turnObj.usage) : undefined;
  const success = !timedOut && exitCode === 0;
  const modelFromTurn = turnObj ? readStringField(turnObj, "model") : undefined;
  const model = modelFromTurn ?? resolveModelFromArgs(input.extraArgs);
  const taskType = input.taskType ?? "unknown";

  const inputTokens = usageObj ? readNumberField(usageObj, "inputTokens", "input_tokens") : 0;
  const cachedInputTokens = usageObj ? readNumberField(usageObj, "cachedInputTokens", "cached_input_tokens") : 0;
  const cacheWriteInputTokens = usageObj ? readNumberField(usageObj, "cacheWriteInputTokens", "cache_write_input_tokens") : 0;
  const outputTokens = usageObj ? readNumberField(usageObj, "outputTokens", "output_tokens") : 0;
  const reasoningOutputTokens = usageObj ? readNumberField(usageObj, "reasoningOutputTokens", "reasoning_output_tokens") : 0;
  const nonCachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const totalPhysicalTokens = inputTokens + outputTokens;

  return {
    timestamp: new Date().toISOString(),
    provider: "codex_cli",
    model,
    taskType,
    inputTokens,
    cachedInputTokens,
    cacheWriteInputTokens,
    nonCachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalPhysicalTokens,
    durationMs,
    exitCode,
    success
  };
}

const CODEX_USAGE_METRICS_PATH = path.join(".artifacts", "metrics", "codex-usage.jsonl");

async function persistUsage(usage: CodexCliUsage): Promise<void> {
  const metricsPath = path.join(process.cwd(), CODEX_USAGE_METRICS_PATH);
  await mkdir(path.dirname(metricsPath), { recursive: true });
  await appendFile(metricsPath, `${JSON.stringify(usage)}\n`, "utf-8");
}

function logUsageLine(usage: CodexCliUsage, usageUnavailable: boolean): void {
  console.log(
    `[codex-cli:usage] model=${usage.model} taskType=${usage.taskType} ` +
    `input=${usage.inputTokens} cached=${usage.cachedInputTokens} cacheWrite=${usage.cacheWriteInputTokens} ` +
    `nonCached=${usage.nonCachedInputTokens} output=${usage.outputTokens} reasoning=${usage.reasoningOutputTokens} ` +
    `total=${usage.totalPhysicalTokens} durationMs=${usage.durationMs} exitCode=${usage.exitCode} success=${usage.success}` +
    (usageUnavailable ? " usageUnavailable=true" : "")
  );
}

export async function runCodexCli(input: CodexCliRunnerInput): Promise<CodexCliRunnerResult> {
  lastRunnerInput = { ...input };
  const resolved = resolveSpawnCommand(input);
  if (input.purpose === "spec_generation") {
    console.log("[codex-context-policy] purpose=spec_generation projectDocMaxBytes=0");
  }
  const cwd = input.cwd;
  const timeoutMs = input.timeoutMs;
  const startedAt = Date.now();

  const heartbeatMs = input.heartbeatMs ?? 15000;
  const handoffDir = input.handoffDir;
  const attempt = input.attempt;

  const stdoutLogPath = ensureLogPath(input.stdoutLogPath, handoffDir, "codex.stdout.log");
  const stderrLogPath = ensureLogPath(input.stderrLogPath, handoffDir, "codex.stderr.log");

  if (input.showAgentLog) {
    console.log(`[codex-runner] taskType=${input.taskType ?? "unknown"} purpose=${input.purpose ?? "unknown"}`);
    console.log(`[codex-cli] displayCommand: ${resolved.displayCommand}`);
    console.log(`[codex-cli] spawnCommand: ${resolved.spawnCommand} ${resolved.spawnArgs.join(" ")}`);
    console.log(`[codex-cli] cwd: ${cwd}`);
    console.log(`[codex-cli] timeoutMs: ${timeoutMs}`);
    if (stdoutLogPath) console.log(`[codex-cli] stdoutLog: ${stdoutLogPath}`);
    if (stderrLogPath) console.log(`[codex-cli] stderrLog: ${stderrLogPath}`);
  }

  return await new Promise((resolve) => {
    const spawnOptions: SpawnOptionsWithoutStdio = {
      cwd,
      env: buildSafeEnv()
    };

    const child = spawnFn(resolved.spawnCommand, resolved.spawnArgs, { ...spawnOptions, stdio: ["ignore", "pipe", "pipe"] }) as any;

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;
    let lastOutputAt = Date.now();

    const stdoutStream = stdoutLogPath ? fs.createWriteStream(stdoutLogPath, { flags: "a" }) : undefined;
    const stderrStream = stderrLogPath ? fs.createWriteStream(stderrLogPath, { flags: "a" }) : undefined;

    const heartbeatTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastOutputAt >= heartbeatMs) {
        const elapsedMs = now - startedAt;
        const prefix = attempt ? `[codex-cli] attempt ${attempt}` : "[codex-cli]";
        const out = stdoutLogPath ? ` stdoutLog=${stdoutLogPath}` : "";
        const err = stderrLogPath ? ` stderrLog=${stderrLogPath}` : "";
        console.log(`${prefix} Codex still running... elapsedMs=${elapsedMs} timeoutMs=${timeoutMs}${out}${err}`);
        lastOutputAt = now; // avoid spamming in case of totally quiet process
      }
    }, Math.max(50, Math.min(heartbeatMs, 1000)));

    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        cleanup();
        const durationMs = Date.now() - startedAt;
        resolve({
          exitCode: -1,
          stdout: stdoutBuf,
          stderr: stderrBuf,
          timedOut: true,
          durationMs,
          stdoutLogPath,
          stderrLogPath
        });
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeoutTimer);
      clearInterval(heartbeatTimer);
      try { stdoutStream?.end(); } catch { }
      try { stderrStream?.end(); } catch { }
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      const s = String(chunk);
      stdoutBuf += s;
      lastOutputAt = Date.now();
      stdoutStream?.write(s);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const s = String(chunk);
      stderrBuf += s;
      lastOutputAt = Date.now();
      stderrStream?.write(s);
    });

    child.on("close", (code: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      const durationMs = Date.now() - startedAt;
      resolve({
        exitCode: code ?? 1,
        stdout: stdoutBuf,
        stderr: stderrBuf,
        timedOut: false,
        signal: signal ?? undefined,
        durationMs,
        stdoutLogPath,
        stderrLogPath
      });
    });

    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const durationMs = Date.now() - startedAt;
      resolve({
        exitCode: 1,
        stdout: stdoutBuf,
        stderr: `${stderrBuf}\n${err.message}`,
        timedOut: false,
        durationMs,
        stdoutLogPath,
        stderrLogPath
      });
    });
  }).then(async (rawResult) => {
    const parsedJsonl = parseCodexJsonl(rawResult.stdout);
    if (parsedJsonl.invalidJsonLines > 0 && parsedJsonl.parsedJsonLines > 0) {
      console.log(`[codex-cli] jsonl_parse_warning invalidLines=${parsedJsonl.invalidJsonLines}`);
    }

    const usage = buildUsageSnapshot(
      input,
      parsedJsonl,
      rawResult.exitCode,
      rawResult.timedOut,
      rawResult.durationMs
    );

    const usageUnavailable = !parsedJsonl.lastTurnCompleted?.usage;
    logUsageLine(usage, usageUnavailable);
    try {
      await persistUsage(usage);
    } catch {
      console.log("[codex-cli] usage_metrics_persist_failed");
    }

    const stdout = parsedJsonl.lastAgentMessage ?? rawResult.stdout;
    return {
      ...rawResult,
      stdout,
      usage: usageUnavailable ? undefined : usage
    };
  });
}

export function formatCodexCliError(result: CodexCliRunnerResult, input: CodexCliRunnerInput): string {
  const suggestions = buildErrorSuggestions(result.stderr);
  const command = buildCommand(input);

  const parts: string[] = [];
  parts.push(`Codex CLI exited with code ${result.exitCode}.`);
  parts.push(`Command: ${command.slice(0, 120)}...`);
  parts.push(`Cwd: ${input.cwd}`);
  parts.push(`DurationMs: ${result.durationMs}`);
  if (result.signal) {
    parts.push(`Signal: ${result.signal}`);
  }
  if (result.stdoutLogPath) {
    parts.push(`Stdout log: ${result.stdoutLogPath}`);
  }
  if (result.stderrLogPath) {
    parts.push(`Stderr log: ${result.stderrLogPath}`);
  }

  const stdoutSafe = truncateForLog(result.stdout.trim());
  if (stdoutSafe) {
    parts.push(`Stdout:\n${stdoutSafe}`);
  }

  const stderrSafe = truncateForLog(result.stderr.trim());
  if (stderrSafe) {
    parts.push(`Stderr:\n${stderrSafe}`);
  }

  if (suggestions) {
    parts.push(suggestions);
  }

  return parts.join("\n\n");
}

export function formatCodexTimeoutError(input: CodexCliRunnerInput, handoffDir: string, responsePath: string): string {
  const timeoutMinutes = (input.timeoutMs / 60000).toFixed(1);
  const recommendedMs = Math.max(input.timeoutMs * 2, 1800000);
  const recommendedMinutes = (recommendedMs / 60000).toFixed(0);

  const parts: string[] = [];
  parts.push(`Codex CLI timed out after ${timeoutMinutes} minutes (timeoutMs: ${input.timeoutMs}).`);
  parts.push(`Cwd: ${input.cwd}`);
  parts.push(`Handoff directory: ${handoffDir}`);
  parts.push(`Expected response path: ${responsePath}`);
  if (input.stdoutLogPath) parts.push(`Stdout log: ${input.stdoutLogPath}`);
  if (input.stderrLogPath) parts.push(`Stderr log: ${input.stderrLogPath}`);
  parts.push(``);
  parts.push(`Suggestions:`);
  parts.push(`  - Increase AGENT_AUTO_REPAIR_TIMEOUT_MS / CODEX_AUTO_REPAIR_TIMEOUT_MS (current: ${input.timeoutMs}ms, recommended: ${recommendedMs}ms / ${recommendedMinutes} min)`);
  parts.push(`  - Run manually:`);
  parts.push(`    ${buildCommand(input).slice(0, 120)}...`);
  parts.push(`  - Check handoff files in: ${handoffDir}`);
  parts.push(`  - After manual repair, run: npm run agent:validate`);

  return parts.join("\n");
}
