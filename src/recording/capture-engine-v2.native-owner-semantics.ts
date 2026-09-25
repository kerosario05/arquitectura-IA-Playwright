/**
 * CaptureEngine V2 -- generic HTML/ARIA implicit-role mapping, extracted so the SAME logic that
 * runs inside the browser instrumentation (via `.toString()` interpolation, the same pattern
 * already used for `ACTIONABILITY_CONTRACT_SOURCE`/`STRUCTURAL_OWNER_IDENTITY_SOURCE`) is also
 * independently unit-testable in Node, without a browser or jsdom.
 *
 * FIRST_LOSS fix: the browser instrumentation previously only read an element's EXPLICIT `role`
 * attribute, so any real button/input without one (the overwhelming common case) reported
 * `role: undefined` -- observed physically as `ownerRole=unknown` on every captured action, which
 * then made the click/edit identity fallback fall through to a generic, unresolved label.
 *
 * Standard implicit-ARIA-role vocabulary only -- tag/type semantics, never an app-specific
 * string, and never invented for a control with no genuine native/ARIA semantics.
 */
export function deriveNativeAriaRole(input: {
  tag: string;
  type?: string;
  hasHref?: boolean;
  multiple?: boolean;
  size?: number;
}): string | undefined {
  const tag = input.tag.toLowerCase();
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "a") return input.hasHref ? "link" : undefined;
  if (tag === "option") return "option";
  if (tag === "textarea") return "textbox";
  if (tag === "select") return input.multiple || (input.size !== undefined && input.size > 1) ? "listbox" : "combobox";
  if (tag === "input") {
    const type = (input.type || "text").toLowerCase();
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    if (["text", "email", "password", "search", "tel", "url", "number"].includes(type)) return "textbox";
    return undefined;
  }
  return undefined;
}

export const DERIVE_NATIVE_ARIA_ROLE_SOURCE = `(${deriveNativeAriaRole.toString()})`;
