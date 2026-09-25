"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.approveTestRailRequirementProposals = approveTestRailRequirementProposals;
const ALLOWED_CONTROL_TYPES = new Set([
    "text",
    "password",
    "secret",
    "credential",
    "select",
    "boolean",
    "checkbox",
    "radio",
    "file",
    "number",
    "email",
    "tel",
    "date",
    "url",
]);
function requirementFromProposal(proposal) {
    const key = typeof proposal.key === "string" ? proposal.key.trim() : "";
    const controlType = typeof proposal.controlType === "string" ? proposal.controlType.trim().toLowerCase() : "";
    if (proposal.approved !== true || !key || !controlType || !ALLOWED_CONTROL_TYPES.has(controlType))
        return undefined;
    return {
        key,
        ...(typeof proposal.label === "string" && proposal.label.trim() ? { label: proposal.label.trim() } : {}),
        controlType,
        ...(typeof proposal.required === "boolean" ? { required: proposal.required } : {}),
        ...(typeof proposal.sensitive === "boolean" ? { sensitive: proposal.sensitive } : {}),
        ...(Array.isArray(proposal.allowedValues) ? { allowedValues: [...proposal.allowedValues] } : {}),
    };
}
function sameRequirement(left, right) {
    return left.label === right.label
        && left.controlType === right.controlType
        && left.required === right.required
        && left.sensitive === right.sensitive
        && JSON.stringify(left.allowedValues) === JSON.stringify(right.allowedValues);
}
function approveTestRailRequirementProposals(input) {
    if (input.approvedProposals.length === 0) {
        return { caseId: input.caseId, approvedRequirements: [], status: "empty" };
    }
    const byKey = new Map();
    for (const proposal of input.approvedProposals) {
        const requirement = requirementFromProposal(proposal);
        if (!requirement)
            continue;
        const existing = byKey.get(requirement.key);
        if (existing && !sameRequirement(existing, requirement)) {
            return { caseId: input.caseId, approvedRequirements: [], status: "rejected" };
        }
        byKey.set(requirement.key, existing ?? requirement);
    }
    const approvedRequirements = Array.from(byKey.values());
    return {
        caseId: input.caseId,
        approvedRequirements,
        status: approvedRequirements.length > 0 ? "approved" : "rejected",
    };
}
