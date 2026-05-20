import type { DataContext } from "../data/data-context";
import type { SafeDataContextSummary } from "../types/agent-safe-context.types";

const sensitiveKeyHints = ["password", "pass", "token", "secret", "api_key", "apikey", "bearer", "key"];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isSensitiveKeyName(key: string): boolean {
  const normalized = normalize(key);
  return sensitiveKeyHints.some((hint) => normalized.includes(normalize(hint)));
}

function redactKeyName(key: string): string {
  if (!isSensitiveKeyName(key)) {
    return key;
  }
  return key.toUpperCase() === "APP_USERNAME" || key.toUpperCase() === "APP_PASSWORD" ? key : `[REDACTED_KEY:${key}]`;
}

export function buildSafeDataContextSummary(dataContext: DataContext): SafeDataContextSummary {
  return {
    totalEntries: dataContext.counts.total,
    sensitiveEntries: dataContext.counts.sensitive,
    nonSensitiveEntries: dataContext.counts.nonSensitive,
    availableKeys: dataContext.entries.map((entry) => ({
      key: redactKeyName(entry.key),
      source: entry.source,
      sensitive: entry.sensitive || isSensitiveKeyName(entry.key)
    }))
  };
}
