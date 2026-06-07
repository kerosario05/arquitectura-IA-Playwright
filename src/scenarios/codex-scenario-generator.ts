import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import type { McpGenerationResponse, McpRouteProfile } from "./scenario-types";
import { buildMcpScenarioMessages } from "./mcp-scenario-prompt-builder";
import { parseAiResponse } from "./scenario-output-parser";
import type { JiraIssueSource } from "./scenario-types";

const SAFE_ENV_KEYS = [
  "PATH", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA",
  "TEMP", "TMP", "NODE_PATH", "NPM_CONFIG_PREFIX",
  "CODEX_CONFIG_DIR", "CODEX_STATE_DIR",
];

function buildSafeEnv(): NodeJS.ProcessEnv {
  const safe: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value !== undefined) safe[key] = value;
  }
  return safe;
}

const AI_TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS) || 120_000;
const AI_MODEL = process.env.AI_MODEL || "codex";
const CODEX_CLI_COMMAND = process.env.CODEX_CLI_COMMAND || "codex";
const CODEX_CLI_EXTRA_ARGS = (process.env.CODEX_CLI_EXTRA_ARGS || "")
  .split(/\s+/)
  .filter(Boolean)
  .filter(a => a !== "exec");
const AI_DEBUG = process.env.SCENARIO_AI_DEBUG === "true";

async function checkCodexAvailable(command: string): Promise<boolean> {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const needsCmd = command.endsWith(".cmd") || command.endsWith(".bat");

    let spawnCmd: string;
    let spawnArgs: string[];

    if (needsCmd && isWin) {
      spawnCmd = "cmd.exe";
      spawnArgs = ["/d", "/s", "/c", `"${command}" --version`];
    } else {
      spawnCmd = command;
      spawnArgs = ["--version"];
    }

    const child = spawn(spawnCmd, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10_000,
    });

    let stdout = "";
    child.stdout?.on("data", (d) => { stdout += String(d); });
    child.stderr?.on("data", (d) => { stdout += String(d); });

    child.on("close", (code) => {
      resolve(code === 0 || stdout.includes("codex"));
    });

    child.on("error", () => {
      resolve(false);
    });
  });
}

interface CodexRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  artifactsDir: string;
  outputPath: string;
}

async function runCodexForScenarios(promptText: string): Promise<CodexRunResult> {
  const startedAt = Date.now();
  const artifactsDir = path.join(process.cwd(), ".artifacts", "scenarios", "ai-runs", String(Date.now()));
  await fsPromises.mkdir(artifactsDir, { recursive: true });

  const promptPath = path.join(artifactsDir, "prompt.txt");
  const outputPath = path.join(artifactsDir, "output.json");
  const stdoutLogPath = path.join(artifactsDir, "stdout.log");
  const stderrLogPath = path.join(artifactsDir, "stderr.log");

  await fsPromises.writeFile(promptPath, promptText, "utf-8");

  const command = CODEX_CLI_COMMAND;
  const isWin = process.platform === "win32";
  const needsCmd = command.endsWith(".cmd") || command.endsWith(".bat");

  let spawnCmd: string;
  let spawnArgs: string[];

  const shortPrompt = `Read the instructions in the file at ${promptPath} and write the result as valid JSON to ${outputPath}. Do NOT write markdown. Do NOT write explanations. Write ONLY the JSON object to the output file. Do NOT write any other files.`;

  if (needsCmd && isWin) {
    const argsPart = CODEX_CLI_EXTRA_ARGS.length > 0 ? CODEX_CLI_EXTRA_ARGS.join(" ") + " " : "";
    const batchPath = path.join(artifactsDir, "run.bat");
    const batchContent = `@echo off\r\n"${command}" exec ${argsPart}"${shortPrompt}"\r\n`;
    await fsPromises.writeFile(batchPath, batchContent, "utf-8");
    spawnCmd = "cmd.exe";
    spawnArgs = ["/d", "/c", batchPath];
    console.log(`[scenarios:ai] batchFile=${batchPath}`);
  } else {
    spawnCmd = command;
    spawnArgs = ["exec", ...CODEX_CLI_EXTRA_ARGS, shortPrompt];
  }

  console.log(`[scenarios:ai] provider=codex command=${command} model=${AI_MODEL}`);
  console.log(`[scenarios:ai] promptFile=${promptPath}`);
  console.log(`[scenarios:ai] outputFile=${outputPath}`);
  console.log(`[scenarios:ai] started`);

  return new Promise((resolve) => {
    const child = spawn(spawnCmd, spawnArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      cwd: process.cwd(),
      env: buildSafeEnv(),
      timeout: AI_TIMEOUT_MS,
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    child.stdout?.on("data", (d: Buffer | string) => {
      stdoutBuf += typeof d === "string" ? d : d.toString("utf-8");
    });

    child.stderr?.on("data", (d: Buffer | string) => {
      stderrBuf += typeof d === "string" ? d : d.toString("utf-8");
    });

    const timeoutTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGTERM");
        setTimeout(() => { if (!child.killed) child.kill("SIGKILL"); }, 2000);
        resolve({
          stdout: stdoutBuf,
          stderr: stderrBuf,
          exitCode: -1,
          durationMs: Date.now() - startedAt,
          artifactsDir,
          outputPath,
        });
      }
    }, AI_TIMEOUT_MS);

    child.on("close", (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);

      fs.writeFile(stdoutLogPath, stdoutBuf, "utf-8", () => {});
      fs.writeFile(stderrLogPath, stderrBuf, "utf-8", () => {});

      console.log(`[scenarios:ai] completed durationMs=${Date.now() - startedAt} exitCode=${code ?? -1} stdoutChars=${stdoutBuf.length} stderrChars=${stderrBuf.length}`);

      resolve({
        stdout: stdoutBuf,
        stderr: stderrBuf,
        exitCode: code ?? 1,
        durationMs: Date.now() - startedAt,
        artifactsDir,
        outputPath,
      });
    });

    child.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      resolve({
        stdout: stdoutBuf,
        stderr: `${stderrBuf}\n${err.message}`,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        artifactsDir,
        outputPath,
      });
    });
  });
}

export async function generateScenariosWithAi(
  issues: JiraIssueSource[],
  appSlug: string,
  testrailMeta?: { projectId: number; suiteId: number; sectionId?: number; sectionName?: string },
  targetAppSlug?: string,
  targetAppName?: string,
  routeProfile?: McpRouteProfile | null,
  entrySteps?: Array<{ action: string; target: string; when?: string }>,
  loginMode?: string,
): Promise<McpGenerationResponse> {
  const command = CODEX_CLI_COMMAND;

  const available = await checkCodexAvailable(command);
  if (!available) {
    throw new Error(`AI_PROVIDER_UNAVAILABLE|Codex CLI is not available. Command: ${command}. Configure CODEX_CLI_COMMAND or install Codex CLI.`);
  }

  const messages = await buildMcpScenarioMessages(issues, appSlug, testrailMeta, targetAppSlug, targetAppName, routeProfile, entrySteps, loginMode);
  const systemMessage = messages.find(m => m.role === "system")?.content ?? "";
  const userMessage = messages.find(m => m.role === "user")?.content ?? "";

  const promptText = [
    "You are an expert QA automation engineer. Generate MCP-ready TestRail scenarios from Jira user stories.",
    "",
    "=== SYSTEM INSTRUCTIONS ===",
    systemMessage,
    "",
    "=== USER REQUEST ===",
    userMessage,
  ].join("\n");

  console.log(`[scenarios:prompt] prompt built chars=${promptText.length} issues=${issues.length}`);

  const result = await runCodexForScenarios(promptText);

  if (result.exitCode === -1 && result.durationMs >= AI_TIMEOUT_MS - 1000) {
    throw new Error(`AI_GENERATION_TIMEOUT|Codex CLI timed out after ${AI_TIMEOUT_MS}ms`);
  }

  if (result.exitCode !== 0) {
    const stderrPreview = AI_DEBUG ? result.stderr.slice(0, 1000) : result.stderr.slice(0, 200);
    throw new Error(`AI_GENERATION_FAILED|Codex CLI exited with code ${result.exitCode}. Stderr: ${stderrPreview}`);
  }

  // Read response: prefer output.json, fallback to stdout
  let rawText = "";
  let responseSource = "";

  try {
    const fileContent = await fsPromises.readFile(result.outputPath, "utf-8");
    if (fileContent.trim()) {
      rawText = fileContent.trim();
      responseSource = "output.json";
    }
  } catch {
    // output.json doesn't exist
  }

  if (!rawText && result.stdout.trim()) {
    rawText = result.stdout.trim();
    responseSource = "stdout";
  }

  console.log(`[scenarios:ai] responseSource=${responseSource || "none"} rawChars=${rawText.length}`);

  // Save artifacts for debugging
  const rawResponsePath = path.join(result.artifactsDir, "raw-response.txt");
  await fsPromises.writeFile(rawResponsePath, rawText, "utf-8").catch(() => {});

  if (!rawText) {
    throw new Error("EMPTY_AI_RESPONSE|Codex CLI returned empty output");
  }

  // Check if it looks like CSV
  if (rawText.includes("Título,Pasos,Precondiciones") || (rawText.split("\n").length > 2 && rawText.split("\n")[0].includes(","))) {
    throw new Error(`AI_RETURNED_CSV|AI returned CSV but preview requires JSON. Artifact dir: ${result.artifactsDir}`);
  }

  // Try parsing as JSON
  const parsed = parseAiResponse(rawText);
  if (parsed) {
    console.log(`[scenarios:parser] parsed scenarios=${parsed.scenarios?.length ?? 0} rejected=${parsed.rejected?.length ?? 0}`);
    return parsed;
  }

  // Save parse error
  const parseErrorPath = path.join(result.artifactsDir, "parse-error.txt");
  const parseError = `Failed to parse JSON from ${responseSource}. Raw length: ${rawText.length}. First 500 chars:\n${rawText.slice(0, 500)}`;
  await fsPromises.writeFile(parseErrorPath, parseError, "utf-8").catch(() => {});

  console.error(`[scenarios:parser] invalid_json rawChars=${rawText.length} artifactDir=${result.artifactsDir}`);

  const rawPreview = AI_DEBUG ? rawText.slice(0, 1000) : rawText.slice(0, 200);
  throw new Error(`INVALID_AI_RESPONSE|AI response was not valid JSON. Artifact dir: ${result.artifactsDir}. Preview: ${rawPreview}`);
}
