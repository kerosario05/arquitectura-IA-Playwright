"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AiProviderError = void 0;
class AiProviderError extends Error {
    code;
    diagnostics;
    constructor(code, message, diagnostics) {
        super(message);
        this.code = code;
        this.diagnostics = diagnostics;
        this.name = "AiProviderError";
    }
}
exports.AiProviderError = AiProviderError;
