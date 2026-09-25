"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiProviderError = void 0;
exports.readAiProviderConfigFromEnv = readAiProviderConfigFromEnv;
exports.createAiProviderFromEnv = createAiProviderFromEnv;
exports.createAiProviderFromConfig = createAiProviderFromConfig;
exports.createScenarioAiProvider = createScenarioAiProvider;
exports.createScenarioSemanticAiProvider = createScenarioSemanticAiProvider;
exports.createCanonicalSemanticAiProvider = createCanonicalSemanticAiProvider;
exports.createRepairAiProvider = createRepairAiProvider;
exports.createSpecGenerationAiProvider = createSpecGenerationAiProvider;
exports.createGeneralAiProvider = createGeneralAiProvider;
const ai_provider_types_1 = require("./ai-provider.types");
var ai_provider_types_2 = require("./ai-provider.types");
Object.defineProperty(exports, "AiProviderError", { enumerable: true, get: function () { return ai_provider_types_2.AiProviderError; } });
const openai_compatible_provider_1 = require("./openai-compatible-provider");
const codex_cli_provider_1 = require("./providers/codex-cli-provider");
const copilot_cli_provider_1 = require("./providers/copilot-cli-provider");
const claude_cli_provider_1 = require("./providers/claude-cli-provider");
const codex_cli_resolver_1 = require("../agent/codex-cli-resolver");
const ai_config_resolver_1 = require("./ai-config-resolver");
function parseBool(value, defaultValue = false) {
    if (!value)
        return defaultValue;
    return value.trim().toLowerCase() === "true";
}
function readRequired(name) {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new ai_provider_types_1.AiProviderError("ai_provider_config_missing", `Missing required AI provider configuration: ${name}`);
    }
    return value;
}
function parseExtraArgs(argsString) {
    if (!argsString?.trim())
        return [];
    // Split por espacios: "--skip-git-repo-check --sandbox workspace-write"
    // → ["--skip-git-repo-check", "--sandbox", "workspace-write"]
    const args = argsString.trim().split(/\s+/);
    // Filtrar "exec" si alguien lo incluyó por error
    return args.filter(arg => arg !== "exec");
}
async function resolveCodexCommand(explicitCommand) {
    // 1. CODEX_CLI_COMMAND explícito
    if (explicitCommand?.trim()) {
        return explicitCommand.trim();
    }
    // 2. resolveCodexCliPath()
    const resolved = await (0, codex_cli_resolver_1.resolveCodexCliPath)({});
    if (resolved.found) {
        return resolved.command;
    }
    // 3. Fallback a "codex" desde PATH
    return "codex";
}
function readAiProviderConfigFromEnv() {
    const enabled = parseBool(process.env.AI_ENABLED, false);
    if (!enabled)
        return undefined;
    const providerRaw = readRequired("AI_PROVIDER").toLowerCase();
    if (providerRaw === "disabled") {
        return undefined;
    }
    const timeoutRaw = process.env.AI_TIMEOUT_MS?.trim();
    const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 30000;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new ai_provider_types_1.AiProviderError("ai_provider_config_missing", `Invalid AI_TIMEOUT_MS value "${timeoutRaw}". Expected positive number.`);
    }
    if (providerRaw === "codex_cli") {
        const explicitCommand = process.env.CODEX_CLI_COMMAND?.trim();
        const extraArgsRaw = process.env.CODEX_CLI_EXTRA_ARGS;
        return {
            enabled,
            provider: "codex_cli",
            providerName: process.env.AI_PROVIDER_NAME?.trim() || "codex",
            baseUrl: "", // No aplica para Codex
            apiKey: "", // No aplica para Codex
            model: process.env.AI_MODEL?.trim() || "codex",
            timeoutMs,
            command: explicitCommand, // Opcional, se resuelve después
            extraArgs: parseExtraArgs(extraArgsRaw),
            requireJson: parseBool(process.env.AI_REQUIRE_JSON, true),
            requireJsonSchema: parseBool(process.env.AI_REQUIRE_JSON_SCHEMA, true),
            allowStdoutJsonFallback: parseBool(process.env.AI_ALLOW_STDOUT_JSON_FALLBACK, false)
        };
    }
    if (providerRaw === "openai_compatible") {
        return {
            enabled,
            provider: "openai_compatible",
            providerName: process.env.AI_PROVIDER_NAME?.trim() || "openai_compatible",
            baseUrl: readRequired("AI_BASE_URL"),
            apiKey: readRequired("AI_API_KEY"),
            model: readRequired("AI_MODEL"),
            timeoutMs,
            requireJson: parseBool(process.env.AI_REQUIRE_JSON, true),
            requireJsonSchema: parseBool(process.env.AI_REQUIRE_JSON_SCHEMA, true)
        };
    }
    throw new ai_provider_types_1.AiProviderError("ai_provider_unsupported", `Unsupported AI_PROVIDER "${providerRaw}". Expected "openai_compatible" or "codex_cli".`);
}
async function createAiProviderFromEnv() {
    const config = readAiProviderConfigFromEnv();
    if (!config)
        return undefined;
    return createAiProviderFromConfig(config);
}
/**
 * Create an AI provider from a given configuration.
 */
async function createAiProviderFromConfig(config) {
    if (config.provider === "openai_compatible") {
        return new openai_compatible_provider_1.OpenAICompatibleProvider(config);
    }
    if (config.provider === "copilot_cli") {
        // Command should already be resolved in config, but provide default
        if (!config.command) {
            config.command = "copilot";
        }
        return new copilot_cli_provider_1.CopilotCliProvider(config);
    }
    if (config.provider === "codex_cli") {
        // Resolver comando si no está explícito
        if (!config.command) {
            config.command = await resolveCodexCommand();
        }
        return new codex_cli_provider_1.CodexCliProvider(config);
    }
    if (config.provider === "claude_cli") {
        if (!config.command) {
            config.command = "claude";
        }
        return new claude_cli_provider_1.ClaudeCliProvider(config);
    }
    throw new ai_provider_types_1.AiProviderError("ai_provider_unsupported", `Unsupported provider "${config.provider}". Expected "openai_compatible", "copilot_cli", "codex_cli", or "claude_cli".`);
}
/**
 * Shorthand for creating an AI provider for scenario generation.
 */
async function createScenarioAiProvider() {
    const config = (0, ai_config_resolver_1.resolveScenarioAiConfig)();
    return createAiProviderFromConfig(config);
}
async function createScenarioSemanticAiProvider() {
    const config = (0, ai_config_resolver_1.resolveScenarioSemanticAiConfig)();
    return createAiProviderFromConfig(config);
}
async function createCanonicalSemanticAiProvider() {
    const config = (0, ai_config_resolver_1.resolveCanonicalSemanticAiConfig)();
    return createAiProviderFromConfig(config);
}
/**
 * Shorthand for creating an AI provider for repair.
 */
async function createRepairAiProvider() {
    const config = (0, ai_config_resolver_1.resolveRepairAiConfig)();
    return createAiProviderFromConfig(config);
}
/**
 * Shorthand for creating an AI provider for spec generation.
 */
async function createSpecGenerationAiProvider() {
    const config = (0, ai_config_resolver_1.resolveSpecGenerationAiConfig)();
    return createAiProviderFromConfig(config);
}
/**
 * Shorthand for creating a general AI provider.
 */
async function createGeneralAiProvider() {
    const config = (0, ai_config_resolver_1.resolveGeneralAiConfig)();
    return createAiProviderFromConfig(config);
}
