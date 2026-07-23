import { spawn as nodeSpawn } from "node:child_process";
import { AiProviderError, type AiCompletionRequest, type AiCompletionResponse, type AiProviderConfig, type AiMessage } from "../ai-provider.types";
import * as path from "node:path";
import * as fs from "node:fs/promises";

// Test seam: allows unit tests to replace spawn without spawning real processes.
let spawnFn: typeof nodeSpawn = nodeSpawn;
export function __setSpawnForTesting(fn: typeof nodeSpawn): void {
  spawnFn = fn;
}

const SENSITIVE_PATTERNS = [
  /api[_-]?key\s*[=:]\s*\S+/gi,
  /password\s*[=:]\s*\S+/gi,
  /secret\s*[=:]\s*\S+/gi,
  /token\s*[=:]\s*\S+/gi,
  /Bearer\s+\S+/gi,
  /Basic\s+\S+/gi
];

// Tools the CLI must not use for a stateless completion request - this provider only wants
// text back on stdout, never file/shell side effects against the repo it happens to run in.
const DEFAULT_DISALLOWED_TOOLS = "Bash,Write,Edit,NotebookEdit";

export class ClaudeCliProvider {
  public readonly providerType = "claude_cli" as const;
  public readonly providerName: string;
  public readonly model: string;
  private readonly command: string;
  private readonly extraArgs: string[];
  private readonly timeoutMs: number;

  constructor(config: AiProviderConfig) {
    this.providerName = config.providerName;
    this.model = config.model;
    this.command = config.command ?? "claude";
    this.extraArgs = config.extraArgs ?? [];
    this.timeoutMs = config.timeoutMs;
  }

  private buildPromptContent(systemMessage: string, userMessage: string): string {
    const parts: string[] = [];
    if (systemMessage) parts.push("SYSTEM:\n" + systemMessage);
    if (userMessage) parts.push("USER:\n" + userMessage);
    parts.push("OUTPUT: Respond with ONLY valid JSON. No explanations, no markdown fences, no tool calls.");
    return parts.join("\n\n");
  }

  private spawnClaude(
    prompt: string,
    cwd: string,
    timeoutMs: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    const command = process.env.CLAUDE_CLI_COMMAND?.trim() || this.command;
    const args = [
      "-p",
      "--output-format", "text",
      "--model", this.model,
      "--disallowedTools", DEFAULT_DISALLOWED_TOOLS,
      ...this.extraArgs
    ];
    const env: NodeJS.ProcessEnv = { ...process.env };

    let spawnCmd = command;
    let spawnArgs = args;
    let spawnOptions: any = { env, cwd };

    if (process.platform === "win32" && (command.endsWith(".cmd") || command.endsWith(".bat"))) {
      spawnCmd = "cmd.exe";
      spawnArgs = ["/d", "/s", "/c", command, ...args];
      spawnOptions.windowsHide = true;
    }

    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const child = spawnFn(spawnCmd, spawnArgs, spawnOptions);

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdin.on("error", () => { /* ignore EPIPE if the process exits early */ });
      child.stdin.write(prompt, "utf-8");
      child.stdin.end();

      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8"); });
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8"); });

      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({ exitCode: code ?? 1, stdout, stderr, timedOut });
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({ exitCode: 1, stdout, stderr: stderr + err.message, timedOut });
      });
    });
  }

  async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const startedAt = Date.now();
    const tempDir = await this.createTempDir();
    const purpose = request.purpose ?? "general";

    try {
      const systemMessage = request.messages.find(m => m.role === "system")?.content ?? "";
      const userMessage = request.messages.find(m => m.role === "user")?.content ?? "";
      const fullPrompt = this.buildPromptContent(systemMessage, userMessage);

      if (purpose === "scenario_generation") {
        console.log(`[claude-cli] purpose=scenario_generation promptChars=${fullPrompt.length}`);
      }

      const result = await this.spawnClaude(fullPrompt, tempDir, this.timeoutMs);
      const durationMs = Date.now() - startedAt;

      if (result.timedOut) {
        throw new AiProviderError("ai_provider_timeout", `AI provider timed out after ${this.timeoutMs}ms`, {
          provider: this.providerName,
          timeoutMs: this.timeoutMs,
          durationMs
        });
      }

      if (purpose === "scenario_generation") {
        console.log(`[claude-cli] exitCode=${result.exitCode} durationMs=${durationMs}`);
        console.log(`[claude-cli] stdoutChars=${result.stdout?.length ?? 0} stderrChars=${result.stderr?.length ?? 0}`);
      }

      if (result.exitCode !== 0) {
        const stderrPreview = this.sanitizeSecrets(result.stderr).slice(0, 500);
        let artifactDir: string | undefined;
        if (purpose === "scenario_generation") {
          artifactDir = await this.saveDebugArtifacts(result.stdout, result.stderr, request.messages, purpose);
        }
        throw new AiProviderError("claude_cli_execution_failed",
          `Claude CLI exited with code ${result.exitCode}`, {
          provider: this.providerName,
          purpose,
          exitCode: result.exitCode,
          stderrPreview,
          artifactDir,
          reasonCode: "claude_cli_execution_failed"
        });
      }

      const stdoutTrimmed = result.stdout?.trim() ?? "";
      if (!stdoutTrimmed) {
        let artifactDir: string | undefined;
        if (purpose === "scenario_generation") {
          artifactDir = await this.saveDebugArtifacts(result.stdout, result.stderr, request.messages, purpose);
        }
        throw new AiProviderError("claude_cli_empty_output",
          "Claude CLI returned empty stdout", {
          provider: this.providerName,
          purpose,
          exitCode: result.exitCode,
          stderrPreview: this.sanitizeSecrets(result.stderr).slice(0, 500),
          artifactDir,
          reasonCode: "claude_cli_empty_output"
        });
      }

      const extractionResult = this.extractJsonFromSources(result.stdout);

      if (!extractionResult.success) {
        let artifactDir: string | undefined;
        if (purpose === "scenario_generation") {
          artifactDir = await this.saveDebugArtifacts(result.stdout, result.stderr, request.messages, purpose);
          console.log(`[claude-cli] parseStrategy failed - saved debug artifacts to ${artifactDir}`);
        }
        throw new AiProviderError("ai_provider_output_missing", "Claude CLI did not return valid JSON", {
          provider: this.providerName,
          purpose,
          artifactDir,
          exitCode: result.exitCode,
          stdoutPreview: this.sanitizeSecrets(result.stdout).slice(0, 500),
          stderrPreview: this.sanitizeSecrets(result.stderr).slice(0, 500),
          extractionAttempts: extractionResult.attempts
        });
      }

      if (purpose === "scenario_generation") {
        const shapeValidation = this.validateScenarioShape(extractionResult.parsed);
        if (!shapeValidation.valid) {
          const artifactDir = await this.saveDebugArtifacts(result.stdout, result.stderr, request.messages, purpose);
          throw new AiProviderError("ai_provider_invalid_json",
            `AI provider returned JSON but scenario shape is invalid: ${shapeValidation.reason}`, {
            provider: this.providerName,
            purpose,
            artifactDir,
            exitCode: result.exitCode,
            detectedKeys: shapeValidation.detectedKeys,
            expectedKeys: ["scenarios", "rejected"],
            jsonPreview: JSON.stringify(extractionResult.parsed).slice(0, 500)
          });
        }
      }

      return {
        rawText: extractionResult.raw,
        parsedJson: extractionResult.parsed,
        model: this.model,
        providerName: this.providerName,
        durationMs
      };
    } finally {
      await this.cleanupTempDir(tempDir);
    }
  }

  private extractJsonFromSources(
    stdout: string
  ): { success: boolean; raw: string; parsed: Record<string, unknown>; attempts: string[] } {
    const attempts: string[] = [];
    const stdoutTrimmed = stdout?.trim() ?? "";

    attempts.push("stdout_json");
    if (stdoutTrimmed) {
      try {
        const parsed = JSON.parse(stdoutTrimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return { success: true, raw: stdoutTrimmed, parsed: parsed as Record<string, unknown>, attempts };
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    attempts.push("fenced_json");
    const fencedJsonMatch = stdoutTrimmed.match(/```json\s*([\s\S]*?)\s*```/);
    if (fencedJsonMatch) {
      try {
        const parsed = JSON.parse(fencedJsonMatch[1]);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return { success: true, raw: fencedJsonMatch[1], parsed: parsed as Record<string, unknown>, attempts };
        }
      } catch {
        // Invalid JSON in fenced block
      }
    }

    attempts.push("fenced_generic");
    const fencedGenericMatch = stdoutTrimmed.match(/```\s*([\s\S]*?)\s*```/);
    if (fencedGenericMatch) {
      try {
        const parsed = JSON.parse(fencedGenericMatch[1]);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return { success: true, raw: fencedGenericMatch[1], parsed: parsed as Record<string, unknown>, attempts };
        }
      } catch {
        // Invalid JSON
      }
    }

    attempts.push("embedded_json");
    const embeddedJson = this.extractBalancedJson(stdoutTrimmed);
    if (embeddedJson) {
      return { success: true, raw: embeddedJson.raw, parsed: embeddedJson.parsed, attempts };
    }

    return { success: false, raw: "", parsed: {}, attempts };
  }

  private extractBalancedJson(text: string): { raw: string; parsed: Record<string, unknown> } | null {
    if (!text) return null;

    const startIndex = text.indexOf("{");
    if (startIndex === -1) return null;

    let depth = 0;
    let inString = false;
    let escapeNext = false;

    for (let i = startIndex; i < text.length; i++) {
      const char = text[i];

      if (escapeNext) {
        escapeNext = false;
        continue;
      }

      if (char === "\\") {
        escapeNext = true;
        continue;
      }

      if (char === '"' && !escapeNext) {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{") depth++;
      if (char === "}") {
        depth--;
        if (depth === 0) {
          const jsonStr = text.substring(startIndex, i + 1);
          try {
            const parsed = JSON.parse(jsonStr);
            if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
              return { raw: jsonStr, parsed: parsed as Record<string, unknown> };
            }
          } catch {
            // Invalid JSON, keep looking
          }
        }
      }
    }

    return null;
  }

  private validateScenarioShape(json: Record<string, unknown>): { valid: boolean; reason: string; detectedKeys: string[] } {
    const keys = Object.keys(json);

    const hasScenarios = "scenarios" in json;
    const hasStories = "stories" in json;
    const hasRejected = "rejected" in json;

    if (hasScenarios || hasStories) {
      return { valid: true, reason: "", detectedKeys: keys };
    }

    if (hasRejected && keys.length <= 3) {
      return { valid: true, reason: "", detectedKeys: keys };
    }

    return {
      valid: false,
      reason: `Missing expected keys. Found: ${keys.join(", ")}. Expected: scenarios, rejected`,
      detectedKeys: keys
    };
  }

  private async saveDebugArtifacts(
    stdout: string,
    stderr: string,
    messages: AiMessage[],
    purpose: string
  ): Promise<string> {
    try {
      const timestamp = Date.now();
      const artifactDir = path.join(process.cwd(), ".artifacts", "ai", purpose, `${timestamp}`);
      await fs.mkdir(artifactDir, { recursive: true });

      if (stdout) {
        await fs.writeFile(path.join(artifactDir, "stdout.txt"), stdout, "utf-8");
      }
      if (stderr) {
        await fs.writeFile(path.join(artifactDir, "stderr.txt"), stderr, "utf-8");
      }

      const sanitizedMessages = messages.map(m => ({
        role: m.role,
        content: this.sanitizeSecrets(m.content)
      }));
      await fs.writeFile(
        path.join(artifactDir, "messages.json"),
        JSON.stringify(sanitizedMessages, null, 2),
        "utf-8"
      );

      return artifactDir;
    } catch (error) {
      console.error(`[claude-cli] Failed to save debug artifacts: ${error}`);
      return "";
    }
  }

  private async createTempDir(): Promise<string> {
    const timestamp = Date.now();
    const tempDir = path.join(process.cwd(), ".artifacts", "ai-provider", "claude", `${timestamp}`);
    await fs.mkdir(tempDir, { recursive: true });
    return tempDir;
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
}
