import { AiProviderError, type AiProvider, type AiProviderConfig } from "./ai-provider.types";
export { AiProviderError, type AiProvider, type AiProviderConfig } from "./ai-provider.types";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";
import { CodexCliProvider } from "./providers/codex-cli-provider";
import { resolveCodexCliPath } from "../agent/codex-cli-resolver";

function parseBool(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  return value.trim().toLowerCase() === "true";
}

function readRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AiProviderError("ai_provider_config_missing", `Missing required AI provider configuration: ${name}`);
  }
  return value;
}

function parseExtraArgs(argsString?: string): string[] {
  if (!argsString?.trim()) return [];

  // Split por espacios: "--skip-git-repo-check --sandbox workspace-write"
  // → ["--skip-git-repo-check", "--sandbox", "workspace-write"]
  const args = argsString.trim().split(/\s+/);

  // Filtrar "exec" si alguien lo incluyó por error
  return args.filter(arg => arg !== "exec");
}

async function resolveCodexCommand(explicitCommand?: string): Promise<string> {
  // 1. CODEX_CLI_COMMAND explícito
  if (explicitCommand?.trim()) {
    return explicitCommand.trim();
  }

  // 2. resolveCodexCliPath()
  const resolved = await resolveCodexCliPath({});
  if (resolved.found) {
    return resolved.command;
  }

  // 3. Fallback a "codex" desde PATH
  return "codex";
}

export function readAiProviderConfigFromEnv(): AiProviderConfig | undefined {
  const enabled = parseBool(process.env.AI_ENABLED, false);
  if (!enabled) return undefined;

  const providerRaw = readRequired("AI_PROVIDER").toLowerCase();

  if (providerRaw === "disabled") {
    return undefined;
  }

  const timeoutRaw = process.env.AI_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AiProviderError("ai_provider_config_missing", `Invalid AI_TIMEOUT_MS value "${timeoutRaw}". Expected positive number.`);
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

  throw new AiProviderError("ai_provider_unsupported", `Unsupported AI_PROVIDER "${providerRaw}". Expected "openai_compatible" or "codex_cli".`);
}

export async function createAiProviderFromEnv(): Promise<AiProvider | undefined> {
  const config = readAiProviderConfigFromEnv();
  if (!config) return undefined;

  if (config.provider === "openai_compatible") {
    return new OpenAICompatibleProvider(config);
  }

  if (config.provider === "codex_cli") {
    // Resolver comando si no está explícito
    if (!config.command) {
      config.command = await resolveCodexCommand();
    }
    return new CodexCliProvider(config);
  }

  return undefined;
}
