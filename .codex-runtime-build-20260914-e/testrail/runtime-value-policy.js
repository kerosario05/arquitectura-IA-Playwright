"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRuntimeInputValuePolicy = resolveRuntimeInputValuePolicy;
const SAFE_SUPPORTING_KINDS = new Set(["text", "number", "date", "email", "tel"]);
function resolveRuntimeInputValuePolicy(requirement) {
    if (requirement.sensitive === true || requirement.fieldCapability?.kind === "password") {
        return "trusted_required";
    }
    if (requirement.inputRole === "scenario")
        return "scenario_controlled";
    if (requirement.inputRole !== "supporting")
        return "unresolved";
    const capability = requirement.fieldCapability;
    if (!capability)
        return "unresolved";
    if (SAFE_SUPPORTING_KINDS.has(capability.kind))
        return "safe_synthetic";
    if (capability.kind === "select" && (capability.allowedValues?.length ?? 0) > 0) {
        return "safe_synthetic";
    }
    return "unresolved";
}
