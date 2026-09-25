"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildRuntimeControlIdentity = buildRuntimeControlIdentity;
exports.matchControlIdentity = matchControlIdentity;
const node_crypto_1 = require("node:crypto");
function normalize(value) {
    const normalized = value?.trim().toLowerCase();
    return normalized || undefined;
}
function buildRuntimeControlIdentity(metadata) {
    const normalizedId = normalize(metadata.id);
    const signals = {
        tagName: normalize(metadata.tagName),
        inputType: normalize(metadata.inputType),
        role: normalize(metadata.role),
        name: normalize(metadata.name),
        id: normalizedId && !/^el-\d+$/.test(normalizedId) ? normalizedId : undefined,
        ariaControls: normalize(metadata.ariaControls),
        candidateLocator: metadata.candidateLocator
            ? {
                strategy: metadata.candidateLocator.strategy,
                ...(metadata.candidateLocator.role ? { role: normalize(metadata.candidateLocator.role) } : {}),
                ...(metadata.candidateLocator.exact !== undefined ? { exact: metadata.candidateLocator.exact } : {}),
            }
            : undefined,
    };
    const structuralSignals = [signals.tagName, signals.inputType, signals.role, signals.name, signals.id, signals.ariaControls, signals.candidateLocator?.strategy]
        .filter(Boolean);
    if (structuralSignals.length < 2)
        return null;
    const canonical = JSON.stringify(signals);
    return {
        fingerprint: (0, node_crypto_1.createHash)("sha256").update(canonical).digest("hex"),
        source: "runtime",
        signals,
    };
}
function matchControlIdentity(a, b) {
    if (!a || !b || !a.fingerprint || !b.fingerprint)
        return "unknown";
    return a.fingerprint === b.fingerprint ? "match" : "no_match";
}
