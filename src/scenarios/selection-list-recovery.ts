import type { SnapshotElement } from "../types/page-snapshot.types";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Generic wording classifier for a user-visible list recovery control. */
export function isSelectionListRecoveryControlLabel(value?: string): boolean {
  const text = normalize(value ?? "");
  const recovery = /\b(reintent\w*|retry|retries|recarg\w*|reload\w*|refresh\w*|actualiz\w*)\b/.test(text);
  const list = /\b(listas?|lists?|busc\w*|search\w*|carg\w*|options?|opciones|catalog\w*)\b/.test(text);
  return recovery && list;
}

/**
 * A retry control is eligible only when it is visible, semantically a list-recovery action,
 * and its captured local text context names the field being selected. Ambiguity fails closed.
 */
export function findUniqueSelectionListRecoveryControl(
  elements: readonly SnapshotElement[],
  selectionField: string,
): SnapshotElement | undefined {
  const field = normalize(selectionField);
  if (!field) return undefined;

  const matches = elements.filter((element) => {
    if (!element.visible || element.disabled === true) return false;
    if (element.type !== "button" && element.role?.toLowerCase() !== "button") return false;
    const accessibleText = [element.accessibleName, element.ariaLabel, element.label, element.name, element.text, element.title]
      .filter((part): part is string => Boolean(part?.trim()))
      .join(" ");
    if (!isSelectionListRecoveryControlLabel(accessibleText)) return false;
    return normalize(element.nearbyText ?? "").includes(field);
  });

  return matches.length === 1 ? matches[0] : undefined;
}
