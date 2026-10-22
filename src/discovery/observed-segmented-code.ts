import type { Page, Locator } from "@playwright/test";
import type { PlaywrightRecorderEvidence } from "../recording/structural-owner-identity";
import { isVerificationCodeKey } from "../data/verification-code-role";

/** Native form causally associated with an observed segmented group. */
export async function resolveSegmentedInputForm(page: Page, evidence: PlaywrightRecorderEvidence): Promise<Locator | undefined> {
  if (evidence.kind !== "segmented_input" || evidence.scopeIdentity?.strategy !== "css") return undefined;
  const scope = page.locator(evidence.scopeIdentity.value);
  if (await scope.count().catch(() => 0) !== 1) return undefined;
  const form = scope.locator("xpath=ancestor-or-self::form");
  return await form.count().catch(() => 0) === 1 && await form.isVisible().catch(() => false) ? form : undefined;
}

/** Admit a live code group only with a shared name, explicit slot order and a unique scope. */
export async function observeSegmentedCodeEvidence(page: Page, valueKey?: string): Promise<PlaywrightRecorderEvidence | undefined> {
  // Widget eligibility is separate from credential/data roles. An explicit authorization
  // token can use the same segmented control as a login code while retaining its own key
  // and value. Match a complete token term, never a substring or an app-owned key spelling.
  const tokenIdentity = valueKey?.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/).includes("token") ?? false;
  if (valueKey !== undefined && !isVerificationCodeKey(valueKey) && !tokenIdentity) return undefined;
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll("input")).filter(input => !input.disabled && !input.readOnly
      && ["text", "tel", "number", "password"].includes(input.type)
      && input.getClientRects().length > 0);
    const groups = new Map<string, HTMLInputElement[]>();
    for (const input of inputs) {
      if (!input.name || input.tabIndex < 1) continue;
      // Form identity prevents equally named controls in separate forms from merging.
      const formIndex = input.form ? Array.from(document.forms).indexOf(input.form) : -1;
      const key = JSON.stringify([formIndex, input.name, input.type]);
      groups.set(key, [...(groups.get(key) ?? []), input]);
    }
    const candidates: Array<{ scopeIdentity: { strategy: "css"; value: string }; segmentCount: number }> = [];
    for (const group of groups.values()) {
      if (group.length < 4 || group.length > 8
        || !group.every((input, index) => input.tabIndex === index + 1)) continue;
      const first = group[0];
      for (let scope = first.parentElement; scope && scope !== document.body; scope = scope.parentElement) {
        if (!group.every(input => scope!.contains(input))) continue;
        const editable = Array.from(scope.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"]'))
          .filter(element => element instanceof HTMLInputElement
            ? !element.disabled && !element.readOnly && ["text", "tel", "number", "password"].includes(element.type) && element.getClientRects().length > 0
            : element.getClientRects().length > 0);
        if (editable.length !== group.length || !editable.every((element, index) => element === group[index])) break;
        const selector = scope.id ? `#${CSS.escape(scope.id)}`
          : scope.hasAttribute("data-testid") ? `[data-testid="${CSS.escape(scope.getAttribute("data-testid")!)}"]`
            : scope.tagName === "FORM" && document.querySelectorAll("form").length === 1 ? "form" : undefined;
        if (!selector || document.querySelectorAll(selector).length !== 1) continue;
        candidates.push({ scopeIdentity: { strategy: "css", value: selector }, segmentCount: group.length });
        break;
      }
    }
    if (candidates.length !== 1) return undefined;
    return { kind: "segmented_input" as const, ...candidates[0], runtimeResolutionRequired: true as const, captureMatchCount: 1 };
  });
}
