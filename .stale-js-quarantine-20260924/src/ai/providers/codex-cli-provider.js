"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodexCliProvider = void 0;
exports.__setRunCodexCliForTesting = __setRunCodexCliForTesting;
const ai_provider_types_1 = require("../ai-provider.types");
const codex_cli_runner_1 = require("../../agent/codex-cli-runner");
const json_output_extractor_1 = require("../json-output-extractor");
const path = __importStar(require("node:path"));
const fs = __importStar(require("node:fs/promises"));
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
function isRepairPurpose(purpose) {
    return purpose === "repair" || purpose === "general" || purpose.includes("repair");
}
function isSupportedCodexPurpose(purpose) {
    return purpose === "scenario_generation"
        || purpose === "spec_generation"
        || purpose === "scenario_data_semantic_enrichment"
        || purpose === "canonical_scenario_semantic_normalization"
        || isRepairPurpose(purpose);
}
let runCodexCliFn = codex_cli_runner_1.runCodexCli;
function __setRunCodexCliForTesting(fn) {
    runCodexCliFn = fn;
}
class CodexCliProvider {
    providerType = "codex_cli";
    providerName;
    model;
    command;
    extraArgs;
    timeoutMs;
    reasoningEffort;
    constructor(config) {
        this.providerName = config.providerName;
        this.model = config.model;
        this.command = config.command ?? "codex";
        this.extraArgs = config.extraArgs ?? [];
        this.timeoutMs = config.timeoutMs;
        this.reasoningEffort = config.reasoningEffort;
    }
    buildFinalExtraArgs(purpose) {
        const hasModelFlag = this.extraArgs.some((arg, i) => {
            return arg === "--model" || arg === "-m" || (i > 0 && (this.extraArgs[i - 1] === "--model" || this.extraArgs[i - 1] === "-m"));
        });
        let args = hasModelFlag ? [...this.extraArgs] : this.model ? ["--model", this.model, ...this.extraArgs] : [...this.extraArgs];
        if (purpose !== "spec_generation" || !this.reasoningEffort)
            return args;
        const reasoningPrefix = "model_reasoning_effort=";
        const existing = args.find((arg) => arg.startsWith(reasoningPrefix));
        const expected = `${reasoningPrefix}${this.reasoningEffort}`;
        if (existing && existing !== expected) {
            throw new ai_provider_types_1.AiProviderError("ai_provider_config_missing", `Conflicting Codex reasoning effort: ${existing}`);
        }
        if (!existing)
            args = [...args, "-c", expected];
        return args;
    }
    async completeJson(request) {
        const startedAt = Date.now();
        const purpose = request.purpose ?? "general";
        if (!isSupportedCodexPurpose(purpose)) {
            throw new ai_provider_types_1.AiProviderError("ai_provider_unsupported", `Unsupported Codex task purpose "${purpose}"`);
        }
        const tempDir = await this.createTempDir(purpose);
        const outputFileName = this.getOutputFileName(purpose);
        const outputPath = path.join(tempDir, outputFileName);
        const promptPath = path.join(tempDir, "prompt.txt");
        const stdoutLogPath = path.join(tempDir, "codex-stdout.log");
        const stderrLogPath = path.join(tempDir, "codex-stderr.log");
        let processExitedNonZero = false;
        let processResult = null;
        try {
            const systemMessage = request.messages.find(m => m.role === "system")?.content ?? "";
            const userMessage = request.messages.find(m => m.role === "user")?.content ?? "";
            await this.writeInputFiles(tempDir, outputPath, promptPath, systemMessage, userMessage, purpose, request.jsonSchema);
            const shortPrompt = `Read and follow the instructions in "${promptPath}". Write the output file exactly as instructed.`;
            const finalExtraArgs = this.buildFinalExtraArgs(purpose);
            if (purpose === "spec_generation") {
                console.log(`[ai-spec] provider=${this.providerName} model=${this.model} reasoningEffort=${this.reasoningEffort ?? "default"} timeoutMs=${this.timeoutMs}`);
            }
            const runnerInput = {
                command: this.command,
                extraArgs: finalExtraArgs,
                prompt: shortPrompt,
                cwd: tempDir,
                timeoutMs: this.timeoutMs,
                taskType: (purpose === "scenario_generation" || purpose === "spec_generation")
                    ? "generation"
                    : (purpose.includes("repair") ? "repair" : "unknown"),
                purpose,
                stdoutLogPath,
                stderrLogPath
            };
            const result = await runCodexCliFn(runnerInput);
            processResult = result;
            const durationMs = Date.now() - startedAt;
            // Log diagnostics for generation purposes
            if (purpose === "scenario_generation" || purpose === "spec_generation") {
                console.log(`[codex-cli] purpose=${purpose} exitCode=${result.exitCode} durationMs=${durationMs}`);
                console.log(`[codex-cli] stdoutChars=${result.stdout?.length ?? 0} stderrChars=${result.stderr?.length ?? 0}`);
            }
            if (result.timedOut) {
                throw new ai_provider_types_1.AiProviderError("ai_provider_timeout", `AI provider timed out after ${this.timeoutMs}ms`, {
                    provider: this.providerName,
                    timeoutMs: this.timeoutMs,
                    durationMs,
                    tempDir,
                    promptPath,
                    outputPath
                });
            }
            // Use shared JSON extractor for robust extraction
            const extractionSource = {
                stdout: result.stdout,
                stderr: result.stderr,
                outputFilePath: outputPath
            };
            const extractionResult = await (0, json_output_extractor_1.extractJsonFromSources)(extractionSource, purpose, "codex-cli");
            if (!extractionResult.success) {
                processExitedNonZero = result.exitCode !== 0 || processExitedNonZero;
                // If the CLI exited non-zero and emitted a protocol error/turn.failed event,
                // propagate the real technical error instead of treating stdout as a result.
                const technicalFailure = result.exitCode !== 0
                    ? this.extractCodexFailureMessage(result.stdout)
                    : undefined;
                if (technicalFailure) {
                    await this.saveDebugArtifacts(tempDir, result, purpose, extractionResult.attempts);
                    throw new ai_provider_types_1.AiProviderError("ai_provider_execution_failed", technicalFailure, {
                        provider: this.providerName,
                        tempDir,
                        exitCode: result.exitCode,
                        stdoutPreview: this.sanitizeSecrets(result.stdout).slice(0, 1000),
                        stderrPreview: this.sanitizeSecrets(result.stderr).slice(0, 1000)
                    });
                }
                // Enhanced diagnostics for scenario generation failures
                const stderrLower = result.stderr.toLowerCase();
                const stdoutLower = result.stdout.toLowerCase();
                // Detect common error patterns
                const isModelError = stderrLower.includes("unsupported model") ||
                    stderrLower.includes("invalid model") ||
                    stderrLower.includes("model not found") ||
                    stderrLower.includes("model") && stderrLower.includes("not supported");
                const isAuthError = stderrLower.includes("unauthorized") ||
                    stderrLower.includes("authentication") ||
                    stderrLower.includes("api key");
                const isRateLimitError = stderrLower.includes("rate limit") ||
                    stderrLower.includes("429") ||
                    stderrLower.includes("quota exceeded");
                // Build actionable suggestions
                const suggestions = [];
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
                    console.log(`[codex-cli] scenario_generation failed exitCode=${result.exitCode} ` +
                        `modelError=${isModelError} authError=${isAuthError} rateLimitError=${isRateLimitError}`);
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
                throw new ai_provider_types_1.AiProviderError("ai_provider_output_missing", errorMessage, errorDetails);
            }
            // Validate scenario shape for scenario_generation
            if (purpose === "scenario_generation") {
                const shapeValidation = (0, json_output_extractor_1.validateScenarioShape)(extractionResult.parsed);
                if (!shapeValidation.valid) {
                    processExitedNonZero = result.exitCode !== 0 || processExitedNonZero;
                    await this.saveDebugArtifacts(tempDir, result, purpose, extractionResult.attempts);
                    throw new ai_provider_types_1.AiProviderError("ai_provider_invalid_json", `Scenario generation JSON has invalid shape: ${shapeValidation.reason}`, {
                        provider: this.providerName,
                        tempDir,
                        exitCode: result.exitCode,
                        detectedKeys: shapeValidation.detectedKeys,
                        extractionStrategy: extractionResult.strategy
                    });
                }
            }
            // Validate spec generation shape for spec_generation (fail closed)
            if (purpose === "spec_generation") {
                const specShapeValidation = (0, json_output_extractor_1.validateSpecOutputShape)(extractionResult.parsed);
                if (!specShapeValidation.valid) {
                    processExitedNonZero = result.exitCode !== 0 || processExitedNonZero;
                    await this.saveDebugArtifacts(tempDir, result, purpose, extractionResult.attempts);
                    throw new ai_provider_types_1.AiProviderError("ai_provider_invalid_json", `Spec generation JSON has invalid shape: ${specShapeValidation.reason}`, {
                        provider: this.providerName,
                        tempDir,
                        exitCode: result.exitCode,
                        detectedKeys: specShapeValidation.detectedKeys,
                        extractionStrategy: extractionResult.strategy
                    });
                }
            }
            // Report where the structured output was recovered from and whether
            // fallback-to-stdout recovery required an extra AI invocation.
            const recoveredFromResultFile = extractionResult.strategy === "output_file_json";
            const outputSource = recoveredFromResultFile ? "result_file" : "stdout";
            console.log(`[codex-output] source=${outputSource} schemaValid=true`);
            if (!recoveredFromResultFile) {
                console.log(`[codex-output] recovered=true extraAiInvocation=false`);
            }
            if (result.exitCode !== 0) {
                processExitedNonZero = true;
                return {
                    rawText: extractionResult.raw,
                    parsedJson: extractionResult.parsed,
                    model: this.model,
                    providerName: this.providerName,
                    durationMs,
                    usage: result.usage,
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
                durationMs,
                usage: result.usage
            };
        }
        catch (error) {
            if (processExitedNonZero && processResult) {
                await this.preserveArtifactsOnError(tempDir, processResult, stdoutLogPath, stderrLogPath);
            }
            throw error;
        }
        finally {
            if (!processExitedNonZero) {
                await this.cleanupTempDir(tempDir);
            }
        }
    }
    getOutputFileName(purpose) {
        if (purpose === "scenario_generation") {
            return "scenario-generation-result.json";
        }
        if (purpose === "spec_generation") {
            return "spec-generation-result.json";
        }
        if (purpose === "scenario_data_semantic_enrichment") {
            return "semantic-enrichment-result.json";
        }
        if (purpose === "canonical_scenario_semantic_normalization") {
            return "canonical-semantic-normalization-result.json";
        }
        // Default to repair-decision.json for repair and general purposes
        return "repair-decision.json";
    }
    getOutputMissingErrorMessage(purpose, fileName) {
        if (purpose === "scenario_generation" || purpose === "spec_generation") {
            return `AI provider did not write ${fileName}. Check artifacts at tempDir for stdout/stderr logs.`;
        }
        return `AI provider did not write ${fileName}`;
    }
    getInvalidJsonErrorMessage(purpose, fileName) {
        if (purpose === "scenario_generation" || purpose === "spec_generation") {
            return `${fileName} contains invalid JSON. Check artifacts for raw output.`;
        }
        return `${fileName} contains invalid JSON`;
    }
    async saveDebugArtifacts(tempDir, result, purpose, extractionAttempts) {
        if (purpose !== "scenario_generation" && purpose !== "spec_generation")
            return;
        try {
            const debugPurpose = purpose === "spec_generation" ? "spec_generation" : "scenario_generation";
            const debugDir = path.join(process.cwd(), ".artifacts", "ai", debugPurpose, `codex-${Date.now()}`);
            await fs.mkdir(debugDir, { recursive: true });
            await fs.writeFile(path.join(debugDir, "stdout.log"), result.stdout, "utf-8");
            await fs.writeFile(path.join(debugDir, "stderr.log"), result.stderr, "utf-8");
            await fs.writeFile(path.join(debugDir, "extraction-attempts.json"), JSON.stringify({ attempts: extractionAttempts, exitCode: result.exitCode }, null, 2), "utf-8");
            console.log(`[codex-cli] debug artifacts saved to: ${debugDir}`);
        }
        catch (error) {
            console.error(`[codex-cli] failed to save debug artifacts:`, error);
        }
    }
    async preserveArtifactsOnError(tempDir, result, stdoutLogPath, stderrLogPath) {
        try {
            if (result.stdout && !await this.fileExists(stdoutLogPath)) {
                await fs.writeFile(stdoutLogPath, result.stdout, "utf-8");
            }
            if (result.stderr && !await this.fileExists(stderrLogPath)) {
                await fs.writeFile(stderrLogPath, result.stderr, "utf-8");
            }
        }
        catch {
            // Ignorar errores al preservar artifacts
        }
    }
    async fileExists(p) {
        try {
            await fs.access(p);
            return true;
        }
        catch {
            return false;
        }
    }
    async createTempDir(purpose) {
        const timestamp = Date.now();
        const purposeDir = purpose === "scenario_generation"
            ? "scenario"
            : (purpose === "spec_generation"
                ? "spec"
                : (purpose === "canonical_scenario_semantic_normalization" ? "canonical-semantic" : "repair"));
        const tempDir = path.join(process.cwd(), ".artifacts", "ai-provider", "codex", purposeDir, `${timestamp}`);
        await fs.mkdir(tempDir, { recursive: true });
        return tempDir;
    }
    async writeInputFiles(tempDir, outputPath, promptPath, systemMessage, userMessage, purpose, jsonSchema) {
        // Only repair tasks use the repair decision schema.
        if (isRepairPurpose(purpose)) {
            const schemaPath = path.join(tempDir, "repair-decision.schema.json");
            await fs.writeFile(schemaPath, JSON.stringify(REPAIR_DECISION_SCHEMA, null, 2), "utf-8");
        }
        const fileOutputPrompt = !isRepairPurpose(purpose)
            ? this.buildGenericFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage, jsonSchema)
            : this.buildRepairFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage);
        await fs.writeFile(promptPath, fileOutputPrompt, "utf-8");
        const contextPackMatch = userMessage.match(/\{[\s\S]*"appSlug"[\s\S]*\}/);
        if (contextPackMatch) {
            const contextPackPath = path.join(tempDir, "context-pack.json");
            try {
                const contextPack = JSON.parse(contextPackMatch[0]);
                await fs.writeFile(contextPackPath, JSON.stringify(contextPack, null, 2), "utf-8");
            }
            catch {
                // Ignorar si no se puede parsear
            }
        }
    }
    buildRepairFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage) {
        const lines = [
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
        lines.push("INSTRUCTION: Use the SYSTEM CONTEXT and USER REQUEST above to determine the appropriate decision and reason.", `Write the JSON object to: ${outputPath}`, "Do NOT write any other files. Do NOT write to stdout.", "", "EXAMPLE OUTPUT:", '{"decision":"no_safe_action","reason":"No safe candidate matches the intent without user confirmation."}', "", "IMPORTANT: Write ONLY the file at the OUTPUT FILE path. Nothing else.");
        return lines.join("\n");
    }
    buildGenericFileOutputPrompt(outputPath, promptPath, systemMessage, userMessage, jsonSchema) {
        const lines = [
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
        if (jsonSchema) {
            lines.push(`- The JSON file MUST conform exactly to the structured schema named ${jsonSchema.name}`, "- Do not add, remove, or rename fields from that schema", "STRUCTURED OUTPUT SCHEMA:", JSON.stringify(jsonSchema.schema, null, 2), "");
        }
        if (systemMessage) {
            lines.push("SYSTEM CONTEXT:", systemMessage, "");
        }
        if (userMessage) {
            lines.push("USER REQUEST:", userMessage, "");
        }
        lines.push("INSTRUCTION: Use the SYSTEM CONTEXT and USER REQUEST above to generate the appropriate JSON response.", `Write the JSON object to: ${outputPath}`, "You may write explanations or reasoning to stdout, but the file must contain ONLY valid JSON.", "", "IMPORTANT: Write ONLY valid JSON to the OUTPUT FILE path.");
        return lines.join("\n");
    }
    async cleanupTempDir(tempDir) {
        try {
            await fs.rm(tempDir, { recursive: true, force: true });
        }
        catch {
            // Ignorar errores de limpieza
        }
    }
    sanitizeSecrets(text) {
        let sanitized = text;
        for (const pattern of SENSITIVE_PATTERNS) {
            sanitized = sanitized.replace(pattern, "[REDACTED]");
        }
        return sanitized;
    }
    sanitizeArgs(args) {
        return args.map(a => this.sanitizeSecrets(a));
    }
    extractCodexFailureMessage(stdout) {
        if (!stdout)
            return undefined;
        for (const line of stdout.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const event = JSON.parse(trimmed);
                if (!event || typeof event !== "object")
                    continue;
                if (event.type !== "turn.failed" && event.type !== "error")
                    continue;
                if (typeof event.message === "string" && event.message.trim())
                    return event.message.trim();
                if (event.error && typeof event.error === "object" && typeof event.error.message === "string") {
                    return event.error.message.trim();
                }
            }
            catch {
                // Skip non-JSON protocol lines.
            }
        }
        return undefined;
    }
}
exports.CodexCliProvider = CodexCliProvider;
