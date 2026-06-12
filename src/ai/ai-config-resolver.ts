import { AiProviderError, type AiProviderConfig } from "./ai-provider.types";

export type AiPurpose = "scenario_generation" | "repair" | "general";

function parseBool(value: string | undefined, defaultValue = false): boolean {
  if (!value) return defaultValue;
  return value.trim().toLowerCase() === "true";
}

function parsePositiveInt(value: string | undefined, defaultValue: number): number {
  if (!value?.trim()) return defaultValue;
  const parsed = Number(value.trim());
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    return defaultValue;
  }
  return parsed;
}

function parseExtraArgs(argsString?: string): string[] {
  if (!argsString?.trim()) return [];
  const args = argsString.trim().split(/\s+/);
  return args.filter(arg => arg !== "exec");
}

/**
 * Resolve AI configuration for a specific purpose (scenario_generation, repair, or general).
 *
 * Priority order:
 * 1. Purpose-specific env vars (AI_SCENARIO_*, AI_REPAIR_*)
 * 2. General fallback env vars (AI_PROVIDER, AI_MODEL, etc.)
 *
 * @param purpose - The purpose for which AI is being used
 * @returns AiProviderConfig with resolved values
 * @throws AiProviderError if required configuration is missing
 */
export function resolveAiConfig(purpose: AiPurpose): AiProviderConfig {
  const env = process.env;

  // Check if AI is enabled at all
  const enabled = parseBool(env.AI_ENABLED, true);
  if (!enabled) {
    throw new AiProviderError(
      "ai_provider_config_missing",
      "AI is disabled (AI_ENABLED=false)"
    );
  }

  // Resolve provider
  let provider: string | undefined;
  let providerSource: string = "AI_PROVIDER"; // Default source

  if (purpose === "scenario_generation") {
    provider = env.AI_SCENARIO_PROVIDER?.trim();
    providerSource = "AI_SCENARIO_PROVIDER";
  } else if (purpose === "repair") {
    provider = env.AI_REPAIR_PROVIDER?.trim();
    providerSource = "AI_REPAIR_PROVIDER";
  }

  if (!provider) {
    provider = env.AI_PROVIDER?.trim();
    providerSource = "AI_PROVIDER";
  }

  if (!provider) {
    throw new AiProviderError(
      "ai_provider_config_missing",
      `Missing AI provider configuration for purpose="${purpose}". Set ${providerSource} or AI_PROVIDER.`
    );
  }

  const providerLower = provider.toLowerCase();

  if (providerLower === "disabled") {
    throw new AiProviderError(
      "ai_provider_config_missing",
      `AI provider is disabled (${providerSource}=disabled)`
    );
  }

  // Resolve model
  let model: string | undefined;
  let modelSource: string = "AI_MODEL"; // Default source

  if (purpose === "scenario_generation") {
    model = env.AI_SCENARIO_MODEL?.trim();
    modelSource = "AI_SCENARIO_MODEL";
  } else if (purpose === "repair") {
    model = env.AI_REPAIR_MODEL?.trim();
    modelSource = "AI_REPAIR_MODEL";
  }

  if (!model) {
    model = env.AI_MODEL?.trim();
    modelSource = "AI_MODEL";
  }

  if (!model) {
    throw new AiProviderError(
      "ai_provider_config_missing",
      `Missing AI model configuration for purpose="${purpose}". Set ${modelSource} or AI_MODEL.`
    );
  }

  // Resolve timeout
  let timeoutMs: number;
  if (purpose === "scenario_generation") {
    timeoutMs = parsePositiveInt(env.AI_SCENARIO_TIMEOUT_MS, parsePositiveInt(env.AI_TIMEOUT_MS, 240000));
  } else if (purpose === "repair") {
    timeoutMs = parsePositiveInt(env.AI_REPAIR_TIMEOUT_MS, parsePositiveInt(env.AI_TIMEOUT_MS, 60000));
  } else {
    timeoutMs = parsePositiveInt(env.AI_TIMEOUT_MS, 30000);
  }

  // Resolve max attempts
  let maxAttempts: number;
  if (purpose === "scenario_generation") {
    maxAttempts = parsePositiveInt(env.AI_SCENARIO_MAX_ATTEMPTS, 1);
  } else if (purpose === "repair") {
    maxAttempts = parsePositiveInt(env.AI_REPAIR_MAX_ATTEMPTS, 1);
  } else {
    maxAttempts = 1;
  }

  // Build config based on provider type
  const providerName = env.AI_PROVIDER_NAME?.trim() || providerLower;

  if (providerLower === "copilot_cli") {
    const command = env.COPILOT_CLI_COMMAND?.trim() || "copilot";
    const extraArgs = parseExtraArgs(env.COPILOT_CLI_EXTRA_ARGS);

    return {
      enabled: true,
      provider: "copilot_cli",
      providerName,
      baseUrl: "",
      apiKey: "",
      model,
      timeoutMs,
      maxAttempts,
      purpose,
      command,
      extraArgs,
      requireJson: parseBool(env.AI_REQUIRE_JSON, true),
      requireJsonSchema: parseBool(env.AI_REQUIRE_JSON_SCHEMA, true),
      allowStdoutJsonFallback: parseBool(env.AI_ALLOW_STDOUT_JSON_FALLBACK, false)
    };
  }

  if (providerLower === "codex_cli" || providerLower === "codex") {
    const command = env.CODEX_CLI_COMMAND?.trim();
    const extraArgs = parseExtraArgs(env.CODEX_CLI_EXTRA_ARGS);

    return {
      enabled: true,
      provider: "codex_cli",
      providerName,
      baseUrl: "",
      apiKey: "",
      model,
      timeoutMs,
      maxAttempts,
      purpose,
      command,
      extraArgs,
      requireJson: parseBool(env.AI_REQUIRE_JSON, true),
      requireJsonSchema: parseBool(env.AI_REQUIRE_JSON_SCHEMA, true),
      allowStdoutJsonFallback: parseBool(env.AI_ALLOW_STDOUT_JSON_FALLBACK, false)
    };
  }

  if (providerLower === "openai_compatible") {
    const baseUrl = env.AI_BASE_URL?.trim();
    const apiKey = env.AI_API_KEY?.trim();

    if (!baseUrl) {
      throw new AiProviderError(
        "ai_provider_config_missing",
        "Missing AI_BASE_URL for openai_compatible provider"
      );
    }

    if (!apiKey) {
      throw new AiProviderError(
        "ai_provider_config_missing",
        "Missing AI_API_KEY for openai_compatible provider"
      );
    }

    return {
      enabled: true,
      provider: "openai_compatible",
      providerName,
      baseUrl,
      apiKey,
      model,
      timeoutMs,
      maxAttempts,
      purpose,
      requireJson: parseBool(env.AI_REQUIRE_JSON, true),
      requireJsonSchema: parseBool(env.AI_REQUIRE_JSON_SCHEMA, true)
    };
  }

  throw new AiProviderError(
    "ai_provider_unsupported",
    `Unsupported AI provider "${provider}". Expected "copilot_cli", "codex_cli", or "openai_compatible".`
  );
}

/**
 * Shorthand for resolving scenario generation AI config.
 */
export function resolveScenarioAiConfig(): AiProviderConfig {
  return resolveAiConfig("scenario_generation");
}

/**
 * Shorthand for resolving repair AI config.
 */
export function resolveRepairAiConfig(): AiProviderConfig {
  return resolveAiConfig("repair");
}

/**
 * Shorthand for resolving general AI config.
 */
export function resolveGeneralAiConfig(): AiProviderConfig {
  return resolveAiConfig("general");
}
