import { createHash } from "node:crypto";

/**
 * Structured destination claim for MOBILE route transitions.
 *
 * A destination claim is a DECLARATION of where a step is expected to land,
 * NOT a runtime validation. It answers "what functional destination does this
 * step produce?" without asserting that the destination was actually reached.
 *
 * Claims are keyed by (requirementId + destination facet) to survive scenario
 * regeneration. The claim ID is deterministic and does NOT depend on scenarioId,
 * screenKey, fingerprint, activity, locator, or UI text.
 *
 * Authority boundary:
 * - DestinationClaimDefinition = claim that exists BEFORE the provider (canonical/trusted)
 * - StepDestinationExpectation = provider's REFERENCE of a pre-existing claim to a step
 * The provider NEVER creates claims — it only associates existing claims to steps.
 */

/** Source from which the destination claim was derived. */
export type DestinationClaimSource =
  | "canonical_requirement"
  | "provider_declaration"
  | "trusted_config"
  | "validated_knowledge"
  | "human_validation";

/** Trust level of the destination claim. Only "validated_knowledge" grants semantic authority. */
export type DestinationClaimTrustLevel = "declared" | "validated";

/** Kind of destination semantic identity. */
export type DestinationClaimKind = "semantic_destination";

/**
 * A destination claim definition that exists BEFORE the provider call.
 * Built from authoritative sources (canonical requirements, trusted config, validated knowledge).
 * The provider can only REFERENCE these claims, not create new ones.
 */
export type DestinationClaimDefinition = {
  /** Deterministic claim ID: canonical requirement identity + destination facet. */
  destinationClaimId: string;
  /** Canonical requirement IDs this destination claim relates to. */
  requirementIds: string[];
  /** Kind of semantic identity. Currently only "semantic_destination". */
  kind: DestinationClaimKind;
  /** Abstract semantic identity of the destination. NOT UI text. */
  semanticIdentity: string;
  /** Source from which this claim was derived. */
  source: Exclude<DestinationClaimSource, "provider_declaration">;
  /** Trust level: "validated" = runtime-confirmed. */
  trustLevel: DestinationClaimTrustLevel;
};

/**
 * A structured destination expectation associated with a specific step.
 * This is a REFERENCE to a pre-existing DestinationClaimDefinition, not a new claim.
 */
export type StepDestinationExpectation = {
  /** 0-based step index (0 = launchApp). */
  stepIndex: number;
  /** Canonical requirement IDs (resolved from manifest, NOT from provider). */
  requirementIds: string[];
  /** Deterministic claim ID (resolved from manifest, NOT from provider). */
  destinationClaimId: string;
  /** Kind of semantic identity (resolved from manifest). */
  kind: DestinationClaimKind;
  /** Abstract semantic identity (resolved from manifest, NOT from provider). */
  semanticIdentity: string;
  /** Source from which the CLAIM was derived (resolved from manifest). */
  source: DestinationClaimSource;
  /** Trust level (resolved from manifest). */
  trustLevel: DestinationClaimTrustLevel;
};

/**
 * Build a deterministic destination claim ID from a canonical requirement identity
 * and a destination facet. The ID survives scenario regeneration because it depends
 * only on stable canonical identifiers, not on scenarioId, screenKey, or UI text.
 *
 * Conceptual: destinationClaimId = H(requiredRequirementId + ":" + destinationFacet)
 */
export function buildDestinationClaimId(
  canonicalRequirementId: string,
  destinationFacet: string,
): string {
  const normalizedReq = canonicalRequirementId.trim().toUpperCase();
  const normalizedFacet = destinationFacet.trim().toLowerCase();
  const raw = `dest_claim:${normalizedReq}:${normalizedFacet}`;
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

/**
 * Build a destination claim manifest from authoritative sources.
 * This MUST be called BEFORE the provider to establish which claims are valid.
 *
 * Accepts authoritative bindings (validated bindings from trusted sources).
 * Pending candidates and runtime observations are excluded by design.
 */
export function buildMobileDestinationClaimManifest(
  _canonicalRequirementIds: string[],
  _routeProfileScreenIds?: string[],
  authoritativeBindings?: Array<{
    requirementIds: string[];
    semanticIdentity: string;
    validationStatus: string;
  }>,
): DestinationClaimDefinition[] {
  if (!authoritativeBindings || authoritativeBindings.length === 0) {
    // No authoritative source establishes requirement→destination binding.
    // The manifest is empty by design:
    // - Provider cannot create destination claims
    // - destinationSemanticAuthority remains pending
    // - trustedForReuse remains false
    return [];
  }
  // Build claims from validated authoritative bindings only.
  const claims: DestinationClaimDefinition[] = [];
  const canonicalSet = new Set(_canonicalRequirementIds.map((c) => c.trim().toUpperCase()));
  for (const binding of authoritativeBindings) {
    if (binding.validationStatus !== "validated") continue;
    const validReqIds = binding.requirementIds.filter((id) => canonicalSet.has(id.toUpperCase()));
    if (validReqIds.length === 0) continue;
    if (!binding.semanticIdentity?.trim()) continue;
    // Build claim ID using same algorithm as buildDestinationClaimId
    const sorted = validReqIds.map((r) => r.trim().toUpperCase()).sort().join("|");
    const normalizedIdentity = binding.semanticIdentity.trim().toLowerCase();
    const raw = `dest_claim:${sorted}:${normalizedIdentity}`;
    const destinationClaimId = createHash("sha256").update(raw).digest("hex").slice(0, 16);
    claims.push({
      destinationClaimId,
      requirementIds: validReqIds,
      kind: "semantic_destination",
      semanticIdentity: binding.semanticIdentity.trim(),
      source: binding.source as "canonical_requirement" | "trusted_config" | "validated_knowledge" | "human_validation",
      trustLevel: "validated",
    });
  }
  return claims;
}

/**
 * Parse stepDestinationExpectations from raw AI output.
 * Validates structure, normalizes requirement IDs, and resolves metadata from manifest.
 * Returns undefined if no valid expectations exist.
 *
 * The manifest is the AUTHORITATIVE source for claim metadata. The provider's
 * output is only a REFERENCE (stepIndex → destinationClaimId), not a definition.
 * The provider CANNOT choose semanticIdentity, requirementIds, or other claim metadata.
 */
export function parseStepDestinationExpectations(
  value: unknown,
  stepCount: number,
  coveredCriteria: string[],
  manifest?: DestinationClaimDefinition[],
): StepDestinationExpectation[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  if (!manifest || manifest.length === 0) return undefined;
  const canonicalSet = new Set(coveredCriteria.map((c) => c.trim().toUpperCase()));
  const manifestByClaimId = new Map<string, DestinationClaimDefinition>();
  for (const def of manifest) {
    manifestByClaimId.set(def.destinationClaimId, def);
  }
  const expectations: StepDestinationExpectation[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const r = raw as Record<string, unknown>;
    const idx = typeof r.stepIndex === "number" && Number.isInteger(r.stepIndex) && r.stepIndex >= 0 && r.stepIndex < stepCount
      ? r.stepIndex
      : undefined;
    if (idx === undefined) continue;
    // Provider can only reference an existing claim by destinationClaimId.
    const claimId = typeof r.destinationClaimId === "string" ? r.destinationClaimId.trim() : undefined;
    if (!claimId) continue;
    const definition = manifestByClaimId.get(claimId);
    if (!definition) continue;
    // Validate that the claim's requirementIds are in coveredCriteria.
    const validReqIds = definition.requirementIds.filter((id) => canonicalSet.has(id.toUpperCase()));
    if (validReqIds.length === 0) continue;
    // Resolve ALL metadata from manifest — provider cannot override.
    expectations.push({
      stepIndex: idx,
      requirementIds: validReqIds,
      destinationClaimId: definition.destinationClaimId,
      kind: definition.kind,
      semanticIdentity: definition.semanticIdentity,
      source: definition.source,
      trustLevel: definition.trustLevel,
    });
  }
  return expectations.length > 0 ? expectations : undefined;
}

/**
 * Validate stepDestinationExpectations against existing stepRequirementRefs.
 * Ensures: (1) each expectation's requirementIds overlap with stepRequirementRefs
 * for that step, (2) stepIndex is valid, (3) claim ID is deterministic.
 * Drops invalid expectations silently (fail-closed).
 */
export function validateStepDestinationExpectations(
  expectations: StepDestinationExpectation[],
  stepRequirementRefs: Array<{ stepIndex: number; requirementIds: string[] }> | undefined,
): StepDestinationExpectation[] {
  if (!stepRequirementRefs || stepRequirementRefs.length === 0) return [];
  const refsByStep = new Map<number, Set<string>>();
  for (const ref of stepRequirementRefs) {
    refsByStep.set(ref.stepIndex, new Set(ref.requirementIds.map((id) => id.toUpperCase())));
  }
  return expectations.filter((exp) => {
    const refs = refsByStep.get(exp.stepIndex);
    if (!refs) return false;
    // At least one requirement must overlap between expectation and stepRequirementRefs.
    return exp.requirementIds.some((id) => refs.has(id.toUpperCase()));
  });
}
