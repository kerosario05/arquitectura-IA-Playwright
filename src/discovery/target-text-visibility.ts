/**
 * Whether a snapshot already shows an element whose name is `targetText`. An input has no visible text of its
 * own: its name comes from a label, an aria-label or its placeholder, so every one of those is compared, not
 * only the first non-null of text/label/name (an empty `text` used to hide the rest).
 */
export function isTargetTextVisibleInSnapshot(
  elements: readonly Record<string, unknown>[] | undefined,
  targetText: string,
  normalize: (value: string) => string,
): boolean {
  const wanted = normalize(targetText);
  if (!wanted) return false;
  return Boolean(elements?.some((element) =>
    [element.text, element.label, element.name, element.ariaLabel, element.accessibleName, element.placeholder].some((candidate) => {
      const text = typeof candidate === "string" ? normalize(candidate.trim()) : "";
      return text.length > 0 && (text === wanted || text.includes(wanted));
    }),
  ));
}
