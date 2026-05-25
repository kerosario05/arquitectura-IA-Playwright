import type { FullConfig } from "../types/env.types";

export type DataContextEntry = {
  key: string;
  value: string;
  source:
    | "app_username"
    | "app_password"
    | "extra_login_field"
    | "test_data"
    | "test_data_alias"
    | "promoted_manifest"
    | "auto_generated"
    | "fixture"
    | "environment_variable";
  sensitive: boolean;
};

export type DataContext = {
  entries: DataContextEntry[];
  counts: {
    total: number;
    sensitive: number;
    nonSensitive: number;
  };
};

const sensitiveHints = [
  "password",
  "pass",
  "token",
  "secret",
  "key",
  "otp",
  "pin",
  "codigo",
  "código",
  "cedula",
  "cédula",
  "documento",
  "identificacion",
  "identificación"
];

function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isSensitive(key: string): boolean {
  const normalized = normalize(key);
  return sensitiveHints.some((hint) => normalized.includes(normalize(hint)));
}

function addEntry(
  map: Map<string, DataContextEntry>,
  key: string,
  value: unknown,
  source: DataContextEntry["source"],
  forceSensitive = false
): void {
  if (value === undefined || value === null) {
    return;
  }

  const valueStr = String(value).trim();
  if (!valueStr) {
    return;
  }

  const normalizedKey = normalize(key);
  if (map.has(normalizedKey)) {
    return;
  }

  map.set(normalizedKey, {
    key,
    value: valueStr,
    source,
    sensitive: forceSensitive || isSensitive(key)
  });
}

export function buildDataContext(config: FullConfig): DataContext {
  const entriesMap = new Map<string, DataContextEntry>();

  for (const [envKey, envValue] of Object.entries(process.env)) {
    if (!envValue) {
      continue;
    }
    if (envKey.startsWith("DATA_") || envKey.startsWith("TEST_DATA_") || envKey.startsWith("APP_DATA_")) {
      addEntry(entriesMap, envKey, envValue, "environment_variable");
    }
  }

  if (config.app.username) {
    addEntry(entriesMap, "APP_USERNAME", config.app.username, "app_username");
  }
  if (config.app.password) {
    addEntry(entriesMap, "APP_PASSWORD", config.app.password, "app_password", true);
  }

  for (const [key, value] of Object.entries(config.app.extraLoginFields ?? {})) {
    addEntry(entriesMap, key, value, "extra_login_field");
  }

  for (const [key, value] of Object.entries(config.app.testData)) {
    addEntry(entriesMap, key, value, "test_data");
  }

  for (const [canonicalKey, aliases] of Object.entries(config.app.testDataAliases ?? {})) {
    const canonical = entriesMap.get(normalize(canonicalKey));
    if (!canonical) continue;
    for (const alias of aliases) {
      addEntry(entriesMap, alias, canonical.value, "test_data_alias", canonical.sensitive);
    }
  }

  const entries = Array.from(entriesMap.values());
  const sensitiveCount = entries.filter((entry) => entry.sensitive).length;

  return {
    entries,
    counts: {
      total: entries.length,
      sensitive: sensitiveCount,
      nonSensitive: entries.length - sensitiveCount
    }
  };
}
