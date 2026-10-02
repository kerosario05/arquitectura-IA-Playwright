import type { StructuralScopeIdentity } from "./structural-owner-identity";

export type NativeSelectionCapture = {
  controlIdentity: StructuralScopeIdentity;
  scopeIdentity: StructuralScopeIdentity;
  fieldLabel?: string;
  options: Array<{ value: string; label: string; disabled: boolean }>;
  clickedOption?: { value: string; label: string };
  /** Zero based among enabled options with a nonempty value; placeholders are excluded. */
  selectionMode?: "index";
  selectedOptionIndex?: number;
  selectedValue: string;
};

/** DOM evidence only: no project vocabulary, inferred values, or positional selectors. */
export function captureNativeSelection(target: Element): NativeSelectionCapture | undefined {
  const clean = (value: string | null | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
  const tag = target.tagName.toLowerCase();
  if (!["select", "option", "span", "div", "li"].includes(tag)) return undefined;
  let root: Element | null = target;
  let control: HTMLSelectElement | undefined;
  for (let depth = 0; root && depth < 8; depth++, root = root.parentElement) {
    if (["form", "body", "html"].includes(root.tagName.toLowerCase())) return undefined;
    const controls = root.tagName.toLowerCase() === "select"
      ? [root as HTMLSelectElement] : Array.from(root.querySelectorAll("select"));
    if (controls.length > 1) return undefined;
    if (controls.length === 1) { control = controls[0]; break; }
  }
  if (!root || !control) return undefined;
  const attribute = control.hasAttribute("data-testid") ? "data-testid" : control.id ? "id" : "";
  const value = attribute ? control.getAttribute(attribute) : undefined;
  if (!value) return undefined;
  const identitySelector = `select[${attribute}="${CSS.escape(value)}"]`;
  const matchedControls = document.querySelectorAll(identitySelector);
  if (matchedControls.length !== 1 || matchedControls[0] !== control) return undefined;

  // Anchor the actual local wrapper using the observed child-tag path to its unique select.
  const path: string[] = [];
  let node: Element | null = control;
  while (node && node !== root) { path.unshift(node === control ? identitySelector : node.tagName.toLowerCase()); node = node.parentElement; }
  const scopeSelector = root === control ? identitySelector : `${root.tagName.toLowerCase()}:has(> ${path.join(" > ")})`;
  const matchedScopes = document.querySelectorAll(scopeSelector);
  if (matchedScopes.length !== 1 || matchedScopes[0] !== root) return undefined;

  let fieldLabel = clean(control.getAttribute("aria-label"));
  if (!fieldLabel && control.getAttribute("aria-labelledby")) {
    fieldLabel = clean(control.getAttribute("aria-labelledby")!.split(/\s+/).map(id => document.getElementById(id)?.textContent ?? "").join(" "));
  }
  if (!fieldLabel && control.labels?.length === 1) fieldLabel = clean(control.labels[0].textContent);
  // A sole heading/legend/label inside a group with exactly this select identifies the field.
  for (let group: Element | null = root === control ? control.parentElement : root; !fieldLabel && group; group = group.parentElement) {
    if (["form", "body", "html"].includes(group.tagName.toLowerCase())) break;
    const controls = group.querySelectorAll("select");
    if (controls.length !== 1 || controls[0] !== control) break;
    const labels = Array.from(group.querySelectorAll("h1,h2,h3,h4,h5,h6,legend,label,[role='heading']"))
      .filter(label => !label.closest("select,[role='listbox'],[role='option']"))
      .map(label => clean(label.textContent)).filter(Boolean);
    if (new Set(labels).size === 1) fieldLabel = labels[0];
  }
  const options = Array.from(control.options).map(option => ({
    value: option.value, label: clean(option.label || option.textContent),
    disabled: Boolean(option.disabled || (option.parentElement?.tagName.toLowerCase() === "optgroup" && (option.parentElement as HTMLOptGroupElement).disabled)),
  }));
  const clickedText = clean(target.textContent);
  const selectable = options.filter(option => option.value && !option.disabled);
  const matches = selectable.filter(option => option.label === clickedText);
  const clickedOption = tag !== "select" && matches.length === 1 ? { value: matches[0].value, label: matches[0].label } : undefined;
  const selectedOptionIndex = clickedOption ? selectable.findIndex(option => option.value === clickedOption.value && option.label === clickedOption.label) : undefined;
  return {
    controlIdentity: { strategy: attribute === "id" ? "id" : "data-testid", value },
    scopeIdentity: { strategy: "css", value: scopeSelector },
    ...(fieldLabel ? { fieldLabel } : {}), options,
    ...(clickedOption ? { clickedOption } : {}), selectedValue: control.value,
    ...(selectedOptionIndex !== undefined ? { selectionMode: "index" as const, selectedOptionIndex } : {}),
  };
}

// esbuild/tsx can emit its function-name helper inside serialized functions.
// Keep that helper local to this expression so injection needs no Node globals.
export const CAPTURE_NATIVE_SELECTION_SOURCE = `(function () { var __name = function (fn) { return fn; }; return (${captureNativeSelection.toString()}); })()`;
