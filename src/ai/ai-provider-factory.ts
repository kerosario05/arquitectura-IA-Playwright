import { AiProviderError, type AiProvider, type AiProviderConfig } from "./ai-provider.types";
import { OpenAICompatibleProvider } from "./openai-compatible-provider";

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

export function readAiProviderConfigFromEnv(): AiProviderConfig | undefined {
  const enabled = parseBool(process.env.AI_ENABLED, false);
  if (!enabled) return undefined;

  const providerRaw = readRequired("AI_PROVIDER").toLowerCase();
  if (providerRaw !== "openai_compatible") {
    throw new AiProviderError("ai_provider_config_missing", `Unsupported AI_PROVIDER "${providerRaw}". Expected "openai_compatible".`);
  }

  const timeoutRaw = process.env.AI_TIMEOUT_MS?.trim();
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new AiProviderError("ai_provider_config_missing", `Invalid AI_TIMEOUT_MS value "${timeoutRaw}". Expected positive number.`);
  }

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

export function createAiProviderFromEnv(): AiProvider | undefined {
  const config = readAiProviderConfigFromEnv();
  if (!config) return undefined;

  if (config.provider === "openai_compatible") {
    return new OpenAICompatibleProvider(config);
  }

  return undefined;
}
