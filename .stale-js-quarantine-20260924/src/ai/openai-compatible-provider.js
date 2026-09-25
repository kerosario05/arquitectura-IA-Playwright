"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OpenAICompatibleProvider = void 0;
exports.buildChatCompletionsUrl = buildChatCompletionsUrl;
const ai_provider_types_1 = require("./ai-provider.types");
const ai_json_validator_1 = require("./ai-json-validator");
function buildChatCompletionsUrl(baseUrl) {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    return `${trimmed}/chat/completions`;
}
class OpenAICompatibleProvider {
    providerType = "openai_compatible";
    providerName;
    model;
    baseUrl;
    apiKey;
    timeoutMs;
    requireJson;
    constructor(config) {
        this.providerName = config.providerName;
        this.model = config.model;
        this.baseUrl = config.baseUrl;
        this.apiKey = config.apiKey;
        this.timeoutMs = config.timeoutMs;
        this.requireJson = config.requireJson;
    }
    async completeJson(request) {
        const startedAt = Date.now();
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        const url = buildChatCompletionsUrl(this.baseUrl);
        const payload = {
            model: this.model,
            messages: request.messages,
            temperature: request.temperature ?? 0,
            response_format: request.jsonSchema && request.requireJsonSchema !== false
                ? {
                    type: "json_schema",
                    json_schema: { name: request.jsonSchema.name, strict: true, schema: request.jsonSchema.schema },
                }
                : { type: "json_object" },
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
                throw new ai_provider_types_1.AiProviderError("ai_provider_http_error", `AI provider HTTP error ${response.status}: ${responseText.slice(0, 500)}`, {
                    status: response.status,
                    bodyPreview: responseText.slice(0, 500)
                });
            }
            let parsedResponse;
            try {
                parsedResponse = JSON.parse(responseText);
            }
            catch {
                throw new ai_provider_types_1.AiProviderError("ai_provider_invalid_json", "AI provider returned non-JSON response payload.", {
                    bodyPreview: responseText.slice(0, 500)
                });
            }
            const rawText = parsedResponse?.choices?.[0]?.message?.content;
            if (typeof rawText !== "string" || !rawText.trim()) {
                throw new ai_provider_types_1.AiProviderError("ai_provider_invalid_json", "AI provider returned empty completion content.");
            }
            const result = {
                rawText,
                model: this.model,
                providerName: this.providerName,
                durationMs,
                usage: parsedResponse?.usage
                    ? {
                        inputTokens: parsedResponse.usage.prompt_tokens,
                        outputTokens: parsedResponse.usage.completion_tokens,
                        totalPhysicalTokens: parsedResponse.usage.total_tokens,
                        cachedInputTokens: parsedResponse.usage.prompt_tokens_details?.cached_tokens,
                    }
                    : undefined,
            };
            if (this.requireJson || request.requireJson) {
                result.parsedJson = (0, ai_json_validator_1.parseJsonObjectText)(rawText);
            }
            return result;
        }
        catch (error) {
            if (error instanceof ai_provider_types_1.AiProviderError)
                throw error;
            if (error instanceof Error && error.name === "AbortError") {
                throw new ai_provider_types_1.AiProviderError("ai_provider_timeout", `AI provider timed out after ${this.timeoutMs}ms.`, {
                    timeoutMs: this.timeoutMs
                });
            }
            throw new ai_provider_types_1.AiProviderError("ai_provider_http_error", `AI provider request failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            clearTimeout(timeout);
        }
    }
}
exports.OpenAICompatibleProvider = OpenAICompatibleProvider;
