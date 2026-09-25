"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDestinationClaimId = buildDestinationClaimId;
exports.buildMobileDestinationClaimManifest = buildMobileDestinationClaimManifest;
exports.parseStepDestinationExpectations = parseStepDestinationExpectations;
exports.validateStepDestinationExpectations = validateStepDestinationExpectations;
const node_crypto_1 = require("node:crypto");
/**
 * Build a deterministic destination claim ID from a canonical requirement identity
 * and a destination facet. The ID survives scenario regeneration because it depends
 * only on stable canonical identifiers, not on scenarioId, screenKey, or UI text.
 *
 * Conceptual: destinationClaimId = H(requiredRequirementId + ":" + destinationFacet)
 */
function buildDestinationClaimId(canonicalRequirementId, destinationFacet) {
    const normalizedReq = canonicalRequirementId.trim().toUpperCase();
    const normalizedFacet = destinationFacet.trim().toLowerCase();
    const raw = `dest_claim:${normalizedReq}:${normalizedFacet}`;
    return (0, node_crypto_1.createHash)("sha256").update(raw).digest("hex").slice(0, 16);
}
/**
 * Build a destination claim manifest from authoritative sources.
 * This MUST be called BEFORE the provider to establish which claims are valid.
 *
 * Accepts authoritative bindings (validated bindings from trusted sources).
 * Pending candidates and runtime observations are excluded by design.
 */
function buildMobileDestinationClaimManifest(_canonicalRequirementIds, _routeProfileScreenIds, authoritativeBindings) {
    if (!authoritativeBindings || authoritativeBindings.length === 0) {
        // No authoritative source establishes requirement→destination binding.
        // The manifest is empty by design:
        // - Provider cannot create destination claims
        // - destinationSemanticAuthority remains pending
        // - trustedForReuse remains false
        return [];
    }
    // Build claims from validated authoritative bindings only.
    const claims = [];
    const canonicalSet = new Set(_canonicalRequirementIds.map((c) => c.trim().toUpperCase()));
    for (const binding of authoritativeBindings) {
        if (binding.validationStatus !== "validated")
            continue;
        const validReqIds = binding.requirementIds.filter((id) => canonicalSet.has(id.toUpperCase()));
        if (validReqIds.length === 0)
            continue;
        if (!binding.semanticIdentity?.trim())
            continue;
        // Build claim ID using same algorithm as buildDestinationClaimId
        const sorted = validReqIds.map((r) => r.trim().toUpperCase()).sort().join("|");
        const normalizedIdentity = binding.semanticIdentity.trim().toLowerCase();
        const raw = `dest_claim:${sorted}:${normalizedIdentity}`;
        const destinationClaimId = (0, node_crypto_1.createHash)("sha256").update(raw).digest("hex").slice(0, 16);
        claims.push({
            destinationClaimId,
            requirementIds: validReqIds,
            kind: "semantic_destination",
            semanticIdentity: binding.semanticIdentity.trim(),
            source: binding.source,
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
function parseStepDestinationExpectations(value, stepCount, coveredCriteria, manifest) {
    if (!Array.isArray(value) || value.length === 0)
        return undefined;
    if (!manifest || manifest.length === 0)
        return undefined;
    const canonicalSet = new Set(coveredCriteria.map((c) => c.trim().toUpperCase()));
    const manifestByClaimId = new Map();
    for (const def of manifest) {
        manifestByClaimId.set(def.destinationClaimId, def);
    }
    const expectations = [];
    for (const raw of value) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            continue;
        const r = raw;
        const idx = typeof r.stepIndex === "number" && Number.isInteger(r.stepIndex) && r.stepIndex >= 0 && r.stepIndex < stepCount
            ? r.stepIndex
            : undefined;
        if (idx === undefined)
            continue;
        // Provider can only reference an existing claim by destinationClaimId.
        const claimId = typeof r.destinationClaimId === "string" ? r.destinationClaimId.trim() : undefined;
        if (!claimId)
            continue;
        const definition = manifestByClaimId.get(claimId);
        if (!definition)
            continue;
        // Validate that the claim's requirementIds are in coveredCriteria.
        const validReqIds = definition.requirementIds.filter((id) => canonicalSet.has(id.toUpperCase()));
        if (validReqIds.length === 0)
            continue;
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
function validateStepDestinationExpectations(expectations, stepRequirementRefs) {
    if (!stepRequirementRefs || stepRequirementRefs.length === 0)
        return [];
    const refsByStep = new Map();
    for (const ref of stepRequirementRefs) {
        refsByStep.set(ref.stepIndex, new Set(ref.requirementIds.map((id) => id.toUpperCase())));
    }
    return expectations.filter((exp) => {
        const refs = refsByStep.get(exp.stepIndex);
        if (!refs)
            return false;
        // At least one requirement must overlap between expectation and stepRequirementRefs.
        return exp.requirementIds.some((id) => refs.has(id.toUpperCase()));
    });
}
