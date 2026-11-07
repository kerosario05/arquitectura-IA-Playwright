import type { Locator } from "@playwright/test";

/**
 * A recorded/field-scoped locator can resolve to the field's wrapper (label + control container)
 * instead of the control itself; Playwright's `fill` rejects any non-editable element. When the
 * resolved element is not editable and holds exactly ONE editable descendant, that descendant is the
 * field's control. Anything else (already editable, none, several, or not inspectable) is left
 * untouched so ambiguity still fails instead of filling a guessed control.
 */
export async function coerceToEditableFillTarget(locator: Locator, options?: { timeoutMs?: number }): Promise<Locator> {
  const editable = await locator.evaluate((element) => {
    const tag = element.tagName.toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || Boolean((element as HTMLElement).isContentEditable);
  }, undefined, options?.timeoutMs === undefined ? undefined : { timeout: options.timeoutMs }).catch(() => true);
  // Only an explicit "not editable" answer triggers the descent; unknown/uninspectable stays as-is.
  if (editable !== false) return locator;
  const inner = locator.locator(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable=""], [contenteditable="true"]',
  );
  return (await inner.count().catch(() => 0)) === 1 ? inner.first() : locator;
}
