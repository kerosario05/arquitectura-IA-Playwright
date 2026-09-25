import type { CaptureOwner, CaptureOwnerCandidate, CaptureTechnicalEvidence } from "./capture-engine-v2.types";
import type { RecordedLocator, RecordedTechnicalTarget } from "./session-trace.types";

/**
 * CaptureEngine V2 -- single, shared "raw pointer target -> action owner" resolver, so every
 * future listener (click, pointerdown, whatever replaces them) applies the exact same
 * heuristics instead of growing its own copy. Pure and structural: it takes an already-reduced
 * ancestor chain of the raw event target (never a live DOM/Playwright node), and is NOT wired
 * into `web-session-recorder.ts` -- CaptureEngine V2 stays fully disconnected.
 *
 * This is capture-time ownership only, never execution authority: it decides which node a
 * RECORDED action should be attributed to, nothing about whether that node can later be
 * resolved/executed by the runtime resolver (that remains `CertifiedTechnicalTarget`'s job).
 */
export type CaptureOwnerResolutionReason =
  | "editable_in_composed_path"
  | "actionable_in_composed_path"
  | "certified_framework_actionable_in_composed_path"
  | "stable_associated_control_evidence"
  | "unresolved_no_actionable_semantics";

export type CaptureOwnerResolution =
  | { status: "resolved"; owner: CaptureOwner; reason: CaptureOwnerResolutionReason }
  | { status: "unresolved"; reason: "unresolved_no_actionable_semantics" };

export type CaptureOwnerResolutionInput = {
  /** The raw event target's ancestor chain. Order in this array does not matter -- `pathDepth` does. */
  composedPath: CaptureOwnerCandidate[];
};

/**
 * Generic HTML/ARIA vocabulary only -- never an app-specific string, label, or selector. Tags
 * here are the ones a genuinely accessible, self-describing widget uses; everything else
 * (div/form/section/span/...) needs a real ARIA role before it can be trusted as actionable.
 */
const ACTIONABLE_ROLES = new Set([
  "button", "link", "checkbox", "radio", "option", "menuitem",
  "tab", "switch", "menuitemcheckbox", "menuitemradio", "combobox",
]);

/**
 * Generic container tags that must never qualify as an action owner merely because a caller
 * flagged them `actionable: true` (aggregated text, `cursor: pointer`, a bare id, a generic
 * onclick, or simply containing many controls are all explicitly insufficient per this
 * resolver's contract). A container only qualifies via a genuine ARIA role (checked first).
 */
const CONTAINER_TAGS = new Set(["div", "form", "section", "span", "article", "main", "ul", "li", "table", "tbody", "tr", "body"]);

function isGenuineActionableIdentity(candidate: CaptureOwnerCandidate): boolean {
  if (!candidate.actionable) return false;
  const role = candidate.role?.toLowerCase();
  if (role && ACTIONABLE_ROLES.has(role)) return true;
  if (CONTAINER_TAGS.has(candidate.tag.toLowerCase())) return false;
  return true;
}

function toOwner(candidate: CaptureOwnerCandidate, classification: "editable" | "actionable" | undefined): CaptureOwner {
  return {
    tag: candidate.tag,
    role: candidate.role,
    classification,
    technicalRefs: candidate.technicalRefs,
    associatedField: candidate.associatedField,
    groupEvidence: candidate.groupEvidence,
    disabled: candidate.disabled,
    accessibleName: candidate.accessibleName,
    technicalRoleName: candidate.technicalRoleName,
    roleTechnicalIdentityEligible: candidate.roleTechnicalIdentityEligible,
    structuralIdentity: candidate.structuralIdentity,
    playwrightRecorderEvidence: candidate.playwrightRecorderEvidence,
  };
}

export function resolveCaptureOwner(input: CaptureOwnerResolutionInput): CaptureOwnerResolution {
  const path = [...input.composedPath].sort((a, b) => a.pathDepth - b.pathDepth);

  // Priority 1: a real editable anywhere in the composed path always wins, regardless of how
  // far it sits from the target or what actionable-looking wrapper surrounds it.
  const editable = path.find((candidate) => candidate.editable === true);
  if (editable) {
    return { status: "resolved", owner: toOwner(editable, "editable"), reason: "editable_in_composed_path" };
  }

  // Priority 2: the nearest genuinely actionable ancestor (an icon/path inside a button never
  // qualifies itself; the button does).
  const actionable = path.find((candidate) => isGenuineActionableIdentity(candidate));
  if (actionable) {
    return { status: "resolved", owner: toOwner(actionable, "actionable"), reason: "actionable_in_composed_path" };
  }

  // Priority 3: a framework control can be a plain container, but only when the browser already
  // certified actionability and durable identity on THIS exact composed-path node. Never combine
  // a descendant's gesture/structure with another ancestor's ref. More than one qualifying
  // boundary is ambiguous by definition; no depth or nearest-container guess may break the tie.
  const frameworkOwners = path.filter((candidate) =>
    candidate.trustedClick === true
    && candidate.frameworkActionable === true
    && candidate.frameworkIdentitySufficient === true
    && candidate.visible === true,
  );
  if (frameworkOwners.length === 1) {
    return {
      status: "resolved",
      owner: toOwner(frameworkOwners[0], "actionable"),
      reason: "certified_framework_actionable_in_composed_path",
    };
  }
  if (frameworkOwners.length > 1) {
    return { status: "unresolved", reason: "unresolved_no_actionable_semantics" };
  }

  // Priority 4: no editable/actionable identity anywhere, but a candidate carries stable,
  // structural evidence of belonging to a known control/group -- never resolved from weak
  // signals like aggregated text or a bare id.
  const structural = path.find(
    (candidate) => Boolean(candidate.associatedField) && (Boolean(candidate.groupEvidence) || (candidate.technicalRefs?.length ?? 0) > 0),
  );
  if (structural) {
    return { status: "resolved", owner: toOwner(structural, undefined), reason: "stable_associated_control_evidence" };
  }

  // Priority 4: nothing qualifies -- a large container is never invented as an owner just
  // because it aggregates text or contains many controls.
  return { status: "unresolved", reason: "unresolved_no_actionable_semantics" };
}

/**
 * Mirrors `web-session-recorder.ts`'s existing `id -> css`/`testid -> data-testid` mapping for a
 * domId locator (see its `buildWebLocators`): the EXECUTABLE locator for a stable id is the CSS
 * selector, never the bare "id:" ref string alone. A ref with an unrecognized/unsupported
 * strategy is passed through unchanged -- `recordedLocatorFactory` (target-resolver.ts) already
 * tolerates a strategy it doesn't know how to turn into a live locator (it is simply skipped at
 * resolution time), so nothing here needs to guess.
 */
function ownerLocatorCandidates(technicalRefs: string[] | undefined): RecordedLocator[] {
  return (technicalRefs ?? []).flatMap((ref): RecordedLocator[] => {
    const separator = ref.indexOf(":");
    if (separator <= 0) return [];
    const strategy = ref.slice(0, separator).trim().toLowerCase();
    const value = ref.slice(separator + 1).trim();
    if (!value) return [];
    if (strategy === "id") return [{ strategy: "css", value: `#${value}`, confidence: 0.8 }];
    if (strategy === "testid") return [{ strategy: "data-testid", value, confidence: 0.98 }];
    return [{ strategy, value, confidence: 0.7 }];
  });
}

/**
 * Converts a resolved `CaptureOwner`'s technical refs and structural identity into the SAME
 * `RecordedTechnicalTarget` shape `adaptCaptureActionToRawInteraction`/`buildCanonicalInteractions`/
 * `target-resolver.ts` already know how to consume -- reused verbatim, never re-designed. Returns
 * `undefined` when the owner carries neither a technical ref nor structural evidence, so a plain
 * owner (e.g. one resolved only via Priority 3's associatedField) never gets a fabricated,
 * empty technical target.
 */
export function buildOwnerTechnicalEvidence(
  owner: CaptureOwner,
  resolutionReason?: CaptureOwnerResolutionReason,
): CaptureTechnicalEvidence | undefined {
  const locatorCandidates = ownerLocatorCandidates(owner.technicalRefs);
  const identity = owner.structuralIdentity;
  if (locatorCandidates.length === 0 && !identity) return undefined;
  const target: RecordedTechnicalTarget = {
    targetType: "structural",
    locatorCandidates,
    ...(identity
      ? {
        structuralContext: {
          owner: identity.owner,
          stableDirectAttributes: identity.stableDirectAttributes,
          stableDescendants: identity.stableDescendants,
          semanticShape: identity.semanticShape,
          ...(identity.landmarkAncestor ? { landmarkAncestor: identity.landmarkAncestor } : {}),
          deterministicStructuralIdentity: identity.deterministicStructuralIdentity,
          ...(identity.topologyTieBreakUnique ? { topologyTieBreakUnique: true } : {}),
          ...(identity.topologySignature ? { topologySignature: identity.topologySignature } : {}),
          ...(identity.identityAmbiguous ? { identityAmbiguous: true } : {}),
          ...(identity.structuralIdentityMatchCount !== undefined ? { structuralIdentityMatchCount: identity.structuralIdentityMatchCount } : {}),
          ...(identity.scopeIdentity ? { scopeIdentity: identity.scopeIdentity } : {}),
          ...(identity.targetFingerprint ? { targetFingerprint: identity.targetFingerprint } : {}),
          ...(identity.captureScopeUnique !== undefined ? { captureScopeUnique: identity.captureScopeUnique } : {}),
          ...(identity.captureTargetMatchCount !== undefined ? { captureTargetMatchCount: identity.captureTargetMatchCount } : {}),
        },
      }
      : {}),
    interactionEvidence: [
      "v2_click_owner",
      ...(resolutionReason === "certified_framework_actionable_in_composed_path" ? ["v2_framework_actionable_owner"] : []),
    ],
    confidence: 0.85,
    validatedByInteraction: true,
  };
  return { candidates: [target] };
}

/**
 * Carries scoped structural evidence from a trusted unresolved pointer target without turning
 * that node into a certified CaptureOwner. The canonical contract may only mark this as
 * runtime-resolution-required; the live shared resolver must revalidate scope and local
 * uniqueness before execution.
 */
export function buildScopedStructuralRuntimeEvidence(
  identity: CaptureOwnerCandidate["structuralIdentity"],
): CaptureTechnicalEvidence | undefined {
  if (
    !identity?.scopeIdentity
    || !identity.targetFingerprint
    || identity.deterministicStructuralIdentity !== true
    || identity.captureScopeUnique !== true
    || identity.captureTargetMatchCount !== 1
    || identity.structuralIdentityMatchCount !== 1
  ) return undefined;
  const nonTextualAttributeNames = new Set(["id", "data-testid", "data-test-id", "name", "href", "role", "data-field", "data-column", "src"]);
  const hasNonTextualDirectEvidence = Object.keys(identity.stableDirectAttributes).some((name) => nonTextualAttributeNames.has(name));
  const hasNonTextualDescendantEvidence = identity.stableDescendants.some((descendant) =>
    Object.keys(descendant.stableAttributes).some((name) => nonTextualAttributeNames.has(name)),
  );
  if (!hasNonTextualDirectEvidence && !hasNonTextualDescendantEvidence && identity.semanticShape.length === 0 && !identity.topologySignature) return undefined;
  const target: RecordedTechnicalTarget = {
    targetType: "structural",
    locatorCandidates: [],
    structuralContext: {
      owner: identity.owner,
      stableDirectAttributes: identity.stableDirectAttributes,
      stableDescendants: identity.stableDescendants,
      semanticShape: identity.semanticShape,
      ...(identity.landmarkAncestor ? { landmarkAncestor: identity.landmarkAncestor } : {}),
      deterministicStructuralIdentity: true,
      ...(identity.identityAmbiguous ? { identityAmbiguous: true } : {}),
      ...(identity.structuralIdentityMatchCount !== undefined ? { structuralIdentityMatchCount: identity.structuralIdentityMatchCount } : {}),
      scopeIdentity: identity.scopeIdentity,
      targetFingerprint: identity.targetFingerprint,
      ...(identity.captureScopeUnique !== undefined ? { captureScopeUnique: identity.captureScopeUnique } : {}),
      ...(identity.captureTargetMatchCount !== undefined ? { captureTargetMatchCount: identity.captureTargetMatchCount } : {}),
    },
    interactionEvidence: ["v2_click_owner", "v2_scoped_structural_runtime_evidence"],
    confidence: 0.6,
    validatedByInteraction: true,
  };
  return { candidates: [target] };
}
