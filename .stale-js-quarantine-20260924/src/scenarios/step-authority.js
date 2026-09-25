"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.remapStepClaimsByOrigins = remapStepClaimsByOrigins;
exports.validateStepClaimIndices = validateStepClaimIndices;
exports.resolveStepClaimType = resolveStepClaimType;
exports.resolveRequirementFacet = resolveRequirementFacet;
exports.evaluateStepAuthority = evaluateStepAuthority;
function remapStepClaimsByOrigins(stepClaims, stepOrigins) {
    if (!stepClaims?.length)
        return [];
    const remapped = [];
    const seen = new Set();
    for (const claim of stepClaims) {
        const finalIndex = stepOrigins.findIndex((origin) => origin === claim.stepIndex);
        if (finalIndex < 0)
            continue;
        const key = `${finalIndex}:${claim.claimId}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        remapped.push({ ...claim, stepIndex: finalIndex });
    }
    return remapped;
}
function validateStepClaimIndices(stepClaims, stepCount) {
    const claimLineageError = (stepClaims ?? [])
        .filter((claim) => !Number.isInteger(claim.stepIndex) || claim.stepIndex < 0 || claim.stepIndex >= stepCount)
        .map((claim) => `claim ${claim.claimId} has invalid stepIndex ${claim.stepIndex} for ${stepCount} steps`);
    return { valid: claimLineageError.length === 0, claimLineageError };
}
function resolveStepClaimType(declaredClaimType, requirementCategories) {
    if (requirementCategories.length > 0 && requirementCategories.every((category) => category === "visibility")) {
        return "visibility_assertion";
    }
    if (requirementCategories.length > 0 && requirementCategories.every((category) => category === "action" || category === "prerequisite")) {
        return "action";
    }
    return declaredClaimType ?? "unknown";
}
function resolveRequirementFacet(category, claimType, declaredFacet) {
    if (declaredFacet)
        return declaredFacet;
    if (category === "branch") {
        if (claimType === "action")
            return "activation";
        if (claimType === "semantic_destination_assertion")
            return "destination";
        return undefined;
    }
    if (category === "visibility")
        return "visibility";
    if (category === "action" || category === "prerequisite")
        return "action";
    return undefined;
}
function evaluateStepAuthority(input) {
    const requirement = input.requirement;
    const claimType = input.claimType ?? "unknown";
    if (requirement?.id) {
        const sameBranch = !requirement.associatedBranchId || requirement.associatedBranchId === input.branchId;
        const claimAllowed = requirement.category === "destination"
            ? claimType === "semantic_destination_assertion"
            : requirement.category === "visibility"
                ? claimType === "visibility_assertion"
                : requirement.category === "action"
                    ? claimType === "action"
                    : requirement.category === "branch"
                        ? (input.requirementFacet === "activation" && claimType === "action")
                            || (input.requirementFacet === "destination" && claimType === "semantic_destination_assertion")
                        : true;
        return {
            sourceType: "canonical_requirement",
            sourceId: requirement.id,
            trustLevel: sameBranch && claimAllowed ? "trusted" : "untrusted",
            scope: "branch",
            authorityValid: sameBranch && claimAllowed,
            authorityReason: !sameBranch
                ? "branch scope mismatch"
                : requirement.category === "branch" && !input.requirementFacet
                    ? "branch facet is missing"
                    : !claimAllowed
                        ? "claim type is outside requirement facet scope"
                        : "canonical requirement facet matched",
            claimType,
        };
    }
    if (input.configTrusted && input.configuredControls?.some((control) => input.step.includes(control))) {
        return { sourceType: "explicit_trusted_config", trustLevel: "trusted", scope: "global", authorityValid: true, authorityReason: "explicit configured field matched", claimType };
    }
    if (input.validatedRouteControls?.some((control) => input.step.includes(control))) {
        return { sourceType: "trusted_route", sourceId: "route_profile.validated_field", trustLevel: "trusted", scope: "global", authorityValid: true, authorityReason: "validated route field matched", claimType };
    }
    if (input.validatedKnowledgeControls?.some((control) => input.step.includes(control))) {
        return { sourceType: "validated_knowledge", sourceId: "knowledge.validated_scope", trustLevel: "trusted", scope: "global", authorityValid: true, authorityReason: "validated Knowledge field matched", claimType };
    }
    if ((input.knowledgeTrust === "semantic" || input.knowledgeTrust === "execution") && claimType !== "unknown") {
        return { sourceType: "validated_knowledge", sourceId: "knowledge.validated_scope", trustLevel: "trusted", scope: "global", authorityValid: true, authorityReason: "validated Knowledge scope matched", claimType };
    }
    return { sourceType: "provider", trustLevel: "untrusted", authorityValid: false, authorityReason: "functional claim has no structured authority", claimType };
}
