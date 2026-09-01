export type StepAuthority = {
  sourceType: "canonical_requirement" | "explicit_trusted_config" | "validated_knowledge" | "trusted_route" | "provider" | "declared_hint" | "post_processor" | "unknown";
  sourceId?: string;
  trustLevel: "trusted" | "declared" | "untrusted";
  scope?: "global" | "branch" | "scenario";
};

export type StepAuthorityEvaluation = StepAuthority & { authorityValid: boolean; authorityReason: string; claimType: "action" | "visibility_assertion" | "semantic_destination_assertion" | "technical_route" | "unknown" };

export type StepClaimLineage = { stepIndex: number; claimId: string; [key: string]: unknown };

export function remapStepClaimsByOrigins<T extends StepClaimLineage>(
  stepClaims: readonly T[] | undefined,
  stepOrigins: readonly (number | undefined)[],
): T[] {
  if (!stepClaims?.length) return [];
  const remapped: T[] = [];
  const seen = new Set<string>();
  for (const claim of stepClaims) {
    const finalIndex = stepOrigins.findIndex((origin) => origin === claim.stepIndex);
    if (finalIndex < 0) continue;
    const key = `${finalIndex}:${claim.claimId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    remapped.push({ ...claim, stepIndex: finalIndex });
  }
  return remapped;
}

export function validateStepClaimIndices(
  stepClaims: readonly StepClaimLineage[] | undefined,
  stepCount: number,
): { valid: boolean; claimLineageError: string[] } {
  const claimLineageError = (stepClaims ?? [])
    .filter((claim) => !Number.isInteger(claim.stepIndex) || claim.stepIndex < 0 || claim.stepIndex >= stepCount)
    .map((claim) => `claim ${claim.claimId} has invalid stepIndex ${claim.stepIndex} for ${stepCount} steps`);
  return { valid: claimLineageError.length === 0, claimLineageError };
}

export function resolveStepClaimType(
  declaredClaimType: StepAuthorityEvaluation["claimType"] | undefined,
  requirementCategories: string[],
): StepAuthorityEvaluation["claimType"] {
  if (requirementCategories.length > 0 && requirementCategories.every((category) => category === "visibility")) {
    return "visibility_assertion";
  }
  if (requirementCategories.length > 0 && requirementCategories.every((category) => category === "action" || category === "prerequisite")) {
    return "action";
  }
  return declaredClaimType ?? "unknown";
}

export function resolveRequirementFacet(
  category: string | undefined,
  claimType: StepAuthorityEvaluation["claimType"] | undefined,
  declaredFacet?: string,
): string | undefined {
  if (declaredFacet) return declaredFacet;
  if (category === "branch") {
    if (claimType === "action") return "activation";
    if (claimType === "semantic_destination_assertion") return "destination";
    return undefined;
  }
  if (category === "visibility") return "visibility";
  if (category === "action" || category === "prerequisite") return "action";
  return undefined;
}

export function evaluateStepAuthority(input: {
  step: string;
  requirement?: { id?: string; category?: string; associatedBranchId?: string; facets?: string[] };
  requirementFacet?: string;
  branchId?: string;
  configuredControls?: string[];
  configTrusted: boolean;
  validatedRouteControls?: string[];
  validatedKnowledgeControls?: string[];
  knowledgeTrust?: "technical" | "semantic" | "execution";
  claimType?: StepAuthorityEvaluation["claimType"];
}): StepAuthorityEvaluation {
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
