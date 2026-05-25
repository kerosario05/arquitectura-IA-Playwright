import { AiProviderError } from "./ai-provider.types";

export function parseJsonObjectText(rawText: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(rawText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error("Expected a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new AiProviderError(
      "ai_provider_invalid_json",
      `AI provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
