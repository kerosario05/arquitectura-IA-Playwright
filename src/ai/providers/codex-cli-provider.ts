import { AiProviderError, type AiCompletionRequest, type AiCompletionResponse, type AiProviderConfig } from "../ai-provider.types";
import { parseJsonObjectText } from "../ai-json-validator";
import { runCodexCli } from "../../agent/codex-cli-runner";
import type { CodexCliRunnerInput } from "../../types/codex-auto-repair.types";
import { extractJsonFromSources, validateScenarioShape, type JsonExtractionSource } from "../json-output-extractor";
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

  constructor(config: AiProviderConfig) {
    this.providerName = config.providerName;
    this.model = config.model;
    this.command = config.command ?? "codex";
    this.extraArgs = config.extraArgs ?? [];
    this.timeoutMs = config.timeoutMs;
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
    const purpose = request.purpose ?? "general";
    const tempDir = await this.createTempDir(purpose);
    const outputFileName = this.getOutputFileName(purpose);
    const outputPath = path.join(tempDir, outputFileName);
    const promptPath = path.join(tempDir, "prompt.txt");
    const stdoutLogPath = path.join(tempDir, "codex-stdout.log");
    const stderrLogPath = path.join(tempDir, "codex-stderr.log");
    let processExitedNonZero = false;
    let processResult: Awaited<ReturnType<typeof runCodexCli>> | null = null;

    try {
      const systemMessage = request.messages.find(m => m.role === "system")?.content ?? "";
      const userMessage = request.messages.find(m => m.role === "user")?.content ?? "";

      await this.writeInputFiles(tempDir, outputPath, promptPath, systemMessage, userMessage, purpose);

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

      // Log diagnostics for scenario_generation
      if (purpose === "scenario_generation") {
        console.log(`[codex-cli] purpose=scenario_generation exitCode=${result.exitCode} durationMs=${durationMs}`);
        console.log(`[codex-cli] stdoutChars=${result.stdout?.length ?? 0} stderrChars=${result.stderr?.length ?? 0}`);
      }

      if (result.timedOut) {
        throw new AiProviderError("ai_provider_timeout", `AI provider timed out after ${this.timeoutMs}ms`, {
          provider: this.providerName,
          timeoutMs: this.timeoutMs,
          durationMs,
          tempDir,
          promptPath,
          outputPath
        });
      }

      // Use shared JSON extractor for robust extraction
      const extractionSource: JsonExtractionSource = {
        stdout: result.stdout,
        stderr: result.stderr,
        outputFilePath: outputPath
      };

      const extractionResult = await extractJsonFromSources(extractionSource, purpose, "codex-cli");

      if (!extractionResult.success) {
        processExitedNonZero = result.exitCode !== 0 || processExitedNonZero;

        // Enhanced diagnostics for scenario generation failures
        const stderrLower = result.stderr.toLowerCase();
        const stdoutLower = result.stdout.toLowerCase();

        // Detect common error patterns
        const isModelError =
          stderrLower.includes("unsupported model") ||
          stderrLower.includes("invalid model") ||
          stderrLower.includes("model not found") ||
          stderrLower.includes("model") && stderrLower.includes("not supported");

        const isAuthError =
          stderrLower.includes("unauthorized") ||
          stderrLower.includes("authentication") ||
          stderrLower.includes("api key");

        const isRateLimitError =
          stderrLower.includes("rate limit") ||
          stderrLower.includes("429") ||
          stderrLower.includes("quota exceeded");

        // Build actionable suggestions
        const suggestions: string[] = [];
        if (isModelError) {
          suggestions.push("The specified model may not be supported by the Codex CLI");
          suggestions.push(`Check AI_SCENARIO_MODEL env var (current: ${this.model})`);
          suggestions.push("Try using a supported model like 'gpt-4o-mini' or 'gpt-4o'");
        }
        if (isAuthError) {
          suggestions.push("Check API credentials in environment variables");
        }
        if (isRateLimitError) {
          suggestions.push("Rate limit exceeded - wait and retry, or check API quota");
        }
        if (!isModelError && !isAuthError && !isRateLimitError) {
          suggestions.push("Check stderr/stdout in debug artifacts for details");
          suggestions.push("Ensure Codex CLI is properly installed and configured");
        }

        // Log enhanced diagnostics for scenario_generation
        if (purpose === "scenario_generation") {
          console.log(
            `[codex-cli] scenario_generation failed exitCode=${result.exitCode} ` +
            `modelError=${isModelError} authError=${isAuthError} rateLimitError=${isRateLimitError}`
          );
          console.log(`[codex-cli] stderr preview (first 1000 chars):\n${this.sanitizeSecrets(result.stderr).slice(0, 1000)}`);
          if (suggestions.length > 0) {
            console.log(`[codex-cli] suggestions:\n  ${suggestions.join("\n  ")}`);
          }
        }

        // Save debug artifacts on failure
        await this.saveDebugArtifacts(tempDir, result, purpose, extractionResult.attempts);

        const errorDetails = {
          provider: this.providerName,
          tempDir,
          promptPath,
          outputPath,
          exitCode: result.exitCode,
          stdoutPreview: this.sanitizeSecrets(result.stdout).slice(0, 1000),
          stderrPreview: this.sanitizeSecrets(result.stderr).slice(0, 1000),
          command: this.command,
          model: this.model,
          args: this.sanitizeArgs([...finalExtraArgs, shortPrompt]),
          extractionAttempts: extractionResult.attempts,
          errorPatterns: {
            isModelError,
            isAuthError,
            isRateLimitError
          },
          suggestions
        };

        const errorMessage = [
          this.getOutputMissingErrorMessage(purpose, outputFileName),
          ...suggestions.map((s, i) => `  ${i + 1}. ${s}`)
        ].join("\n");

        throw new AiProviderError(
          "ai_provider_output_missing",
          errorMessage,
          errorDetails
        );
      }

      // Validate scenario shape for scenario_generation
      if (purpose === "scenario_generation") {
        const shapeValidation = validateScenarioShape(extractionResult.parsed);
        if (!shapeValidation.valid) {
          processExitedNonZero = result.exitCode !== 0 || processExitedNonZero;

          await this.saveDebugArtifacts(tempDir, result, purpose, extractionResult.attempts);

          throw new AiProviderError(
            "ai_provider_invalid_json",
            `Scenario generation JSON has invalid shape: ${shapeValidation.reason}`,
            {
              provider: this.providerName,
              tempDir,
              exitCode: result.exitCode,
              detectedKeys: shapeValidation.detectedKeys,
              extractionStrategy: extractionResult.strategy
            }
          );
        }
      }

      if (result.exitCode !== 0) {
        processExitedNonZero = true;
        return {
          rawText: extractionResult.raw,
          parsedJson: extractionResult.parsed,
          model: this.model,
          providerName: this.providerName,
          durationMs,
          diagnostics: {
            warning: "ai_provider_exited_non_zero_but_output_valid",
            exitCode: result.exitCode,
            stdout: this.sanitizeSecrets(result.stdout).slice(0, 1000),
            stderr: this.sanitizeSecrets(result.stderr).slice(0, 1000)
          }
        };
      }

      return {
        rawText: extractionResult.raw,
        parsedJson: extractionResult.parsed,
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

  private getOutputFileName(purpose: string): string {
    if (purpose === "scenario_generation") {
      return "scenario-generation-result.json";
    }
    // Default to repair-decision.json for repair and general purposes
    return "repair-decision.json";
  }

  private getOutputMissingErrorMessage(purpose: string, fileName: string): string {
    if (purpose === "scenario_generation") {
      return `AI provider did not write ${fileName}. Check artifacts at tempDir for stdout/stderr logs.`;
    }
    return `AI provider did not write ${fileName}`;
  }

  private getInvalidJsonErrorMessage(purpose: string, fileName: string): string {
    if (purpose === "scenario_generation") {
      return `${fileName} contains invalid JSON. Check artifacts for raw output.`;
    }
    return `${fileName} contains invalid JSON`;
  }

  private async saveDebugArtifacts(
    tempDir: string,
    result: Awaited<ReturnType<typeof runCodexCli>>,
    purpose: string,
    extractionAttempts: string[]
  ): Promise<void> {
    if (purpose !== "scenario_generation") return;

    try {
      const debugDir = path.join(process.cwd(), ".artifacts", "ai", "scenario_generation", `codex-${Date.now()}`);
      await fs.mkdir(debugDir, { recursive: true });

      await fs.writeFile(path.join(debugDir, "stdout.log"), result.stdout, "utf-8");
      await fs.writeFile(path.join(debugDir, "stderr.log"), result.stderr, "utf-8");
      await fs.writeFile(
        path.join(debugDir, "extraction-attempts.json"),
        JSON.stringify({ attempts: extractionAttempts, exitCode: result.exitCode }, null, 2),
        "utf-8"
      );

      console.log(`[codex-cli] debug artifacts saved to: ${debugDir}`);
    } catch (error) {
      console.error(`[codex-cli] failed to save debug artifacts:`, error);
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

  private async createTempDir(purpose: string): Promise<string> {
    const timestamp = Date.now();
    const purposeDir = purpose === "scenario_generation" ? "scenario" : "repair";
    const tempDir = path.join(process.cwd(), ".artifacts", "ai-provider", "codex", purposeDir, `${timestamp}`);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  private async writeInputFiles(
    tempDir: string,
    outputPath: string,
    promptPath: string,
    systemMessage: string,
    userMessage: string,
    purpose: string
  ): Promise<void> {
    // Write schema for repair and general purposes, not for scenario_generation
    if (purpose !== "scenario_generation") {
      const schemaPath = path.join(tempDir, "repair-decision.schema.json");
      await fs.writeFile(schemaPath, JSON.stringify(REPAIR_DECISION_SCHEMA, null, 2), "utf-8");
    }

    const fileOutputPrompt = purpose === "scenario_generation"
      ? this.buildGenericFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage)
      : this.buildRepairFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage);

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

  private buildRepairFileOutputPrompt(outputPath: string, promptPath: string, systemMessage: string, userMessage: string): string {
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

  private buildGenericFileOutputPrompt(outputPath: string, promptPath: string, systemMessage: string, userMessage: string): string {
    const lines: string[] = [
      "TASK: Write exactly ONE file at the absolute path below with valid JSON.",
      "",
      `OUTPUT FILE (absolute path): ${outputPath}`,
      "",
      "RULES:",
      `- Write EXACTLY one file at: ${outputPath}`,
      "- Do NOT modify any other files",
      "- Do NOT execute shell commands",
      "- Do NOT write markdown or explanations to the file",
      "- Output must be valid JSON (no trailing commas, no comments, no markdown)",
      "- If you need to explain your reasoning, write it as comments OUTSIDE the JSON in stdout",
      "- The JSON file must be parseable with JSON.parse()",
      ""
    ];

    if (systemMessage) {
      lines.push("SYSTEM CONTEXT:", systemMessage, "");
    }

    if (userMessage) {
      lines.push("USER REQUEST:", userMessage, "");
    }

    lines.push(
      "INSTRUCTION: Use the SYSTEM CONTEXT and USER REQUEST above to generate the appropriate JSON response.",
      `Write the JSON object to: ${outputPath}`,
      "You may write explanations or reasoning to stdout, but the file must contain ONLY valid JSON.",
      "",
      "IMPORTANT: Write ONLY valid JSON to the OUTPUT FILE path."
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
}
