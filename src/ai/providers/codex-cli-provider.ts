import { AiProviderError, type AiCompletionRequest, type AiCompletionResponse, type AiProviderConfig } from "../ai-provider.types";
import { parseJsonObjectText } from "../ai-json-validator";
import { runCodexCli } from "../../agent/codex-cli-runner";
import type { CodexCliRunnerInput } from "../../types/codex-auto-repair.types";
import * as path from "node:path";
import * as fs from "node:fs/promises";

const SENSITIVE_PATTERNS = [
  /api[_-]?key\s*[=:]\s*\S+/gi,
  /password\s*[=:]\s*\S+/gi,
  /secret\s*[=:]\s*\S+/gi,
  /token\s*[=:]\s*\S+/gi,
  /Bearer\s+\S+/gi,
  /Basic\s+\S+/gi
];

const REPAIR_DECISION_SCHEMA = {
  type: "object",
  required: ["decision", "reason"],
  properties: {
    decision: { type: "string", enum: ["repaired_plan", "no_safe_action", "needs_more_context"] },
    reason: { type: "string", minLength: 1 },
    repairType: { type: "string", enum: ["target_resolution", "route_recovery", "assertion_resolution", "selection_resolution", "pom_method_missing"] },
    candidateId: { type: "string" },
    evidenceId: { type: "string" },
    assertionStatus: { type: "string" },
    selectionStatus: { type: "string" },
    confidence: { type: "number" },
    questions: { type: "array", items: { type: "string" } }
  },
  additionalProperties: false
};

export class CodexCliProvider {
  public readonly providerType = "codex_cli" as const;
  public readonly providerName: string;
  public readonly model: string;
  private readonly command: string;
  private readonly extraArgs: string[];
  private readonly timeoutMs: number;
  private readonly allowStdoutJsonFallback: boolean;

  constructor(config: AiProviderConfig) {
    this.providerName = config.providerName;
    this.model = config.model;
    this.command = config.command ?? "codex";
    this.extraArgs = config.extraArgs ?? [];
    this.timeoutMs = config.timeoutMs;
    this.allowStdoutJsonFallback = config.allowStdoutJsonFallback ?? false;
  }

  private buildFinalExtraArgs(): string[] {
    const hasModelFlag = this.extraArgs.some((arg, i) => {
      return arg === "--model" || arg === "-m" || (i > 0 && (this.extraArgs[i - 1] === "--model" || this.extraArgs[i - 1] === "-m"));
    });

    if (hasModelFlag) {
      return [...this.extraArgs];
    }

    if (this.model) {
      return ["--model", this.model, ...this.extraArgs];
    }

    return [...this.extraArgs];
  }

  async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const startedAt = Date.now();
    const tempDir = await this.createTempDir();
    const outputPath = path.join(tempDir, "repair-decision.json");
    const promptPath = path.join(tempDir, "prompt.txt");
    const stdoutLogPath = path.join(tempDir, "codex-stdout.log");
    const stderrLogPath = path.join(tempDir, "codex-stderr.log");
    let processExitedNonZero = false;
    let processResult: Awaited<ReturnType<typeof runCodexCli>> | null = null;

    try {
      const systemMessage = request.messages.find(m => m.role === "system")?.content ?? "";
      const userMessage = request.messages.find(m => m.role === "user")?.content ?? "";

      await this.writeInputFiles(tempDir, outputPath, promptPath, systemMessage, userMessage);

      const shortPrompt = `Read and follow the instructions in "${promptPath}". Write the output file exactly as instructed.`;
      const finalExtraArgs = this.buildFinalExtraArgs();

      const runnerInput: CodexCliRunnerInput = {
        command: this.command,
        extraArgs: finalExtraArgs,
        prompt: shortPrompt,
        cwd: tempDir,
        timeoutMs: this.timeoutMs,
        stdoutLogPath,
        stderrLogPath
      };

      const result = await runCodexCli(runnerInput);
      processResult = result;
      const durationMs = Date.now() - startedAt;

      if (result.timedOut) {
        throw new AiProviderError("ai_provider_timeout", `Codex CLI timed out after ${this.timeoutMs}ms`, {
          timeoutMs: this.timeoutMs,
          durationMs,
          tempDir,
          promptPath,
          outputPath
        });
      }

      let outputContent: string;
      let fileOutputExists = false;
      try {
        outputContent = await fs.readFile(outputPath, "utf-8");
        fileOutputExists = true;
      } catch {
        if (this.allowStdoutJsonFallback) {
          const stdoutJson = this.tryExtractJsonFromStdout(result.stdout);
          if (stdoutJson) {
            return {
              rawText: stdoutJson.raw,
              parsedJson: stdoutJson.parsed,
              model: this.model,
              providerName: this.providerName,
              durationMs,
              diagnostics: {
                warning: "codex_stdout_fallback_used",
                exitCode: result.exitCode,
                stdout: this.sanitizeSecrets(result.stdout).slice(0, 1000),
                stderr: this.sanitizeSecrets(result.stderr).slice(0, 1000)
              }
            };
          }
        }
        processExitedNonZero = result.exitCode !== 0 || processExitedNonZero;
        throw new AiProviderError("ai_provider_output_missing", `Codex did not write repair-decision.json`, {
          tempDir,
          promptPath,
          outputPath,
          exitCode: result.exitCode,
          stdoutPreview: this.sanitizeSecrets(result.stdout).slice(0, 500),
          stderrPreview: this.sanitizeSecrets(result.stderr).slice(0, 500),
          command: this.command,
          args: this.sanitizeArgs([...finalExtraArgs, shortPrompt])
        });
      }

      let parsedJson: Record<string, unknown>;
      try {
        parsedJson = parseJsonObjectText(outputContent);
      } catch (error) {
        processExitedNonZero = result.exitCode !== 0 || processExitedNonZero;
        throw new AiProviderError("ai_provider_invalid_json", `repair-decision.json contains invalid JSON`, {
          tempDir,
          promptPath,
          outputPath,
          exitCode: result.exitCode,
          error: error instanceof Error ? error.message : String(error),
          filePreview: outputContent.slice(0, 500),
          stderrPreview: this.sanitizeSecrets(result.stderr).slice(0, 500)
        });
      }

      if (result.exitCode !== 0) {
        processExitedNonZero = true;
        return {
          rawText: outputContent,
          parsedJson,
          model: this.model,
          providerName: this.providerName,
          durationMs,
          diagnostics: {
            warning: "codex_exited_non_zero_but_output_valid",
            exitCode: result.exitCode,
            stdout: this.sanitizeSecrets(result.stdout).slice(0, 1000),
            stderr: this.sanitizeSecrets(result.stderr).slice(0, 1000)
          }
        };
      }

      return {
        rawText: outputContent,
        parsedJson,
        model: this.model,
        providerName: this.providerName,
        durationMs
      };
    } catch (error) {
      if (processExitedNonZero && processResult) {
        await this.preserveArtifactsOnError(tempDir, processResult, stdoutLogPath, stderrLogPath);
      }
      throw error;
    } finally {
      if (!processExitedNonZero) {
        await this.cleanupTempDir(tempDir);
      }
    }
  }

  private async preserveArtifactsOnError(
    tempDir: string,
    result: Awaited<ReturnType<typeof runCodexCli>>,
    stdoutLogPath: string,
    stderrLogPath: string
  ): Promise<void> {
    try {
      if (result.stdout && !await this.fileExists(stdoutLogPath)) {
        await fs.writeFile(stdoutLogPath, result.stdout, "utf-8");
      }
      if (result.stderr && !await this.fileExists(stderrLogPath)) {
        await fs.writeFile(stderrLogPath, result.stderr, "utf-8");
      }
    } catch {
      // Ignorar errores al preservar artifacts
    }
  }

  private async fileExists(p: string): Promise<boolean> {
    try {
      await fs.access(p);
      return true;
    } catch {
      return false;
    }
  }

  private async createTempDir(): Promise<string> {
    const timestamp = Date.now();
    const tempDir = path.join(process.cwd(), ".artifacts", "ai-provider", "codex", `${timestamp}`);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  private async writeInputFiles(
    tempDir: string,
    outputPath: string,
    promptPath: string,
    systemMessage: string,
    userMessage: string
  ): Promise<void> {
    const schemaPath = path.join(tempDir, "repair-decision.schema.json");
    await fs.writeFile(schemaPath, JSON.stringify(REPAIR_DECISION_SCHEMA, null, 2), "utf-8");

    const fileOutputPrompt = this.buildFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage);
    await fs.writeFile(promptPath, fileOutputPrompt, "utf-8");

    const contextPackMatch = userMessage.match(/\{[\s\S]*"appSlug"[\s\S]*\}/);
    if (contextPackMatch) {
      const contextPackPath = path.join(tempDir, "context-pack.json");
      try {
        const contextPack = JSON.parse(contextPackMatch[0]);
        await fs.writeFile(contextPackPath, JSON.stringify(contextPack, null, 2), "utf-8");
      } catch {
        // Ignorar si no se puede parsear
      }
    }
  }

  private buildFileOutputPrompt(outputPath: string, promptPath: string, systemMessage: string, userMessage: string): string {
    const lines: string[] = [
      "TASK: Write exactly ONE file at the absolute path below with valid JSON.",
      "",
      `OUTPUT FILE (absolute path): ${outputPath}`,
      "",
      "RULES:",
      `- Write EXACTLY one file at: ${outputPath}`,
      "- Do NOT modify any other files",
      "- Do NOT execute shell commands",
      "- Do NOT write markdown or explanations",
      "- Do NOT write to stdout as the primary output source",
      "- Output must be valid JSON (no trailing commas, no comments)",
      "- The JSON must conform to repair-decision.schema.json in the same directory",
      "",
      "REQUIRED FIELDS:",
      "- decision: one of [repaired_plan, no_safe_action, needs_more_context]",
      "- reason: string explaining the decision",
      "",
      "OPTIONAL FIELDS:",
      "- repairType, candidateId, evidenceId, assertionStatus, selectionStatus, confidence, questions",
      ""
    ];

    if (systemMessage) {
      lines.push("SYSTEM CONTEXT:", systemMessage, "");
    }

    if (userMessage) {
      lines.push("USER REQUEST:", userMessage, "");
    }

    lines.push(
      "INSTRUCTION: Use the SYSTEM CONTEXT and USER REQUEST above to determine the appropriate decision and reason.",
      `Write the JSON object to: ${outputPath}`,
      "Do NOT write any other files. Do NOT write to stdout.",
      "",
      "EXAMPLE OUTPUT:",
      '{"decision":"no_safe_action","reason":"No safe candidate matches the intent without user confirmation."}',
      "",
      "IMPORTANT: Write ONLY the file at the OUTPUT FILE path. Nothing else."
    );

    return lines.join("\n");
  }

  private async cleanupTempDir(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignorar errores de limpieza
    }
  }

  private sanitizeSecrets(text: string): string {
    let sanitized = text;
    for (const pattern of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, "[REDACTED]");
    }
    return sanitized;
  }

  private sanitizeArgs(args: string[]): string[] {
    return args.map(a => this.sanitizeSecrets(a));
  }

  private tryExtractJsonFromStdout(stdout: string): { raw: string; parsed: Record<string, unknown> } | null {
    if (!stdout?.trim()) return null;

    const trimmed = stdout.trim();

    // Try parsing entire stdout as JSON
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return { raw: trimmed, parsed: parsed as Record<string, unknown> };
      }
    } catch {
      // Not valid JSON as-is, try to find JSON object in text
    }

    // Try to find JSON object pattern { ... } in stdout
    const jsonMatch = trimmed.match(/\{[\s\S]*"decision"\s*:[\s\S]*"reason"\s*:[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return { raw: jsonMatch[0], parsed: parsed as Record<string, unknown> };
        }
      } catch {
        // Invalid JSON in match
      }
    }

    // Try broader JSON object extraction
    const braceMatch = trimmed.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        const parsed = JSON.parse(braceMatch[0]);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return { raw: braceMatch[0], parsed: parsed as Record<string, unknown> };
        }
      } catch {
        // Invalid JSON
      }
    }

    return null;
  }
}
