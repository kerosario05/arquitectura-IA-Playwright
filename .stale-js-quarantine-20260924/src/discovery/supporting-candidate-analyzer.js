"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyzeSupportingCandidates = analyzeSupportingCandidates;
const control_identity_1 = require("../types/control-identity");
const SUPPORTED_CAPABILITIES = new Set([
    "text", "email", "tel", "number", "select", "radio", "checkbox",
    "combobox", "autocomplete", "date", "datetime", "datepicker", "multiselect",
]);
function hasProtectedIntent(step) {
    return step.inputIntent?.mode === "leave_unset"
        || step.inputIntent?.mode === "invalid_value"
        || step.inputIntent?.mode === "preserve_state";
}
function representsScenarioIntent(step, requirementRef) {
    return Boolean(step.value !== undefined
        || step.valueKey !== undefined
        || step.inputIntent
        || step.requirementRefs?.includes(requirementRef));
}
function isComplete(control, kind) {
    if (control.complete !== undefined)
        return control.complete;
    if (kind === "checkbox")
        return control.checked;
    if (kind === "radio")
        return control.selected;
    if (["select", "combobox", "autocomplete", "datepicker", "multiselect"].includes(kind)) {
        return control.validSelection ?? control.selected ?? Boolean(control.value?.trim());
    }
    if (["text", "email", "tel", "number", "date", "datetime"].includes(kind))
        return Boolean(control.value?.trim());
    return undefined;
}
function findRequirement(control, requirements) {
    if (control.requirementRef)
        return requirements.find((requirement) => requirement.key === control.requirementRef);
    return requirements.length === 1 ? requirements[0] : undefined;
}
function analyzeOne(control, requirements, executionPlan, dependentAction) {
    const requirement = findRequirement(control, requirements);
    const requirementRef = requirement?.key ?? control.requirementRef;
    if (!requirement || !requirementRef)
        return { decision: "unresolved", reason: "requirement_identity_unresolved" };
    const controlIdentity = control.controlIdentity ?? undefined;
    if (!controlIdentity)
        return { decision: "unresolved", requirementRef, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "control_identity_unresolved" };
    const relatedSteps = executionPlan.filter((step) => step.requirementRefs?.includes(requirementRef) || step.controlIdentity !== undefined);
    let unknownCoverage = false;
    for (const step of relatedSteps) {
        const identityMatch = (0, control_identity_1.matchControlIdentity)(controlIdentity, step.controlIdentity);
        if (identityMatch === "unknown") {
            unknownCoverage = true;
            continue;
        }
        if (identityMatch === "match" && representsScenarioIntent(step, requirementRef)) {
            return {
                decision: hasProtectedIntent(step) ? "protected_intent" : "scenario_controlled",
                requirementRef,
                controlIdentity,
                valuePolicy: requirement.valuePolicy,
                fieldCapability: requirement.fieldCapability,
                reason: hasProtectedIntent(step) ? "scenario_input_intent_protected" : "scenario_step_covers_control",
            };
        }
    }
    if (unknownCoverage)
        return { decision: "unresolved", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "control_coverage_unknown" };
    if (control.visible !== true)
        return { decision: "unresolved", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "control_not_observable" };
    if (control.disabled !== false)
        return { decision: "unresolved", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "control_enabled_state_unknown" };
    if (control.required !== true && control.ariaRequired !== true)
        return { decision: "unresolved", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "required_evidence_missing" };
    const kind = requirement.fieldCapability?.kind;
    if (requirement.valuePolicy === "trusted_required")
        return { decision: "trusted_required", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "trusted_runtime_input_required" };
    if (!kind || !SUPPORTED_CAPABILITIES.has(kind))
        return { decision: "unresolved", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "capability_unresolved" };
    const complete = isComplete(control, kind);
    if (complete === undefined)
        return { decision: "unresolved", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "completion_state_unknown" };
    if (complete)
        return { decision: "already_satisfied", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "valid_runtime_state_present" };
    if (dependentAction?.causal !== true)
        return { decision: "unresolved", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "dependent_action_causality_missing" };
    if (requirement.valuePolicy !== "safe_synthetic")
        return { decision: "unresolved", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "supporting_value_policy_not_allowed" };
    return { decision: "supporting_candidate", requirementRef, controlIdentity, valuePolicy: requirement.valuePolicy, fieldCapability: requirement.fieldCapability, reason: "all_supporting_gates_passed" };
}
function analyzeSupportingCandidates(input) {
    const results = input.observedControls.map((control) => analyzeOne(control, input.runtimeRequirements, input.executionPlan, input.dependentAction));
    const seenCandidates = new Set();
    return results.filter((result) => {
        if (result.decision !== "supporting_candidate" || !result.controlIdentity)
            return true;
        if (seenCandidates.has(result.controlIdentity.fingerprint))
            return false;
        seenCandidates.add(result.controlIdentity.fingerprint);
        return true;
    });
}
