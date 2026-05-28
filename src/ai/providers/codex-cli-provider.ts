import { AiProviderError, type AiCompletionRequest, type AiCompletionResponse, type AiProviderConfig } from "../ai-provider.types";
import { parseJsonObjectText } from "../ai-json-validator";
import { resolveCodexCliPath } from "../../agent/codex-cli-resolver";
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

  constructor(config: AiProviderConfig) {
    this.providerName = config.providerName;
    this.model = config.model;
    this.command = config.command ?? "codex";
    this.extraArgs = config.extraArgs ?? [];
    this.timeoutMs = config.timeoutMs;
  }

  async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const startedAt = Date.now();
    const workDir = await this.createWorkDir();

    try {
      // Construir mensajes
      const systemMessage = request.messages.find(m => m.role === "system")?.content ?? "";
      const userMessage = request.messages.find(m => m.role === "user")?.content ?? "";
      const fullPrompt = [systemMessage, userMessage].filter(Boolean).join("\n");

      // Escribir archivos de entrada
      await this.writeInputFiles(workDir, fullPrompt);

      // Construir prompt para Codex (modo file-output)
      const codexPrompt = this.buildFileOutputPrompt(workDir);

      // Ejecutar Codex CLI
      const runnerInput: CodexCliRunnerInput = {
        command: this.command,
        extraArgs: ["--model", this.model, ...this.extraArgs],
        prompt: codexPrompt,
        cwd: workDir,
        timeoutMs: this.timeoutMs
      };

      const result = await runCodexCli(runnerInput);
      const durationMs = Date.now() - startedAt;

      // Manejar timeout
      if (result.timedOut) {
        throw new AiProviderError("ai_provider_timeout", `Codex CLI timed out after ${this.timeoutMs}ms`, {
          timeoutMs: this.timeoutMs,
          durationMs
        });
      }

      // Manejar error de proceso
      if (result.exitCode !== 0) {
        const sanitizedStderr = this.sanitizeSecrets(result.stderr);
        throw new AiProviderError("ai_provider_process_error", `Codex CLI exited with code ${result.exitCode}`, {
          exitCode: result.exitCode,
          stderr: sanitizedStderr.slice(0, 500)
        });
      }

      // Leer archivo de salida
      const outputPath = path.join(workDir, "repair-decision.json");
      let outputContent: string;
      try {
        outputContent = await fs.readFile(outputPath, "utf-8");
      } catch (error) {
        throw new AiProviderError("ai_provider_output_missing", "Codex did not write repair-decision.json file", {
          workDir,
          stdoutPreview: this.sanitizeSecrets(result.stdout).slice(0, 200)
        });
      }

      // Validar JSON
      let parsedJson: Record<string, unknown>;
      try {
        parsedJson = parseJsonObjectText(outputContent);
      } catch (error) {
        throw new AiProviderError("ai_provider_invalid_json", "repair-decision.json contains invalid JSON", {
          error: error instanceof Error ? error.message : String(error),
          filePreview: outputContent.slice(0, 500)
        });
      }

      return {
        rawText: outputContent,
        parsedJson,
        model: this.model,
        providerName: this.providerName,
        durationMs
      };
    } finally {
      // Limpiar directorio temporal
      await this.cleanupWorkDir(workDir);
    }
  }

  private async createWorkDir(): Promise<string> {
    const timestamp = Date.now();
    const workDir = path.join(process.cwd(), ".artifacts", "ai-provider", "codex", `${timestamp}`);
    await fs.mkdir(workDir, { recursive: true });
    return workDir;
  }

  private async writeInputFiles(workDir: string, prompt: string): Promise<void> {
    // Escribir schema para referencia
    const schemaPath = path.join(workDir, "repair-decision.schema.json");
    await fs.writeFile(schemaPath, JSON.stringify(REPAIR_DECISION_SCHEMA, null, 2), "utf-8");

    // Escribir prompt para referencia
    const promptPath = path.join(workDir, "prompt.txt");
    await fs.writeFile(promptPath, prompt, "utf-8");

    // Extraer context-pack del prompt si existe
    const contextPackMatch = prompt.match(/\{[\s\S]*"appSlug"[\s\S]*\}/);
    if (contextPackMatch) {
      const contextPackPath = path.join(workDir, "context-pack.json");
      try {
        const contextPack = JSON.parse(contextPackMatch[0]);
        await fs.writeFile(contextPackPath, JSON.stringify(contextPack, null, 2), "utf-8");
      } catch {
        // Ignorar si no se puede parsear
      }
    }
  }

  private buildFileOutputPrompt(workDir: string): string {
    return [
      "TASK: Read context-pack.json and write ONLY repair-decision.json",
      "",
      "RULES:",
      "- Write ONLY the file: repair-decision.json",
      "- Do NOT modify any other files",
      "- Do NOT execute shell commands",
      "- Do NOT write markdown or explanations",
      "- Do NOT write to stdout",
      "- Output must be valid JSON matching repair-decision.schema.json",
      "",
      "REQUIRED FIELDS in repair-decision.json:",
      "- decision: one of [repaired_plan, no_safe_action, needs_more_context]",
      "- reason: string explaining the decision",
      "",
      "OPTIONAL FIELDS:",
      "- repairType, candidateId, evidenceId, assertionStatus, selectionStatus, confidence, questions",
      "",
      "EXAMPLE OUTPUT (repair-decision.json):",
      '{"decision":"no_safe_action","reason":"No safe candidate matches the intent without user confirmation."}',
      "",
      "IMPORTANT: Write ONLY repair-decision.json. Nothing else."
    ].join("\n");
  }

  private async cleanupWorkDir(workDir: string): Promise<void> {
    try {
      await fs.rm(workDir, { recursive: true, force: true });
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
