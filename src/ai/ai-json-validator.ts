import { AiProviderError } from "./ai-provider.types";

function extractJsonFromText(rawText: string): string {
  const trimmed = rawText.trim();

  // Quitar bloque markdown ```json ... ``` o ``` ... ```
  const mdMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```\s*$/);
  if (mdMatch) return mdMatch[1].trim();

  // Extraer el primer objeto JSON { ... } si hay texto alrededor
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

export function parseJsonObjectText(rawText: string): Record<string, unknown> {
  const cleaned = extractJsonFromText(rawText);
  try {
    const parsed = JSON.parse(cleaned);
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
