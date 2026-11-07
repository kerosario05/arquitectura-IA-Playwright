/** Structural evidence that a click owner is a selector trigger, not an ordinary action button. */
export type SelectionTriggerEvidence = "native_select" | "aria_popup";

/**
 * Classify only standard select/combobox owners or explicit ARIA popup-to-listbox relations.
 * A button label or nearby option text alone is never enough to infer selector ownership.
 */
export function detectSelectionTriggerEvidence(input: {
  tag?: string;
  role?: string;
  ariaHasPopup?: string;
  controlledRoles?: string[];
}): SelectionTriggerEvidence | undefined {
  const tag = input.tag?.trim().toLowerCase();
  const role = input.role?.trim().toLowerCase();
  if (tag === "select" || role === "combobox") return "native_select";

  const controlledRoles = (input.controlledRoles ?? []).map((value) => value.trim().toLowerCase());
  const hasListboxRelation = controlledRoles.length === 1 && controlledRoles[0] === "listbox";
  const hasPopup = input.ariaHasPopup?.trim().toLowerCase();
  if (hasPopup === "listbox" || hasListboxRelation) return "aria_popup";
  return undefined;
}

/** Resolve a custom selector's field label only from explicit ownership or a unique field group. */
export function resolveSelectionFieldOwnerLabel(input: {
  explicitFieldOwner?: string;
  gridHeaderContext?: string;
  interactiveControlCount: number;
  ownerIsOnlyControl: boolean;
  visibleLabelCandidates: string[];
}): string | undefined {
  const explicit = input.gridHeaderContext?.trim() || input.explicitFieldOwner?.trim();
  if (explicit) return explicit;
  if (input.interactiveControlCount !== 1 || !input.ownerIsOnlyControl) return undefined;
  const labels = [...new Set(input.visibleLabelCandidates.map((label) => label.trim()).filter(Boolean))];
  return labels.length === 1 ? labels[0] : undefined;
}
