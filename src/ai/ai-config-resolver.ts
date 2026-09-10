import { AiProviderError, type AiProviderConfig } from "./ai-provider.types";

export type AiPurpose = "scenario_generation" | "scenario_data_semantic_enrichment" | "canonical_scenario_semantic_normalization" | "repair" | "spec_generation" | "general";

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
 * 1. Purpose-specific env vars (AI_SCENARIO_*, AI_REPAIR_*, AI_SPEC_*)
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
  } else if (purpose === "scenario_data_semantic_enrichment") {
    provider = env.AI_SCENARIO_SEMANTIC_PROVIDER?.trim();
    providerSource = "AI_SCENARIO_SEMANTIC_PROVIDER";
  } else if (purpose === "canonical_scenario_semantic_normalization") {
    provider = env.AI_CANONICAL_SEMANTIC_PROVIDER?.trim();
    providerSource = "AI_CANONICAL_SEMANTIC_PROVIDER";
  } else if (purpose === "repair") {
    provider = env.AI_REPAIR_PROVIDER?.trim();
    providerSource = "AI_REPAIR_PROVIDER";
  } else if (purpose === "spec_generation") {
    provider = env.AI_SPEC_PROVIDER?.trim();
    providerSource = "AI_SPEC_PROVIDER";
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
  } else if (purpose === "scenario_data_semantic_enrichment") {
    model = env.AI_SCENARIO_SEMANTIC_MODEL?.trim();
    modelSource = "AI_SCENARIO_SEMANTIC_MODEL";
  } else if (purpose === "canonical_scenario_semantic_normalization") {
    model = env.AI_CANONICAL_SEMANTIC_MODEL?.trim();
    modelSource = "AI_CANONICAL_SEMANTIC_MODEL";
  } else if (purpose === "repair") {
    model = env.AI_REPAIR_MODEL?.trim();
    modelSource = "AI_REPAIR_MODEL";
  } else if (purpose === "canonical_scenario_semantic_normalization") {
    timeoutMs = parsePositiveInt(env.AI_CANONICAL_SEMANTIC_TIMEOUT_MS, parsePositiveInt(env.AI_TIMEOUT_MS, 30000));
  } else if (purpose === "spec_generation") {
    model = env.AI_SPEC_MODEL?.trim();
    modelSource = "AI_SPEC_MODEL";
  }

  if (!model && purpose !== "scenario_data_semantic_enrichment" && purpose !== "canonical_scenario_semantic_normalization") {
    model = env.AI_MODEL?.trim();
    modelSource = "AI_MODEL";
  }

  if (!model && providerLower !== "codex_cli" && providerLower !== "codex") {
    throw new AiProviderError(
      "ai_provider_config_missing",
      `Missing AI model configuration for purpose="${purpose}". Set ${modelSource} or AI_MODEL.`
    );
  }
  if (!model && (providerLower === "codex_cli" || providerLower === "codex")) model = "";

  // Resolve timeout
  let timeoutMs: number;
  if (purpose === "scenario_generation") {
    timeoutMs = parsePositiveInt(env.AI_SCENARIO_TIMEOUT_MS, parsePositiveInt(env.AI_TIMEOUT_MS, 240000));
  } else if (purpose === "repair") {
    timeoutMs = parsePositiveInt(env.AI_REPAIR_TIMEOUT_MS, parsePositiveInt(env.AI_TIMEOUT_MS, 60000));
  } else if (purpose === "canonical_scenario_semantic_normalization") {
    timeoutMs = parsePositiveInt(env.AI_CANONICAL_SEMANTIC_TIMEOUT_MS, parsePositiveInt(env.AI_TIMEOUT_MS, 30000));
  } else if (purpose === "spec_generation") {
    timeoutMs = parsePositiveInt(env.AI_SPEC_TIMEOUT_MS, parsePositiveInt(env.AI_TIMEOUT_MS, 360000));
  } else {
    timeoutMs = parsePositiveInt(env.AI_TIMEOUT_MS, 30000);
  }

  // Resolve max attempts
  let maxAttempts: number;
  if (purpose === "scenario_generation") {
    maxAttempts = parsePositiveInt(env.AI_SCENARIO_MAX_ATTEMPTS, 1);
  } else if (purpose === "repair") {
    maxAttempts = parsePositiveInt(env.AI_REPAIR_MAX_ATTEMPTS, 1);
  } else if (purpose === "canonical_scenario_semantic_normalization") {
    maxAttempts = parsePositiveInt(env.AI_CANONICAL_SEMANTIC_MAX_ATTEMPTS, 1);
  } else if (purpose === "spec_generation") {
    maxAttempts = parsePositiveInt(env.AI_SPEC_MAX_ATTEMPTS, 1);
  } else {
    maxAttempts = 1;
  }

  const requireJson = purpose === "spec_generation"
    ? parseBool(env.AI_SPEC_REQUIRE_JSON, parseBool(env.AI_REQUIRE_JSON, true))
    : parseBool(env.AI_REQUIRE_JSON, true);
  const requireJsonSchema = purpose === "spec_generation"
    ? parseBool(env.AI_SPEC_REQUIRE_JSON_SCHEMA, parseBool(env.AI_REQUIRE_JSON_SCHEMA, true))
    : parseBool(env.AI_REQUIRE_JSON_SCHEMA, true);

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
      requireJson,
      requireJsonSchema,
      allowStdoutJsonFallback: parseBool(env.AI_ALLOW_STDOUT_JSON_FALLBACK, false)
    };
  }

  if (providerLower === "claude_cli" || providerLower === "claude") {
    const command = env.CLAUDE_CLI_COMMAND?.trim() || "claude";
    const extraArgs = parseExtraArgs(env.CLAUDE_CLI_EXTRA_ARGS);

    return {
      enabled: true,
      provider: "claude_cli",
      providerName,
      baseUrl: "",
      apiKey: "",
      model,
      timeoutMs,
      maxAttempts,
      purpose,
      command,
      extraArgs,
      requireJson,
      requireJsonSchema
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
      requireJson,
      requireJsonSchema,
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
      requireJson,
      requireJsonSchema
    };
  }

  throw new AiProviderError(
    "ai_provider_unsupported",
    `Unsupported AI provider "${provider}". Expected "claude_cli", "copilot_cli", "codex_cli", or "openai_compatible".`
  );
}

/**
 * Shorthand for resolving scenario generation AI config.
 */
export function resolveScenarioAiConfig(): AiProviderConfig {
  return resolveAiConfig("scenario_generation");
}

export function resolveScenarioSemanticAiConfig(): AiProviderConfig {
  return resolveAiConfig("scenario_data_semantic_enrichment");
}

export function resolveCanonicalSemanticAiConfig(): AiProviderConfig {
  return resolveAiConfig("canonical_scenario_semantic_normalization");
}

/**
 * Shorthand for resolving repair AI config.
 */
export function resolveRepairAiConfig(): AiProviderConfig {
  return resolveAiConfig("repair");
}

/**
 * Shorthand for resolving spec generation AI config.
 */
export function resolveSpecGenerationAiConfig(): AiProviderConfig {
  return resolveAiConfig("spec_generation");
}

/**
 * Shorthand for resolving general AI config.
 */
export function resolveGeneralAiConfig(): AiProviderConfig {
  return resolveAiConfig("general");
}
