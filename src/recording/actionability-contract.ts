export type ActionabilityKind =
  | "NATIVE_ACTIONABLE"
  | "SEMANTIC_ACTIONABLE"
  | "FRAMEWORK_ACTIONABLE"
  | "NON_ACTIONABLE";

export type ActionabilitySignals = {
  tagName?: string;
  role?: string;
  onclick?: boolean;
  tabIndex?: number;
  cursor?: string;
  pointerEvents?: string;
  trustedInteraction?: boolean;
  stableTechnicalIdentity?: boolean;
  structuredClickableAncestor?: boolean;
  ancestorFrameworkActionable?: boolean;
  explicitPointerCursor?: boolean;
};

/**
 * The structural actionability contract shared by capture and replay observation.
 * Text alone never makes an element actionable. Framework actionability requires
 * objective browser/DOM evidence and remains separate from target admission.
 */
export function classifyActionability(signals: ActionabilitySignals): ActionabilityKind {
  const tagName = signals.tagName?.trim().toLowerCase();
  const role = signals.role?.trim().toLowerCase();
  if (tagName && ["button", "a", "input", "textarea", "select"].includes(tagName)) return "NATIVE_ACTIONABLE";
  if (role && ["button", "link", "option", "tab", "menuitem", "treeitem", "combobox", "textbox"].includes(role)) return "SEMANTIC_ACTIONABLE";

  const pointerActionable = signals.cursor?.trim().toLowerCase() === "pointer"
    && signals.pointerEvents?.trim().toLowerCase() !== "none";
  const frameworkEvidence = signals.trustedInteraction === true
    || signals.stableTechnicalIdentity === true
    || signals.structuredClickableAncestor === true
    || typeof signals.tabIndex === "number" && signals.tabIndex >= 0
    || signals.onclick === true
    // The browser's pointer affordance is objective runtime evidence. Ownership is
    // decided separately so inherited descendants are not emitted as candidates.
    || pointerActionable;
  if (pointerActionable && frameworkEvidence) return "FRAMEWORK_ACTIONABLE";
  return "NON_ACTIONABLE";
}

/**
 * A framework action owner is the boundary that owns the clickable region. A descendant
 * only inheriting the pointer affordance is structural evidence, not another candidate.
 * An explicit pointer declaration may intentionally create a nested owner.
 */
export function isFrameworkActionOwner(signals: ActionabilitySignals & { actionability?: ActionabilityKind }): boolean {
  if (signals.actionability !== "FRAMEWORK_ACTIONABLE") return false;
  return signals.ancestorFrameworkActionable !== true || signals.explicitPointerCursor === true;
}

// The recorder installs a page-side copy. Keep this generated from the same
// implementation so capture and runtime observation cannot drift silently.
export const ACTIONABILITY_CONTRACT_SOURCE = `(${classifyActionability.toString()})`;
