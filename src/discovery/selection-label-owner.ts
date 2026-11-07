import type { Page } from "playwright";

const ATTRIBUTE = "data-qa-label-owner";

// Plain-text browser script: a transpiled function would carry helpers (esbuild's __name) that do
// not exist inside the page.
const MARK_SCRIPT = `(args) => {
  var label = args.label, mark = args.marker, attribute = args.attribute;
  function normalize(value) {
    return (value || "").normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/\\s+/g, " ").replace(/[:*\\s]+$/, "").trim().toLowerCase();
  }
  function isVisible(element) {
    var rect = element.getBoundingClientRect();
    var style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }
  var wanted = normalize(label);
  if (!wanted) return false;
  var captions = Array.prototype.slice.call(document.querySelectorAll("label, span, div, p, legend, h1, h2, h3, h4, h5, h6"))
    .filter(function (element) { return element.children.length === 0 && isVisible(element) && normalize(element.textContent) === wanted; });
  if (captions.length !== 1) return false;
  var TRIGGERS = "[role='combobox'], .p-dropdown, .p-select, select, [aria-haspopup='listbox']";
  // A dropdown widget usually nests several matches (root + inner combobox): count the widgets.
  function widgetOf(element) { return element.closest(".p-dropdown, .p-select") || element; }
  var container = captions[0].parentElement;
  for (var depth = 0; depth < 4 && container; depth += 1, container = container.parentElement) {
    var widgets = [];
    Array.prototype.slice.call(container.querySelectorAll(TRIGGERS)).filter(isVisible).forEach(function (element) {
      var widget = widgetOf(element);
      if (widgets.indexOf(widget) < 0) widgets.push(widget);
    });
    if (widgets.length === 0) continue;
    if (widgets.length !== 1) return false;
    widgets[0].setAttribute(attribute, mark);
    return true;
  }
  return false;
}`;

/**
 * Finds the dropdown that belongs to a visible field label when the app does not link them
 * (no `for`, no aria-labelledby): the label's own text must be unique on the page and its nearest
 * ancestor holding a dropdown must hold exactly one. The dropdown is tagged with a temporary
 * attribute so it can be addressed as a locator; call `clearSelectionOwnerMarker` afterwards.
 * Never guesses: several labels, several dropdowns or none resolve to `undefined`.
 */
export async function markSelectionOwnerByLabel(page: Page, fieldLabel: string): Promise<string | undefined> {
  const marker = `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const args = JSON.stringify({ label: fieldLabel, marker, attribute: ATTRIBUTE });
  const found = await page.evaluate(`(${MARK_SCRIPT})(${args})`).catch(() => false);
  return found ? marker : undefined;
}

export function selectionOwnerSelector(marker: string): string {
  return `[${ATTRIBUTE}="${marker}"]`;
}

export async function clearSelectionOwnerMarker(page: Page, marker: string): Promise<void> {
  const args = JSON.stringify({ mark: marker, attribute: ATTRIBUTE });
  await page.evaluate(
    `((args) => { document.querySelectorAll("[" + args.attribute + "='" + args.mark + "']").forEach(function (element) { element.removeAttribute(args.attribute); }); })(${args})`,
  ).catch(() => undefined);
}
