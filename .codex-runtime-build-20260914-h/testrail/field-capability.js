"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveFieldCapability = resolveFieldCapability;
const KNOWN_KINDS = new Set([
    "text", "password", "number", "email", "tel", "date", "datetime",
    "select", "checkbox", "radio", "file",
]);
function resolveFieldCapability(requirement) {
    const normalizedType = requirement.controlType?.trim().toLowerCase();
    const kind = normalizedType
        ? (/^(?:secret|password|credential)$/i.test(normalizedType)
            ? "password"
            : KNOWN_KINDS.has(normalizedType) ? normalizedType : "unknown")
        : (requirement.sensitive === true ? "password" : "text");
    if (kind !== "select")
        return { kind };
    const allowedValues = Array.isArray(requirement.allowedValues)
        ? requirement.allowedValues.map((value) => String(value))
        : [];
    return {
        kind,
        allowedValues,
        optionSource: allowedValues.length > 0 ? "contract" : "unknown",
    };
}
