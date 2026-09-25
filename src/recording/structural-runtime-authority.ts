import type { RecordedTarget } from "./session-trace.types";

const V2_CLICK_OWNER_EVIDENCE = "v2_click_owner";
const NATIVE_ACTIONABLE_TAGS = new Set(["a", "button", "input", "option", "select", "summary", "textarea"]);
const ACTIONABLE_ROLES = new Set([
  "button", "link", "checkbox", "radio", "option", "menuitem", "tab", "switch",
  "menuitemcheckbox", "menuitemradio", "combobox",
]);

/**
 * Validates the complete Capture V2 topology tie-break contract. It deliberately does not
 * promote a bare `deterministicStructuralIdentity` boolean: the captured target must have one
 * validated structural V2 click-owner candidate, an actionable owner shape, populated structural
 * shape, explicit topology-derived uniqueness, and no remaining ambiguity.
 */
export function hasTopologyTiebrokenV2StructuralAuthority(target: RecordedTarget | undefined): boolean {
  const candidates = target?.technicalTargetCandidates?.filter((candidate) =>
    candidate.targetType === "structural"
    && candidate.validatedByInteraction === true
    && candidate.interactionEvidence.includes(V2_CLICK_OWNER_EVIDENCE),
  ) ?? [];
  if (candidates.length !== 1) return false;

  const candidate = candidates[0];
  const context = candidate.structuralContext;
  const ownerTag = context?.owner?.tag?.trim().toLowerCase();
  const ownerRole = context?.owner?.role?.trim().toLowerCase();
  const targetRole = target?.role?.trim().toLowerCase();
  const actionableOwner = Boolean(ownerTag && (
    NATIVE_ACTIONABLE_TAGS.has(ownerTag)
    || ACTIONABLE_ROLES.has(ownerRole ?? "")
    || ACTIONABLE_ROLES.has(targetRole ?? "")
  ));

  return actionableOwner
    && target?.tag?.trim().toLowerCase() === ownerTag
    && context?.deterministicStructuralIdentity === true
    && context.topologyTieBreakUnique === true
    && context.identityAmbiguous !== true
    && context.structuralIdentityMatchCount === 1
    && (context.semanticShape?.length ?? 0) > 0;
}
