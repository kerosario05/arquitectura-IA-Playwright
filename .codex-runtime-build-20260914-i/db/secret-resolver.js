"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SecretResolutionError = void 0;
exports.resolveSecretRef = resolveSecretRef;
class SecretResolutionError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
exports.SecretResolutionError = SecretResolutionError;
function resolveSecretRef(secretRef) {
    if (!secretRef?.trim()) {
        throw new SecretResolutionError("secret_ref_empty", "secretRef is empty or missing");
    }
    if (!secretRef.startsWith("env:")) {
        throw new SecretResolutionError("secret_provider_not_supported", `unsupported secret provider: ${secretRef.split(":")[0]}`);
    }
    const varName = secretRef.slice(4);
    if (!varName) {
        throw new SecretResolutionError("secret_provider_not_supported", "env: prefix requires a variable name");
    }
    const value = process.env[varName];
    if (!value) {
        throw new SecretResolutionError("secret_not_found", `environment variable ${varName} is not set`);
    }
    return value;
}
