"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseJsonObjectText = parseJsonObjectText;
const ai_provider_types_1 = require("./ai-provider.types");
function parseJsonObjectText(rawText) {
    try {
        const parsed = JSON.parse(rawText);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new Error("Expected a JSON object.");
        }
        return parsed;
    }
    catch (error) {
        throw new ai_provider_types_1.AiProviderError("ai_provider_invalid_json", `AI provider returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
}
