import { exec } from "node:child_process";
import type { CodexCliRunnerInput, CodexCliRunnerResult } from "../types/codex-auto-repair.types";

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

export function buildCommand(input: CodexCliRunnerInput): string {
  const commandPart = input.command.includes(" ") ? `"${escapeDoubleQuotes(input.command)}"` : input.command;
  const parts = [commandPart, "exec"];
  for (const arg of input.extraArgs) {
    parts.push(arg);
  }
  parts.push(`"${escapeDoubleQuotes(input.prompt)}"`);
  return parts.join(" ");
}

export function truncateForLog(text: string, maxLen = 500): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + `\n... [truncated, ${text.length - maxLen} more chars]`;
}

export function buildErrorSuggestions(stderr: string, command: string): string {
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
    suggestions.push(
      "If codex is not found, set CODEX_CLI_COMMAND to C:\\Users\\radames\\AppData\\Roaming\\npm\\codex.cmd"
    );
  }

  return suggestions.length > 0 ? `\nSuggestions:\n${suggestions.map((s) => `  - ${s}`).join("\n")}` : "";
}

export function runCodexCli(input: CodexCliRunnerInput): Promise<CodexCliRunnerResult> {
  const command = buildCommand(input);
  const cwd = input.cwd;
  const timeoutMs = input.timeoutMs;

  console.log(`[codex-cli] command: ${input.command} exec ${input.extraArgs.join(" ")} "..."`);
  console.log(`[codex-cli] cwd: ${cwd}`);
  console.log(`[codex-cli] timeoutMs: ${timeoutMs}`);

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        resolve({ exitCode: -1, stdout: stdoutBuf, stderr: stderrBuf, timedOut: true });
      }
    }, timeoutMs);

    let stdoutBuf = "";
    let stderrBuf = "";

    const child = exec(command, {
      cwd,
      env: buildSafeEnv(),
      maxBuffer: 10 * 1024 * 1024
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutBuf += String(chunk);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrBuf += String(chunk);
    });

    child.on("close", (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout: stdoutBuf, stderr: stderrBuf, timedOut: false, signal: signal ?? undefined });
      }
    });

    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ exitCode: 1, stdout: stdoutBuf, stderr: `${stderrBuf}\n${err.message}`, timedOut: false });
      }
    });
  });
}

export function formatCodexCliError(result: CodexCliRunnerResult, input: CodexCliRunnerInput): string {
  const command = buildCommand(input);
  const suggestions = buildErrorSuggestions(result.stderr, command);

  const parts: string[] = [];
  parts.push(`Codex CLI exited with code ${result.exitCode}.`);
  parts.push(`Command: ${command.slice(0, 120)}...`);
  parts.push(`Cwd: ${input.cwd}`);
  if (result.signal) {
    parts.push(`Signal: ${result.signal}`);
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
  const command = buildCommand(input);
  const timeoutMinutes = (input.timeoutMs / 60000).toFixed(1);
  const recommendedMs = Math.max(input.timeoutMs * 2, 1800000);
  const recommendedMinutes = (recommendedMs / 60000).toFixed(0);

  const parts: string[] = [];
  parts.push(`Codex CLI timed out after ${timeoutMinutes} minutes (timeoutMs: ${input.timeoutMs}).`);
  parts.push(`Command: ${command.slice(0, 120)}...`);
  parts.push(`Cwd: ${input.cwd}`);
  parts.push(`Handoff directory: ${handoffDir}`);
  parts.push(`Expected response path: ${responsePath}`);
  parts.push(``);
  parts.push(`Suggestions:`);
  parts.push(`  - Increase CODEX_AUTO_REPAIR_TIMEOUT_MS in .env (current: ${input.timeoutMs}ms, recommended: ${recommendedMs}ms / ${recommendedMinutes} min)`);
  parts.push(`  - Run manually:`);
  parts.push(`    ${command.slice(0, 80)}...`);
  parts.push(`  - Check handoff files in: ${handoffDir}`);
  parts.push(`  - After manual repair, run: npm run agent:validate`);

  return parts.join("\n");
}
