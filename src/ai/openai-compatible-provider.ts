import { AiProviderError, type AiCompletionRequest, type AiCompletionResponse, type AiProvider, type AiProviderConfig } from "./ai-provider.types";
import { parseJsonObjectText } from "./ai-json-validator";

function buildChatCompletionsUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  return `${trimmed}/chat/completions`;
}

export class OpenAICompatibleProvider implements AiProvider {
  public readonly providerType = "openai_compatible" as const;
  public readonly providerName: string;
  public readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly requireJson: boolean;

  constructor(config: AiProviderConfig) {
    this.providerName = config.providerName;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
    this.requireJson = config.requireJson;
  }

  async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const url = buildChatCompletionsUrl(this.baseUrl);

    const payload: Record<string, unknown> = {
      model: this.model,
      messages: request.messages,
      temperature: request.temperature ?? 0,
      response_format: { type: "json_object" }
    };

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const durationMs = Date.now() - startedAt;
      const responseText = await response.text();
      if (!response.ok) {
        throw new AiProviderError("ai_provider_http_error", `AI provider HTTP error ${response.status}: ${responseText.slice(0, 500)}`, {
          status: response.status,
          bodyPreview: responseText.slice(0, 500)
        });
      }

      let parsedResponse: any;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch {
        throw new AiProviderError("ai_provider_invalid_json", "AI provider returned non-JSON response payload.", {
          bodyPreview: responseText.slice(0, 500)
        });
      }

      const rawText = parsedResponse?.choices?.[0]?.message?.content;
      if (typeof rawText !== "string" || !rawText.trim()) {
        throw new AiProviderError("ai_provider_invalid_json", "AI provider returned empty completion content.");
      }

      const result: AiCompletionResponse = {
        rawText,
        model: this.model,
        providerName: this.providerName,
        durationMs
      };

      if (this.requireJson || request.requireJson) {
        result.parsedJson = parseJsonObjectText(rawText);
      }

      return result;
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiProviderError("ai_provider_timeout", `AI provider timed out after ${this.timeoutMs}ms.`, {
          timeoutMs: this.timeoutMs
        });
      }
      throw new AiProviderError("ai_provider_http_error", `AI provider request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}

export { buildChatCompletionsUrl };
