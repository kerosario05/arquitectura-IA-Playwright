"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizeVisibleText = sanitizeVisibleText;
exports.isPotentiallySensitiveText = isPotentiallySensitiveText;
exports.sanitizeSnapshotText = sanitizeSnapshotText;
const MAX_LENGTH = 200;
function sanitizeVisibleText(value) {
    return value.replace(/\s+/g, " ").trim();
}
function isPotentiallySensitiveText(value) {
    const text = sanitizeVisibleText(value).toLowerCase();
    if (!text) {
        return false;
    }
    const sensitiveHints = [
        "password",
        "token",
        "otp",
        "pin",
        "api key",
        "apikey",
        "bearer",
        "secret",
        "contrasena",
        "contraseña",
        "clave"
    ];
    if (sensitiveHints.some((hint) => text.includes(hint))) {
        return true;
    }
    const digits = text.replace(/\D/g, "");
    return digits.length >= 12;
}
function sanitizeSnapshotText(value) {
    const cleaned = sanitizeVisibleText(value);
    if (!cleaned) {
        return "";
    }
    if (isPotentiallySensitiveText(cleaned)) {
        return "[REDACTED]";
    }
    return cleaned.length > MAX_LENGTH ? `${cleaned.slice(0, MAX_LENGTH)}...` : cleaned;
}
