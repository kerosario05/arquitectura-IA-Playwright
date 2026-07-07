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

export class CopilotCliProvider {
  public readonly providerType = "copilot_cli" as const;
  public readonly providerName: string;
  public readonly model: string;
  private readonly command: string;
  private readonly extraArgs: string[];
  private readonly timeoutMs: number;
  private readonly allowStdoutJsonFallback: boolean;

  constructor(config: AiProviderConfig) {
    this.providerName = config.providerName;
    this.model = config.model;
    this.command = config.command ?? "copilot";
    this.extraArgs = config.extraArgs ?? [];
    this.timeoutMs = config.timeoutMs;
    this.allowStdoutJsonFallback = config.allowStdoutJsonFallback ?? false;
  }

  private filterModelArgs(args: string[]): string[] {
    const result: string[] = [];
    let i = 0;
    while (i < args.length) {
      if (args[i] === "--model" || args[i] === "-m") {
        i += 2;
      } else {
        result.push(args[i]);
        i++;
      }
    }
    return result;
  }

  private buildCopilotPromptContent(systemMessage: string, userMessage: string): string {
    const parts: string[] = [];
    if (systemMessage) parts.push("SYSTEM:\n" + systemMessage);
    if (userMessage) parts.push("USER:\n" + userMessage);
    parts.push("OUTPUT: Respond with ONLY valid JSON. No explanations, no markdown fences.");
    return parts.join("\n\n");
  }

  private spawnCopilot(
    fullPrompt: string,
    promptPath: string,
    tempDir: string,
    timeoutMs: number
  ): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
    const command = process.env.COPILOT_CLI_COMMAND?.trim() || this.command;
    const filteredExtra = this.filterModelArgs(this.extraArgs);

    // Short prompt that references the file - keep it simple without internal punctuation that confuses shell parsers
    const shortPrompt = `Read prompt.txt and return only valid JSON to stdout. No markdown. No explanations.`;
    const args = ["-p", shortPrompt, "-s", "--model", this.model, "--no-ask-user", ...filteredExtra];
    const env: NodeJS.ProcessEnv = { ...process.env, COPILOT_MODEL: this.model };

    let spawnCmd = command;
    let spawnArgs = args;
    let spawnOptions: any = { env, cwd: tempDir };

    if (process.platform === "win32" && (command.endsWith(".cmd") || command.endsWith(".bat"))) {
      // Pass explicitly to cmd.exe without shell mode - preserves args as independent parameters
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
    const promptPath = path.join(tempDir, "prompt.txt");

    try {
      const systemMessage = request.messages.find(m => m.role === "system")?.content ?? "";
      const userMessage = request.messages.find(m => m.role === "user")?.content ?? "";

      const fullPrompt = this.buildCopilotPromptContent(systemMessage, userMessage);

      // Write full prompt to file to handle long prompts in Windows
      await fs.writeFile(promptPath, fullPrompt, "utf-8");

      const shortPrompt = `Read and follow the instructions in prompt.txt. Return only valid JSON to stdout. Do not include markdown fences or explanations.`;

      if (purpose === "scenario_generation") {
        console.log(`[copilot-cli] purpose=scenario_generation promptMode=file promptChars=${fullPrompt.length} shortPromptChars=${shortPrompt.length}`);
      }

      const result = await this.spawnCopilot(fullPrompt, promptPath, tempDir, this.timeoutMs);
      const durationMs = Date.now() - startedAt;

      if (result.timedOut) {
        throw new AiProviderError("ai_provider_timeout", `AI provider timed out after ${this.timeoutMs}ms`, {
          provider: this.providerName,
          timeoutMs: this.timeoutMs,
          durationMs,
          tempDir,
          promptPath
        });
      }

      if (purpose === "scenario_generation") {
        console.log(`[copilot-cli] exitCode=${result.exitCode} durationMs=${durationMs}`);
        console.log(`[copilot-cli] stdoutChars=${result.stdout?.length ?? 0} stderrChars=${result.stderr?.length ?? 0}`);
      }

      if (result.exitCode !== 0) {
        const stderrPreview = this.sanitizeSecrets(result.stderr).slice(0, 500);
        let artifactDir: string | undefined;
        if (purpose === "scenario_generation") {
          artifactDir = await this.saveDebugArtifacts(result.stdout, result.stderr, "", request.messages, purpose);
        }
        throw new AiProviderError("copilot_cli_execution_failed",
          `Copilot CLI exited with code ${result.exitCode}`, {
          provider: this.providerName,
          purpose,
          exitCode: result.exitCode,
          stderrPreview,
          artifactDir,
          reasonCode: "copilot_cli_execution_failed"
        });
      }

      const stdoutTrimmed = result.stdout?.trim() ?? "";
      if (!stdoutTrimmed) {
        let artifactDir: string | undefined;
        if (purpose === "scenario_generation") {
          artifactDir = await this.saveDebugArtifacts(result.stdout, result.stderr, "", request.messages, purpose);
        }
        throw new AiProviderError("copilot_cli_empty_output",
          "Copilot CLI returned empty stdout", {
          provider: this.providerName,
          purpose,
          exitCode: result.exitCode,
          stderrPreview: this.sanitizeSecrets(result.stderr).slice(0, 500),
          artifactDir,
          reasonCode: "copilot_cli_empty_output"
        });
      }

      // JSON parser only runs when stdout has content
      const extractionResult = await this.extractJsonFromSources(
        result.stdout,
        result.stderr,
        "",
        purpose
      );

      if (!extractionResult.success) {
        let artifactDir: string | undefined;
        if (purpose === "scenario_generation") {
          artifactDir = await this.saveDebugArtifacts(result.stdout, result.stderr, "", request.messages, purpose);
          console.log(`[copilot-cli] parseStrategy failed - saved debug artifacts to ${artifactDir}`);
        }
        throw new AiProviderError("ai_provider_output_missing", this.getOutputMissingErrorMessage(purpose), {
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
          const receivedKeys = (shapeValidation.detectedKeys || []).join(",");
          console.log(
            `[scenarios:ai] invalidShape receivedKeys=${receivedKeys} ` +
            `stdoutChars=${result.stdout.length} parseStrategy=${extractionResult.strategy}`
          );
          const artifactDir = await this.saveDebugArtifacts(result.stdout, result.stderr, "", request.messages, purpose);
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
        console.log(`[copilot-cli] shape validation passed for scenario_generation`);
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

  private async extractJsonFromSources(
    stdout: string,
    stderr: string,
    outputPath: string,
    purpose: string
  ): Promise<{ success: boolean; raw: string; parsed: Record<string, unknown>; strategy: string; attempts: string[] }> {
    const attempts: string[] = [];

    // Strategy 1: Try output file first (preferred for file-based providers)
    try {
      const fileContent = await fs.readFile(outputPath, "utf-8");
      attempts.push("output_file_json");
      const parsed = JSON.parse(fileContent);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        if (purpose === "scenario_generation") {
          console.log(`[copilot-cli] parseStrategy=output_file_json success=true`);
        }
        return { success: true, raw: fileContent, parsed: parsed as Record<string, unknown>, strategy: "output_file_json", attempts };
      }
    } catch {
      // File doesn't exist or invalid JSON, try other sources
    }

    // Strategy 2: Try stdout as direct JSON
    attempts.push("stdout_json");
    const stdoutTrimmed = stdout?.trim() ?? "";
    if (stdoutTrimmed) {
      try {
        const parsed = JSON.parse(stdoutTrimmed);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          if (purpose === "scenario_generation") {
            console.log(`[copilot-cli] parseStrategy=stdout_json success=true`);
          }
          return { success: true, raw: stdoutTrimmed, parsed: parsed as Record<string, unknown>, strategy: "stdout_json", attempts };
        }
      } catch {
        // Not valid JSON, continue
      }
    }

    // Strategy 3: Try fenced JSON block ```json ... ```
    attempts.push("fenced_json");
    const fencedJsonMatch = stdoutTrimmed.match(/```json\s*([\s\S]*?)\s*```/);
    if (fencedJsonMatch) {
      try {
        const parsed = JSON.parse(fencedJsonMatch[1]);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          if (purpose === "scenario_generation") {
            console.log(`[copilot-cli] parseStrategy=fenced_json success=true`);
          }
          return { success: true, raw: fencedJsonMatch[1], parsed: parsed as Record<string, unknown>, strategy: "fenced_json", attempts };
        }
      } catch {
        // Invalid JSON in fenced block
      }
    }

    // Strategy 4: Try generic fenced block ``` ... ```
    attempts.push("fenced_generic");
    const fencedGenericMatch = stdoutTrimmed.match(/```\s*([\s\S]*?)\s*```/);
    if (fencedGenericMatch) {
      try {
        const parsed = JSON.parse(fencedGenericMatch[1]);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          if (purpose === "scenario_generation") {
            console.log(`[copilot-cli] parseStrategy=fenced_generic success=true`);
          }
          return { success: true, raw: fencedGenericMatch[1], parsed: parsed as Record<string, unknown>, strategy: "fenced_generic", attempts };
        }
      } catch {
        // Invalid JSON
      }
    }

    // Strategy 5: Try to find balanced JSON object in stdout
    attempts.push("embedded_json");
    const embeddedJson = this.extractBalancedJson(stdoutTrimmed);
    if (embeddedJson) {
      if (purpose === "scenario_generation") {
        console.log(`[copilot-cli] parseStrategy=embedded_json success=true`);
      }
      return { success: true, raw: embeddedJson.raw, parsed: embeddedJson.parsed, strategy: "embedded_json", attempts };
    }

    // All strategies failed
    if (purpose === "scenario_generation") {
      console.log(`[copilot-cli] parseStrategy=all_failed attempts=${attempts.join(",")}`);
      console.log(`[copilot-cli] stdoutPreview="${this.sanitizeSecrets(stdoutTrimmed).slice(0, 500)}"`);
    }

    return { success: false, raw: "", parsed: {}, strategy: "none", attempts };
  }

  private extractBalancedJson(text: string): { raw: string; parsed: Record<string, unknown> } | null {
    if (!text) return null;

    // Find first opening brace
    const startIndex = text.indexOf("{");
    if (startIndex === -1) return null;

    // Find matching closing brace
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
          // Found balanced JSON
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

    // Check for expected scenario generation shape
    const hasScenarios = "scenarios" in json;
    const hasStories = "stories" in json;
    const hasRejected = "rejected" in json;

    // Valid if it has scenarios or stories (some variations)
    if (hasScenarios || hasStories) {
      return { valid: true, reason: "", detectedKeys: keys };
    }

    // Also valid if it only has rejected (all blocked)
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
    outputPath: string,
    messages: AiMessage[],
    purpose: string
  ): Promise<string> {
    try {
      const timestamp = Date.now();
      const artifactDir = path.join(process.cwd(), ".artifacts", "ai", purpose, `${timestamp}`);
      await fs.mkdir(artifactDir, { recursive: true });

      // Save stdout
      if (stdout) {
        await fs.writeFile(path.join(artifactDir, "stdout.txt"), stdout, "utf-8");
      }

      // Save stderr
      if (stderr) {
        await fs.writeFile(path.join(artifactDir, "stderr.txt"), stderr, "utf-8");
      }

      // Save messages (sanitized)
      const sanitizedMessages = messages.map(m => ({
        role: m.role,
        content: this.sanitizeSecrets(m.content)
      }));
      await fs.writeFile(
        path.join(artifactDir, "messages.json"),
        JSON.stringify(sanitizedMessages, null, 2),
        "utf-8"
      );

      // Try to copy output file if it exists
      try {
        const outputContent = await fs.readFile(outputPath, "utf-8");
        await fs.writeFile(path.join(artifactDir, path.basename(outputPath)), outputContent, "utf-8");
      } catch {
        // Output file doesn't exist, that's fine
      }

      return artifactDir;
    } catch (error) {
      console.error(`[copilot-cli] Failed to save debug artifacts: ${error}`);
      return "";
    }
  }

  private async createTempDir(): Promise<string> {
    const timestamp = Date.now();
    const tempDir = path.join(process.cwd(), ".artifacts", "ai-provider", "copilot", `${timestamp}`);
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
    // Only write schema for repair purpose
    if (purpose === "repair") {
      const schemaPath = path.join(tempDir, "repair-decision.schema.json");
      await fs.writeFile(schemaPath, JSON.stringify(REPAIR_DECISION_SCHEMA, null, 2), "utf-8");
    }

    const fileOutputPrompt = this.buildFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage, purpose);
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

  private buildFileOutputPrompt(outputPath: string, promptPath: string, systemMessage: string, userMessage: string, purpose: string): string {
    if (purpose === "repair") {
      return this.buildRepairFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage);
    }

    return this.buildGenericFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage);
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
      "CRITICAL RULES FOR JSON OUTPUT:",
      `- Write EXACTLY one file at: ${outputPath}`,
      "- Return ONLY valid JSON",
      "- Do NOT include markdown fences (no ```json)",
      "- Do NOT include explanations before or after the JSON",
      "- Do NOT include prose or commentary",
      "- JSON must be parseable by JSON.parse",
      "- Use proper JSON syntax: double quotes for strings, no trailing commas, no comments",
      "- Do NOT write to stdout as the primary output (file output is required)",
      "- Do NOT modify any other files",
      "- Do NOT execute shell commands",
      "",
      "If you encounter an error or cannot complete the task:",
      '- Return a minimal valid JSON object with empty arrays/defaults',
      '- Example: {"scenarios":[],"rejected":[{"sourceIssueKey":"N/A","reason":"Unable to process"}]}',
      ""
    ];

    if (systemMessage) {
      lines.push("SYSTEM CONTEXT:", systemMessage, "");
    }

    if (userMessage) {
      lines.push("USER REQUEST:", userMessage, "");
    }

    lines.push(
      "",
      "INSTRUCTION: Analyze the SYSTEM CONTEXT and USER REQUEST above, then generate the appropriate JSON response.",
      `Write the JSON object to: ${outputPath}`,
      "Do NOT write any other files. Do NOT write explanations.",
      "",
      "IMPORTANT: The file must contain ONLY valid JSON. No text before or after the JSON object."
    );

    return lines.join("\n");
  }

  private getOutputFileName(purpose: string): string {
    switch (purpose) {
      case "repair":
        return "repair-decision.json";
      case "scenario_generation":
        return "scenario-generation-result.json";
      default:
        return "ai-response.json";
    }
  }

  private getOutputMissingErrorMessage(purpose: string): string {
    switch (purpose) {
      case "repair":
        return "AI provider did not write repair-decision.json";
      case "scenario_generation":
        return "AI provider did not return valid scenario JSON";
      default:
        return "AI provider did not write expected output file";
    }
  }

  private getInvalidJsonErrorMessage(purpose: string): string {
    const fileName = this.getOutputFileName(purpose);
    switch (purpose) {
      case "repair":
        return `${fileName} contains invalid JSON`;
      case "scenario_generation":
        return "AI provider returned invalid scenario JSON";
      default:
        return `${fileName} contains invalid JSON`;
    }
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

    // Try to extract JSON from markdown code fence
    const fencedMatch = trimmed.match(/```json\s*([\s\S]*?)\s*```/);
    if (fencedMatch) {
      try {
        const parsed = JSON.parse(fencedMatch[1]);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          return { raw: fencedMatch[1], parsed: parsed as Record<string, unknown> };
        }
      } catch {
        // Invalid JSON in fenced block
      }
    }

    // Try to find any JSON object pattern { ... } in stdout
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
