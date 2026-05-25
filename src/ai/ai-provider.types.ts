export type AiProviderName = "openai_compatible";

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
  | "ai_provider_invalid_json";

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
};
