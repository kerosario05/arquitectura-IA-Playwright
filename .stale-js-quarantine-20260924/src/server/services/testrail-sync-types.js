"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildScenarioPreviewScenarioId = buildScenarioPreviewScenarioId;
exports.normalizeScenarioPreviewScenarioKey = normalizeScenarioPreviewScenarioKey;
function buildScenarioPreviewScenarioId(scenario, index, context) {
    void scenario;
    // Priority 1: For launch execution, generate a stable unique mapping identity from launchId + index.
    // A TestRail custom field is optional; the server-side mapping is authoritative.
    if (context?.launchId) {
        const shortLaunchId = context.launchId.slice(0, 8); // First 8 chars of UUID
        return `L-${shortLaunchId}-${String(index + 1).padStart(3, "0")}`;
    }
    // Priority 2: For preview runs with launch- cacheKey, use cacheKey + index to avoid collisions
    if (context?.cacheKey && context.cacheKey.startsWith("launch-")) {
        const shortCache = context.cacheKey.replace("launch-", "").slice(0, 8);
        return `L-${shortCache}-${String(index + 1).padStart(3, "0")}`;
    }
    // Fallback: Legacy PREVIEW-xxx format (only for standalone discovery:preview without launch context)
    return `PREVIEW-${String(index + 1).padStart(3, "0")}`;
}
function normalizeScenarioPreviewScenarioKey(value) {
    return value.trim().toLowerCase().replace(/\s+/g, " ");
}
