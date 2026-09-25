import type { RecordedTarget } from "./session-trace.types";

const FRAMEWORK_OWNER_EVIDENCE = "v2_framework_actionable_owner";
const SEMANTIC_ATTRIBUTE_NAMES = ["aria-label", "alt", "title"] as const;

export type FrameworkOwnerSemanticIdentity = {
  isFrameworkOwner: boolean;
  hasDeterministicStructuralAuthority: boolean;
  semanticIdentity?: string;
};

/**
 * Uses only evidence captured from the certified owner itself. This is display identity, never
 * locator or replay authority: the structural owner remains the action target.
 */
export function semanticIdentityFromFrameworkOwnerEvidence(
  target: RecordedTarget | undefined,
): FrameworkOwnerSemanticIdentity {
  const frameworkCandidates = target?.technicalTargetCandidates?.filter((candidate) =>
    candidate.interactionEvidence.includes(FRAMEWORK_OWNER_EVIDENCE),
  ) ?? [];
  if (frameworkCandidates.length !== 1) {
    return { isFrameworkOwner: false, hasDeterministicStructuralAuthority: false };
  }
  const structuralContext = frameworkCandidates[0].structuralContext;
  const hasDeterministicStructuralAuthority = structuralContext?.deterministicStructuralIdentity === true
    && structuralContext.identityAmbiguous !== true
    && structuralContext.structuralIdentityMatchCount === 1;

  const values = frameworkCandidates[0].structuralContext?.stableDescendants?.flatMap((descendant) =>
    SEMANTIC_ATTRIBUTE_NAMES.map((name) => descendant.stableAttributes[name]?.trim()).filter(Boolean) as string[],
  ) ?? [];
  const distinct = new Map<string, string>();
  for (const value of values) {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized) distinct.set(normalized.toLocaleLowerCase(), normalized);
  }
  return {
    isFrameworkOwner: true,
    hasDeterministicStructuralAuthority,
    ...(distinct.size === 1 ? { semanticIdentity: [...distinct.values()][0] } : {}),
  };
}
