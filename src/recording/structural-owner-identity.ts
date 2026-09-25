export type StructuralStableAttributes = Record<string, string>;

export type StructuralStableDescendant = {
  relation: "descendant";
  tag: string;
  role?: string;
  stableAttributes: StructuralStableAttributes;
};

/**
 * The nearest LANDMARK ancestor (nav/main/aside/header/footer, or an equivalent ARIA landmark
 * role) an owner sits inside. Two elements can be structurally identical at the OWNER level
 * (same tag, same stable attributes, same descendants -- e.g. a sidebar link and a content-card
 * link sharing the same accessible name and href) while living in entirely different, equally
 * stable PARTS of the page. Without this, `structuralIdentityMatchCount` cannot tell them apart
 * and both get marked ambiguous, even though each one is individually a perfectly stable,
 * uniquely-locatable owner within its own landmark. This is never app/business-specific: it is
 * the same small, fixed set of generic HTML5/ARIA landmark roles for every project.
 */
export type StructuralLandmarkAncestor = { tag: string; role?: string };
export type StructuralScopeIdentity = { strategy: "id" | "data-testid" | "css"; value: string };

export type StructuralOwnerIdentity = {
  owner: { tag: string; role?: string };
  stableDirectAttributes: StructuralStableAttributes;
  stableDescendants: StructuralStableDescendant[];
  semanticShape: string[];
  landmarkAncestor?: StructuralLandmarkAncestor;
  deterministicStructuralIdentity: boolean;
  /**
   * Present only when a Capture V2 actionable owner was unique after a bounded,
   * content-blind topology tie-breaker. This is runtime structural evidence, not a locator.
   */
  topologyTieBreakUnique?: true;
  /** The bounded, content-blind topology signature (sorted tag counts) the tie-break matched. */
  topologySignature?: string;
  identityAmbiguous?: boolean;
  structuralIdentityMatchCount?: number;
  /** Optional stable technical scope used only for runtime re-resolution. */
  scopeIdentity?: StructuralScopeIdentity;
  /** Opaque, content-blind local fingerprint; never a locator or display text. */
  targetFingerprint?: string;
  captureScopeUnique?: boolean;
  captureTargetMatchCount?: number;
};

export type StructuralOwnerIdentityInput = {
  ownerTag?: string;
  ownerRole?: string;
  stableDirectAttributes?: StructuralStableAttributes;
  stableDescendants?: StructuralStableDescendant[];
  semanticShape?: string[];
  landmarkAncestor?: StructuralLandmarkAncestor;
  structuralIdentityMatchCount?: number;
  topologyTieBreakUnique?: boolean;
  topologySignature?: string;
  scopeIdentity?: StructuralScopeIdentity;
  targetFingerprint?: string;
  captureScopeUnique?: boolean;
  captureTargetMatchCount?: number;
};

/**
 * LAST-RESORT, EXECUTION-ONLY authority for a click whose owner/structural/related-control
 * evidence all fail: the ORIGINAL clicked target's own DYNAMIC accessible name/visible text
 * (never hardcoded, never read from `scenario.semanticField`/step text/TestRail), proven unique
 * at capture within one or more already-discovered stable technical scopes, and re-proven unique
 * at runtime before execution. Never a locator, never a certified owner, never promotes
 * `technicalReady`/`promotionReady` -- see `target-resolver.ts`'s scoped semantic runtime block
 * and `canonical-recording-contract.ts`'s `semanticRuntimeEligible`.
 */
export type SemanticRuntimeEvidence = {
  source: "accessible_name" | "visible_text";
  normalizedValue: string;
  role?: string;
  targetTag?: string;
  scopeAlternatives: Array<{ scopeIdentity: StructuralScopeIdentity; captureMatchCount: 1 }>;
  captureUniqueTarget: true;
};

/**
 * Structured, execution-only intent captured from the same stable DOM signals a Playwright
 * recorder exposes. This is deliberately data, never generated source code or a locator
 * certificate. Runtime must revalidate uniqueness before using it.
 */
export type PlaywrightRecorderEvidence = {
  kind: "role" | "text" | "label" | "placeholder" | "testid" | "segmented_input";
  role?: string;
  normalizedName?: string;
  targetTag?: string;
  scopeIdentity?: StructuralScopeIdentity;
  captureMatchCount?: number;
  runtimeResolutionRequired: true;
  segmentCount?: number;
  inputMode?: string;
  valueKey?: string;
};

/** Preserve the existing semantic runtime implementation as the shared resolver source. */
export function recorderEvidenceFromSemanticRuntime(
  evidence: SemanticRuntimeEvidence | undefined,
  role?: string,
): PlaywrightRecorderEvidence | undefined {
  if (!evidence || evidence.captureUniqueTarget !== true || evidence.scopeAlternatives.length !== 1) return undefined;
  const alternative = evidence.scopeAlternatives[0];
  return {
    kind: evidence.source === "accessible_name" && role ? "role" : "text",
    ...(role ? { role } : {}),
    normalizedName: evidence.normalizedValue,
    targetTag: evidence.targetTag,
    scopeIdentity: alternative.scopeIdentity,
    captureMatchCount: alternative.captureMatchCount,
    runtimeResolutionRequired: true,
  };
}

export function normalizeStructuralOwnerIdentity(input: StructuralOwnerIdentityInput): StructuralOwnerIdentity {
  const stableDirectAttributes = Object.fromEntries(Object.entries(input.stableDirectAttributes ?? {})
    .filter(([name, value]) => !["class", "className"].includes(name) && Boolean(value?.trim()))
    .sort(([left], [right]) => left.localeCompare(right)));
  const stableDescendants = [...(input.stableDescendants ?? [])]
    .map((descendant) => ({
      relation: "descendant" as const,
      tag: descendant.tag.trim().toLowerCase(),
      ...(descendant.role?.trim() ? { role: descendant.role.trim().toLowerCase() } : {}),
      stableAttributes: Object.fromEntries(Object.entries(descendant.stableAttributes ?? {})
        .filter(([, value]) => Boolean(value?.trim()))
        .sort(([left], [right]) => left.localeCompare(right))),
    }))
    .filter((descendant) => descendant.tag && Object.keys(descendant.stableAttributes).length > 0)
    .filter((descendant, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(descendant)) === index)
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const semanticShape = [...new Set((input.semanticShape ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean))].sort();
  const landmarkAncestor = input.landmarkAncestor?.tag?.trim()
    ? {
      tag: input.landmarkAncestor.tag.trim().toLowerCase(),
      ...(input.landmarkAncestor.role?.trim() ? { role: input.landmarkAncestor.role.trim().toLowerCase() } : {}),
    }
    : undefined;
  const count = input.structuralIdentityMatchCount;
  const hasStableEvidence = Object.keys(stableDirectAttributes).length > 0 || stableDescendants.length > 0;
  const topologyTieBreakUnique = input.topologyTieBreakUnique === true && count === 1;
  const topologySignature = input.topologySignature?.trim();
  return {
    owner: {
      tag: input.ownerTag?.trim().toLowerCase() || "unknown",
      ...(input.ownerRole?.trim() ? { role: input.ownerRole.trim().toLowerCase() } : {}),
    },
    stableDescendants,
    semanticShape,
    stableDirectAttributes,
    ...(landmarkAncestor ? { landmarkAncestor } : {}),
    deterministicStructuralIdentity: typeof count === "number"
      ? count === 1 && (hasStableEvidence || topologyTieBreakUnique)
      : hasStableEvidence,
    ...(topologyTieBreakUnique ? { topologyTieBreakUnique: true as const } : {}),
    ...(topologySignature ? { topologySignature } : {}),
    ...(typeof count === "number" ? { structuralIdentityMatchCount: count, ...(count > 1 ? { identityAmbiguous: true } : {}) } : {}),
    ...(input.scopeIdentity ? { scopeIdentity: input.scopeIdentity } : {}),
    ...(input.targetFingerprint ? { targetFingerprint: input.targetFingerprint } : {}),
    ...(typeof input.captureScopeUnique === "boolean" ? { captureScopeUnique: input.captureScopeUnique } : {}),
    ...(typeof input.captureTargetMatchCount === "number" ? { captureTargetMatchCount: input.captureTargetMatchCount } : {}),
  };
}

export const STRUCTURAL_OWNER_IDENTITY_SOURCE = `(${normalizeStructuralOwnerIdentity.toString()})`;
