export type AiProviderName = "openai_compatible" | "codex_cli" | "disabled" | "fake";

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AiCompletionRequest = {
  messages: AiMessage[];
  temperature?: number;
  requireJson?: boolean;
  requireJsonSchema?: boolean;
};

export type AiCompletionResponse = {
  rawText: string;
  parsedJson?: Record<string, unknown>;
  model: string;
  providerName: string;
  durationMs: number;
};

export type AiProviderErrorCode =
  | "ai_provider_config_missing"
  | "ai_provider_http_error"
  | "ai_provider_timeout"
  | "ai_provider_invalid_json"
  | "ai_provider_process_error"
  | "ai_provider_schema_invalid"
  | "ai_provider_unsupported"
  | "ai_provider_output_missing";

export class AiProviderError extends Error {
  constructor(
    public readonly code: AiProviderErrorCode,
    message: string,
    public readonly diagnostics?: Record<string, unknown>
  ) {
    super(message);
    this.name = "AiProviderError";
  }
}

export type AiProvider = {
  providerType: AiProviderName;
  providerName: string;
  model: string;
  completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse>;
};

export type AiProviderConfig = {
  enabled: boolean;
  provider: AiProviderName;
  providerName: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  requireJson: boolean;
  requireJsonSchema: boolean;
  // Codex CLI specific (optional)
  command?: string;       // CODEX_CLI_COMMAND
  extraArgs?: string[];   // CODEX_CLI_EXTRA_ARGS parsed
};
