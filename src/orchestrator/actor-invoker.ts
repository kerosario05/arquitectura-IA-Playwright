/**
 * Spawns the two external actors. Never invents CLI flags: Codex Physical always goes through
 * the existing, authoritative scripts/codex-qa-verify.ps1 (its own -Prompt/-Effort/-Mode
 * parameters, unchanged); Claude Builder is driven by CLAUDE_CLI_COMMAND/CLAUDE_CLI_EXTRA_ARGS
 * env vars -- the SAME configuration shape this repo already uses for CODEX_CLI_COMMAND/
 * CODEX_CLI_EXTRA_ARGS (see .env.example) -- because no Claude CLI invocation exists anywhere in
 * this repo to reuse, and no flag compatibility is demonstrated here to hardcode one.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BUILDER_RESULT_JSON_SCHEMA } from "./result-parser";
import { structuredBuilderGate, structuredBuilderSourceChanged } from "./result-parser";
import { runCodexCli } from "../agent/codex-cli-runner";
import { resolveCodexCliPath } from "../agent/codex-cli-resolver";
import type { CodexCliRunnerResult } from "../types/codex-auto-repair.types";

export type ActorSpawnResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  spawnedCommand: string;
  /** Structured child-process startup/runtime error, kept separate from captured stderr. */
  processError?: string;
};

export type ActorInvokerUnavailable = { available: false; reason: string };

export type ClaudeQuotaReason = "usage_limit" | "quota_exhausted" | "rate_limit";

/** Only explicit provider usage/quota failures qualify for automatic fallback. */
export function classifyClaudeQuotaFailure(result: ActorSpawnResult): ClaudeQuotaReason | undefined {
  if (result.timedOut || result.exitCode === 0) return undefined;
  const output = `${result.stdout}\n${result.stderr}`.toLowerCase();
  if (/insufficient[_ -]quota|quota(?: has been)? (?:exhausted|exceeded)|(?:exhausted|exceeded) (?:the )?quota/.test(output)) return "quota_exhausted";
  if (/usage limit (?:reached|exceeded|exhausted)|plan usage (?:limit )?(?:reached|exceeded|exhausted)|out of (?:usage|credits|messages)|hit (?:your|the) (?:current )?(?:usage )?limit/.test(output)) return "usage_limit";
  if (/rate[_ -]limit(?:_error)?|rate limit (?:reached|exceeded)|too many requests/.test(output)) return "rate_limit";
  return undefined;
}

export function hasExplicitBuilderGate(result: ActorSpawnResult): boolean {
  return structuredBuilderGate(result.stdout) ?? /^humanGate=true\s*$/im.test(result.stdout);
}

export function hasExplicitBuilderSourceChange(result: ActorSpawnResult): boolean {
  return structuredBuilderSourceChanged(result.stdout) ?? /^sourceChanged=true\s*$/im.test(result.stdout);
}

export const CODEX_BUILDER_MODEL = "gpt-6-luna";
export const CODEX_BUILDER_EFFORT = "medium";
export const CODEX_BUILDER_SANDBOX = "workspace-write";

export function codexBuilderArgs(): string[] {
  return ["-m", CODEX_BUILDER_MODEL, "-c", `model_reasoning_effort=${CODEX_BUILDER_EFFORT}`, "-s", CODEX_BUILDER_SANDBOX, "--skip-git-repo-check"];
}

export function buildCodexBuilderPrompt(claudePrompt: string): string {
  return [
    "ROLE: CODEX_BUILDER. You are the source-writing fallback for the primary Claude Builder.",
    "Perform the exact same bounded task and preserve every first-loss, artifact path, physical GREEN, invariant, no-touch scope, and success criterion below.",
    "Do not expand scope or create a parallel pipeline. Follow the repository instructions and return the required structured result with actor=CODEX_BUILDER.",
    "",
    claudePrompt.replace(/^actor=CLAUDE$/m, "actor=CODEX_BUILDER"),
  ].join("\n");
}

export function buildCodexBuilderRunnerInput(command: string, repoRoot: string, promptText: string, timeoutMs?: number) {
  return {
    command,
    extraArgs: codexBuilderArgs(),
    prompt: buildCodexBuilderPrompt(promptText),
    promptAsStdin: true,
    cwd: repoRoot,
    timeoutMs,
    taskType: "repair" as const,
    purpose: "qa_lab_codex_builder_fallback" as const,
  };
}

export async function invokeCodexBuilder(repoRoot: string, promptText: string, timeoutMs?: number): Promise<CodexCliRunnerResult | ActorInvokerUnavailable> {
  const resolution = await resolveCodexCliPath({ cwd: repoRoot });
  if (!resolution.found) return { available: false, reason: resolution.message };
  return runCodexCli(buildCodexBuilderRunnerInput(resolution.command, repoRoot, promptText, timeoutMs));
}

function spawnAndCapture(command: string, args: string[], cwd: string, timeoutMs?: number, stdinText?: string): Promise<ActorSpawnResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = timeoutMs && timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs) : undefined;
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (exitCode) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode, stdout, stderr, timedOut, spawnedCommand: `${command} ${args.join(" ")}` });
    });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      resolve({ exitCode: null, stdout, stderr, timedOut, spawnedCommand: `${command} ${args.join(" ")}`, processError: String(err) });
    });
    if (stdinText !== undefined) child.stdin.write(stdinText);
    child.stdin.end();
  });
}

/**
 * Codex Physical -- ALWAYS via scripts/codex-qa-verify.ps1, the existing repo-change-guarded
 * verifier. `-Prompt` is passed as one argv element (never string-concatenated into a shell
 * command), which is the safe-argument-array delivery the ticket asks for.
 */
export async function invokeCodexPhysical(
  repoRoot: string,
  promptText: string,
  opts: { effort?: "low" | "medium"; mode?: "discovery" | "recording" | "other"; timeoutMs?: number } = {},
): Promise<ActorSpawnResult> {
  return spawnAndCapture("powershell.exe", codexPhysicalArgs(repoRoot, promptText, opts), repoRoot, opts.timeoutMs);
}

export function codexPhysicalArgs(
  repoRoot: string,
  promptText: string,
  opts: { effort?: "low" | "medium"; mode?: "discovery" | "recording" | "other" } = {},
): string[] {
  const scriptPath = path.join(repoRoot, "scripts", "codex-qa-verify.ps1");
  return [
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", scriptPath,
    "-Prompt", promptText,
    "-Effort", opts.effort ?? "low",
    "-Mode", opts.mode ?? "other",
  ];
}

/**
 * Claude Builder -- real, demonstrated CLI syntax (`claude --help`, claude.exe 2.1.273.0):
 *   --model <model>   accepts an alias ("sonnet") or a full model name
 *   --effort <level>  low|medium|high|xhigh|max -- this invoker only ever sends low/medium
 *   -p, --print       print response and exit; reads the prompt from STDIN when piped
 * CLAUDE_CLI_COMMAND is required (mirrors CODEX_CLI_COMMAND's shape); CLAUDE_CLI_EXTRA_ARGS is
 * appended verbatim before the fixed --model/--effort/-p flags. If CLAUDE_CLI_COMMAND is unset,
 * this is an EXTERNAL_BLOCKER, never a guess.
 */
export function claudeInvokerAvailability(): ActorInvokerUnavailable | { available: true; command: string; extraArgs: string[] } {
  const command = process.env.CLAUDE_CLI_COMMAND;
  if (!command) {
    return { available: false, reason: "CLAUDE_CLI_COMMAND is not set -- no Claude CLI invocation is configured. Set it (mirroring CODEX_CLI_COMMAND's shape) to enable automatic Claude Builder invocation." };
  }
  const extraArgs = (process.env.CLAUDE_CLI_EXTRA_ARGS ?? "").split(" ").filter(Boolean);
  return { available: true, command, extraArgs };
}

export function claudeBuilderArgs(extraArgs: string[], model = "sonnet", effort: ClaudeEffort = "medium"): string[] {
  return [...extraArgs, "--model", model, "--effort", effort, "--json-schema", JSON.stringify(BUILDER_RESULT_JSON_SCHEMA), "--output-format", "json", "-p"];
}

export type ClaudeEffort = "low" | "medium";

export async function invokeClaudeBuilder(
  repoRoot: string,
  taskId: string,
  promptText: string,
  opts: { model?: string; effort?: ClaudeEffort; timeoutMs?: number; workingDirectory?: string } = {},
): Promise<ActorSpawnResult | ActorInvokerUnavailable> {
  const availability = claudeInvokerAvailability();
  if (!availability.available) return availability;
  const model = opts.model ?? "sonnet";
  const effort: ClaudeEffort = opts.effort === "medium" ? "medium" : "low"; // never high/xhigh/max
  const promptDir = path.join(repoRoot, ".artifacts", "orchestrator", taskId, "prompts");
  fs.mkdirSync(promptDir, { recursive: true });
  fs.writeFileSync(path.join(promptDir, `claude-${randomUUID()}.txt`), promptText, "utf8"); // audit copy only
  const args = claudeBuilderArgs(availability.extraArgs, model, effort);
  return spawnAndCapture(availability.command, args, opts.workingDirectory ?? repoRoot, opts.timeoutMs, promptText);
}
