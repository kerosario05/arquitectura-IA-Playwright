"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseAiResponse = parseAiResponse;
function stripBOM(text) {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}
function fixMojibake(text) {
    // Common Windows-1252 to UTF-8 mojibake patterns
    // These occur when UTF-8 bytes are misinterpreted as Windows-1252/Latin-1
    const replacements = [
        // Already handled by proper UTF-8 reading, but add safety net
        // These patterns match common mojibake sequences
        [/\uFFFD/g, ""], // Remove replacement characters
    ];
    let result = text;
    for (const [pattern, replacement] of replacements) {
        result = result.replace(pattern, replacement);
    }
    return result;
}
function stripMarkdownFences(text) {
    let cleaned = text.trim();
    // Remove ```json ... ``` or ``` ... ```
    const fenceRegex = /^```(?:json)?\s*\n([\s\S]*?)\n?```\s*$/i;
    const match = cleaned.match(fenceRegex);
    if (match)
        return match[1].trim();
    // Remove single ``` fences
    cleaned = cleaned.replace(/^```\s*\n?/i, "");
    cleaned = cleaned.replace(/\n?```\s*$/i, "");
    return cleaned.trim();
}
function extractBalancedJsonObject(text) {
    let braceCount = 0;
    let startIdx = -1;
    let inString = false;
    let escapeNext = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (escapeNext) {
            escapeNext = false;
            continue;
        }
        if (ch === "\\" && inString) {
            escapeNext = true;
            continue;
        }
        if (ch === '"') {
            inString = !inString;
            continue;
        }
        if (inString)
            continue;
        if (ch === "{") {
            if (braceCount === 0)
                startIdx = i;
            braceCount++;
        }
        else if (ch === "}") {
            braceCount--;
            if (braceCount === 0 && startIdx !== -1) {
                return text.slice(startIdx, i + 1);
            }
        }
    }
    return null;
}
function looksLikeCsv(text) {
    const lines = text.split("\n").filter(l => l.trim());
    if (lines.length < 2)
        return false;
    const firstLine = lines[0];
    const commaCount = (firstLine.match(/,/g) || []).length;
    return commaCount >= 3 && firstLine.includes("Título");
}
function parseAiResponse(rawText) {
    if (!rawText || !rawText.trim())
        return null;
    let text = stripBOM(rawText);
    text = fixMojibake(text);
    // Try direct parse first
    try {
        const parsed = JSON.parse(text);
        if (isValidMcpResponse(parsed))
            return normalizeMcpResponse(parsed);
    }
    catch {
        // Not valid JSON as-is
    }
    // Try stripping markdown fences
    const stripped = stripMarkdownFences(text);
    if (stripped !== text) {
        try {
            const parsed = JSON.parse(stripped);
            if (isValidMcpResponse(parsed))
                return normalizeMcpResponse(parsed);
        }
        catch {
            // Still not valid
        }
    }
    // Try balanced JSON object extraction
    const jsonMatch = extractBalancedJsonObject(text);
    if (jsonMatch) {
        try {
            const parsed = JSON.parse(jsonMatch);
            if (isValidMcpResponse(parsed))
                return normalizeMcpResponse(parsed);
        }
        catch {
            // Invalid JSON in extracted object
        }
    }
    // Check if it looks like CSV
    if (looksLikeCsv(text)) {
        return null;
    }
    return null;
}
function isValidMcpResponse(obj) {
    if (typeof obj !== "object" || obj === null || Array.isArray(obj))
        return false;
    const r = obj;
    // Root must be an object, not an array
    if (Array.isArray(r))
        return false;
    // Must have scenarios array OR (rejected array with warnings)
    if (Array.isArray(r.scenarios))
        return true;
    if (Array.isArray(r.rejected) || Array.isArray(r.warnings))
        return true;
    return false;
}
function normalizeMcpResponse(obj) {
    const r = obj;
    const scenarios = Array.isArray(r.scenarios) ? r.scenarios : [];
    const warnings = Array.isArray(r.warnings) ? r.warnings : [];
    const rejected = Array.isArray(r.rejected) ? r.rejected : [];
    const routeProfile = typeof r.routeProfile === "object" && r.routeProfile !== null && !Array.isArray(r.routeProfile)
        ? r.routeProfile
        : {
            name: "",
            entry: [],
            aliases: {},
            intermediates: {},
            domainTerms: {},
            visibleControls: [],
            representativeFixture: {},
            notes: [],
        };
    return {
        appSlug: typeof r.appSlug === "string" ? r.appSlug : "",
        targetAppSlug: typeof r.targetAppSlug === "string" ? r.targetAppSlug : undefined,
        targetAppName: typeof r.targetAppName === "string" ? r.targetAppName : undefined,
        confidence: typeof r.confidence === "string" ? r.confidence : "medium",
        reason: typeof r.reason === "string" ? r.reason : "",
        functionalRoute: typeof r.functionalRoute === "string" ? r.functionalRoute : "",
        routeProfile: routeProfile,
        scenarios: scenarios,
        warnings: warnings,
        rejected: rejected,
    };
}
