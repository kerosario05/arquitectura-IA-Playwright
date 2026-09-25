"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildSafeDataContextSummary = buildSafeDataContextSummary;
const sensitiveKeyHints = ["password", "pass", "token", "secret", "api_key", "apikey", "bearer", "key"];
function normalize(value) {
    return value
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
}
function isSensitiveKeyName(key) {
    const normalized = normalize(key);
    return sensitiveKeyHints.some((hint) => normalized.includes(normalize(hint)));
}
function redactKeyName(key) {
    if (!isSensitiveKeyName(key)) {
        return key;
    }
    return key.toUpperCase() === "APP_USERNAME" || key.toUpperCase() === "APP_PASSWORD" ? key : `[REDACTED_KEY:${key}]`;
}
function buildSafeDataContextSummary(dataContext) {
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
