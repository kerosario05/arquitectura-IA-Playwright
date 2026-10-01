/**
 * Whether a recorded structural owner (a control identified by its structure, not by a text or
 * attribute locator) can be re-found at execution time -- the ONE rule shared by the replay
 * resolver (target-resolver.ts resolveRecordedStructuralOwner) and the spec compiler
 * (deterministic-spec-compiler.ts).
 *
 * The compiler used to keep its own copy of the resolver's gates. When the resolver learned to
 * re-find an icon-only back arrow by its scope and topology (recording 73f03712), the copy did
 * not, so the replay passed while spec generation refused the very same button. Both now ask
 * this function; a change here changes both.
 *
 * Pure: no Playwright, no DOM. The live resolver still counts matches on the page and fails
 * closed on anything but exactly one visible, enabled element -- eligibility only says it is
 * worth asking.
 */

export type StructuralOwnerContext = {
  owner?: { tag: string; role?: string };
  stableDirectAttributes?: Record<string, string>;
  stableDescendants?: unknown[];
  semanticShape?: string[];
  deterministicStructuralIdentity?: boolean;
  identityAmbiguous?: boolean;
  topologyTieBreakUnique?: boolean;
  structuralIdentityMatchCount?: number;
  topologySignature?: string;
  scopeIdentity?: { strategy?: string; value?: string };
  targetFingerprint?: string;
  captureScopeUnique?: boolean;
  captureTargetMatchCount?: number;
};

export type StructuralOwnerIneligibleReason =
  | "no_owner_in_certified_target"
  | "owner_not_deterministic"
  | "owner_identity_ambiguous_at_capture"
  | "scope_evidence_incomplete_at_capture"
  | "no_stable_anchor_or_topology_authority"
  | "owner_tag_invalid";

export type StructuralOwnerEligibility =
  | {
    eligible: true;
    /** Re-found by scope + shape + topology rather than by a deterministic identity. */
    scopedTopologyOwner: boolean;
    /** The capture proved the owner unique inside a stable scope. */
    scopedEvidence: boolean;
  }
  | { eligible: false; reason: StructuralOwnerIneligibleReason };

/**
 * Unique inside a stable scope at capture, fingerprinted, with a recorded topology and shape to
 * re-identify it by, and never flagged ambiguous: enough to re-find an owner that has no
 * deterministic identity (no attributes, no text).
 */
export function hasScopedTopologyAuthority(context: StructuralOwnerContext | undefined): boolean {
  return Boolean(
    context?.scopeIdentity?.strategy
    && context.scopeIdentity.value
    && context.targetFingerprint
    && context.captureScopeUnique === true
    && context.captureTargetMatchCount === 1
    && context.structuralIdentityMatchCount === 1
    && context.identityAmbiguous !== true
    && context.topologySignature
    && (context.semanticShape?.length ?? 0) > 0,
  );
}

export function evaluateStructuralOwnerEligibility(context: StructuralOwnerContext | undefined): StructuralOwnerEligibility {
  const owner = context?.owner;
  if (!context || !owner) return { eligible: false, reason: "no_owner_in_certified_target" };

  const scopedTopologyOwner = context.deterministicStructuralIdentity !== true && hasScopedTopologyAuthority(context);
  if (context.deterministicStructuralIdentity !== true && !scopedTopologyOwner) {
    return { eligible: false, reason: "owner_not_deterministic" };
  }
  if (context.identityAmbiguous === true) {
    return { eligible: false, reason: "owner_identity_ambiguous_at_capture" };
  }

  const scopeIdentity = context.scopeIdentity;
  const scopedEvidence = Boolean(
    scopeIdentity?.strategy
    && scopeIdentity.value
    && context.targetFingerprint
    && context.captureScopeUnique === true
    && context.captureTargetMatchCount === 1,
  );
  if (scopeIdentity && !scopedEvidence) {
    return { eligible: false, reason: "scope_evidence_incomplete_at_capture" };
  }

  // A topology-tiebroken owner may have no durable attribute/descendant anchor: its bounded
  // semantic shape is the recorded structural authority, already proven unique at capture. The
  // shape stays mandatory so the owner tag alone can never become a broad locator.
  const topologyAuthority = (context.topologyTieBreakUnique === true || scopedTopologyOwner)
    && context.structuralIdentityMatchCount === 1
    && (context.semanticShape?.length ?? 0) > 0;
  const hasStableAnchor = Object.keys(context.stableDirectAttributes ?? {}).length > 0
    || (context.stableDescendants?.length ?? 0) > 0;
  if (!hasStableAnchor && !topologyAuthority) {
    return { eligible: false, reason: "no_stable_anchor_or_topology_authority" };
  }
  if (!/^[a-z][a-z0-9-]*$/i.test(owner.tag)) {
    return { eligible: false, reason: "owner_tag_invalid" };
  }
  return { eligible: true, scopedTopologyOwner, scopedEvidence };
}

/**
 * The evidence fields the rule above reads besides the owner identity itself. Anything that
 * rebuilds a structural context (the technical-target materializer, per certification tier) must
 * carry ALL of them: dropping one silently turns an eligible owner into an ineligible one -- the
 * materializer used to copy fields by hand and lost the scope evidence, so a spec could not be
 * generated for a button the replay resolved fine (recording 73f03712).
 */
export const STRUCTURAL_RESOLUTION_EVIDENCE_KEYS = [
  "topologyTieBreakUnique",
  "topologySignature",
  "scopeIdentity",
  "targetFingerprint",
  "captureScopeUnique",
  "captureTargetMatchCount",
] as const;

export type StructuralResolutionEvidence = Pick<StructuralOwnerContext, (typeof STRUCTURAL_RESOLUTION_EVIDENCE_KEYS)[number]>;

type StructuralResolutionEvidenceKey = (typeof STRUCTURAL_RESOLUTION_EVIDENCE_KEYS)[number];

/** The resolution evidence present on `source` (its own field types kept), omitting absent fields. */
export function pickStructuralResolutionEvidence<T extends Partial<Record<StructuralResolutionEvidenceKey, unknown>>>(
  source: T | undefined,
): Partial<Pick<T, StructuralResolutionEvidenceKey & keyof T>> {
  const evidence: Record<string, unknown> = {};
  for (const key of STRUCTURAL_RESOLUTION_EVIDENCE_KEYS) {
    if (source?.[key] !== undefined) evidence[key] = source[key];
  }
  return evidence as Partial<Pick<T, StructuralResolutionEvidenceKey & keyof T>>;
}
