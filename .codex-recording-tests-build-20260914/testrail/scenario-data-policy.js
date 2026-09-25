"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveScenarioDataPolicy = resolveScenarioDataPolicy;
function hasValidConstraints(capability) {
    const constraints = capability.constraints;
    if (!constraints)
        return true;
    if (constraints.min !== undefined && constraints.max !== undefined && constraints.min > constraints.max)
        return false;
    if (constraints.minLength !== undefined && constraints.maxLength !== undefined && constraints.minLength > constraints.maxLength)
        return false;
    return true;
}
function resolveScenarioDataPolicy(requirement) {
    const capability = requirement.fieldCapability;
    if (requirement.sensitive === true || capability?.kind === "password")
        return "trusted_required";
    const intent = requirement.inputIntent;
    if (intent && intent.mode !== "set_value")
        return "explicit_value";
    if (intent?.mode === "set_value" && requirement.explicitValue !== undefined)
        return "explicit_value";
    if (requirement.inputRole !== "scenario")
        return "unresolved";
    if (!capability || !hasValidConstraints(capability))
        return "unresolved";
    if (["email", "tel", "number", "date", "datetime"].includes(capability.kind)) {
        return "synthetic_allowed";
    }
    if (["text", "select", "radio", "file"].includes(capability.kind))
        return "manual_required";
    return "unresolved";
}
