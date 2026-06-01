import { AiProviderError, type AiCompletionRequest, type AiCompletionResponse, type AiProvider, type AiProviderConfig } from "../ai-provider.types";
import { parseJsonObjectText } from "../ai-json-validator";

type AnthropicMessage = {
  role: "user" | "assistant";
  content: string;
};

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { type: string; message: string };
};

export class AnthropicProvider implements AiProvider {
  public readonly providerType = "anthropic" as const;
  public readonly providerName: string;
  public readonly model: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly requireJson: boolean;
  private readonly baseUrl: string;

  constructor(config: AiProviderConfig) {
    this.providerName = config.providerName;
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.timeoutMs = config.timeoutMs;
    this.requireJson = config.requireJson;
    this.baseUrl = (config.baseUrl?.trim() || "https://api.anthropic.com").replace(/\/+$/, "");
  }

  async completeJson(request: AiCompletionRequest): Promise<AiCompletionResponse> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    // Separar el system message de los demás
    const systemMessage = request.messages.find((m) => m.role === "system");
    const userMessages: AnthropicMessage[] = request.messages
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));

    // Si requireJson, reforzar en el system prompt
    const systemContent = this.requireJson
      ? `${systemMessage?.content ?? ""}\n\nIMPORTANT: Respond ONLY with valid JSON. No markdown, no explanation, no extra text.`
      : (systemMessage?.content ?? "");

    const payload: Record<string, unknown> = {
      model: this.model,
      max_tokens: 4096,
      messages: userMessages,
      temperature: request.temperature ?? 0.3
    };

    if (systemContent.trim()) {
      payload.system = systemContent.trim();
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/messages`, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const durationMs = Date.now() - startedAt;
      const responseText = await response.text();

      if (!response.ok) {
        let apiMsg = `HTTP ${response.status}`;
        try {
          const errBody = JSON.parse(responseText) as AnthropicResponse;
          if (errBody.error?.message) apiMsg = errBody.error.message;
        } catch { /* ignorar */ }
        throw new AiProviderError("ai_provider_http_error", `Anthropic API error: ${apiMsg}`, {
          status: response.status,
          bodyPreview: responseText.slice(0, 500)
        });
      }

      let parsed: AnthropicResponse;
      try {
        parsed = JSON.parse(responseText) as AnthropicResponse;
      } catch {
        throw new AiProviderError("ai_provider_invalid_json", "Anthropic returned non-JSON response.", {
          bodyPreview: responseText.slice(0, 500)
        });
      }

      const rawText = parsed.content?.find((b) => b.type === "text")?.text ?? "";
      if (!rawText.trim()) {
        throw new AiProviderError("ai_provider_output_missing", "Anthropic returned empty content.");
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
        throw new AiProviderError("ai_provider_timeout", `Anthropic timed out after ${this.timeoutMs}ms.`);
      }
      throw new AiProviderError(
        "ai_provider_http_error",
        `Anthropic request failed: ${error instanceof Error ? error.message : String(error)}`
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
