import type { Locator } from "playwright";

// Page-side checks for telling apart several elements that share one accessible name. They are built from text on purpose:
// a compiled arrow function would carry the bundler's `__name` helper into the page, and a plain string would be
// evaluated as an expression instead of being called.

/**
 * True when the element sits inside a collapsed container (an accordion/sidebar submenu folded to zero height or width
 * with overflow clipping): its own box is non-empty, so Playwright reports it visible, but nobody can see or reach it.
 * Only containers that are themselves empty count, so a scrolled list (items outside its viewport) is never excluded.
 */
export const INSIDE_COLLAPSED_CONTAINER = new Function(`return function (element) {
  var node = element.parentElement;
  while (node && node !== document.body && node !== document.documentElement) {
    var style = window.getComputedStyle(node);
    var clips = style.overflowX !== "visible" || style.overflowY !== "visible";
    if (clips) {
      var box = node.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) return true;
    }
    node = node.parentElement;
  }
  return false;
}`)() as (element: Element) => boolean;

/**
 * True when the element is what the pointer would actually reach at its own center: inside the viewport, not covered,
 * not clipped away, not pointer-transparent (document.elementFromPoint skips `pointer-events: none`).
 */
export const REACHES_POINTER_AT_CENTER = new Function(`return function (element) {
  var rect = element.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return false;
  var x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
  if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
  var hit = document.elementFromPoint(x, y);
  return Boolean(hit) && (hit === element || element.contains(hit));
}`)() as (element: Element) => boolean;

/**
 * From several same-name candidates keep the ones a person could press: not inside a collapsed container, then, when
 * still several, only those the pointer reaches. Returns the single survivor, or undefined when the narrowing does not
 * end in exactly one (the caller keeps its ambiguity, fail closed).
 */
export async function singleReachableCandidate(candidates: readonly Locator[]): Promise<Locator | undefined> {
  if (candidates.length < 2) return candidates[0];
  let pool = [...candidates];
  const notCollapsed: Locator[] = [];
  for (const candidate of pool) {
    if (!await candidate.evaluate(INSIDE_COLLAPSED_CONTAINER).catch(() => false)) notCollapsed.push(candidate);
  }
  if (notCollapsed.length >= 1) pool = notCollapsed;
  if (pool.length === 1) return pool[0];
  const reached: Locator[] = [];
  for (const candidate of pool) {
    if (await candidate.evaluate(REACHES_POINTER_AT_CENTER).catch(() => false)) reached.push(candidate);
  }
  return reached.length === 1 ? reached[0] : undefined;
}
