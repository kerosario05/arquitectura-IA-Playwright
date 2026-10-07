import type { Locator, Page } from "@playwright/test";
import type { RecordedLocator } from "./session-trace.types";

export type RecordingControlTarget = { label?: string; role?: string; associatedField?: string; attributes?: Record<string, string | undefined>; locators?: readonly RecordedLocator[] };
export type RecordingControlAction =
  | { kind: "navigate"; url: string }
  | { kind: "click" | "fill" | "press" | "select"; target: RecordingControlTarget; value?: string; key?: string; selectionOrdinal?: number };
export type RecordingControlResult = { executed: true; action: RecordingControlAction["kind"] };
export class RecordingControlError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = "RecordingControlError"; } }
function quoteAttribute(value: string): string { return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"'); }
function locatorFor(page: Page, candidate: RecordedLocator): Locator | undefined {
  if (candidate.ambiguous === true || candidate.matchIndex !== undefined) return undefined;
  const value = candidate.value.trim(); if (!value) return undefined;
  if (candidate.strategy === "data-testid") return page.getByTestId(value);
  if (candidate.strategy === "aria-label") return page.locator(`[aria-label="${quoteAttribute(value)}"]`);
  if (candidate.strategy === "id") return page.locator(`[id="${quoteAttribute(value)}"]`);
  if (candidate.strategy === "text") return page.getByText(value, { exact: true });
  if (candidate.strategy === "css") return page.locator(value);
  if (candidate.strategy === "role") { const separator = value.indexOf("|"); const role = (separator >= 0 ? value.slice(0, separator) : value).trim(); const name = separator >= 0 ? value.slice(separator + 1).trim() : undefined; return role ? page.getByRole(role as any, name ? { name, exact: true } : undefined) : undefined; }
  return undefined;
}
function locatorForRelaxed(page: Page, candidate: RecordedLocator): Locator | undefined {
  if (candidate.ambiguous === true || candidate.matchIndex !== undefined) return undefined;
  const value = candidate.value.trim(); if (!value) return undefined;
  if (candidate.strategy === "text") return page.getByText(value, { exact: false });
  if (candidate.strategy === "role") { const separator = value.indexOf("|"); const role = (separator >= 0 ? value.slice(0, separator) : value).trim(); const name = separator >= 0 ? value.slice(separator + 1).trim() : undefined; return role ? page.getByRole(role as any, name ? { name, exact: false } : undefined) : undefined; }
  return undefined;
}
function stripRequiredMarker(name: string): string {
  return name.replace(/[\s*＊•·:：]+$/u, "").trim();
}
export async function resolveRecordingControlTarget(page: Page, target: RecordingControlTarget): Promise<Locator> {
  const candidates = (target.locators ?? []).filter(candidate => candidate.ambiguous !== true && candidate.matchIndex === undefined);
  const unique: Locator[] = [];
  let anyAmbiguous = false;
  for (const candidate of candidates) {
    const locator = locatorFor(page, candidate); if (!locator) continue;
    let resolved = locator;
    await resolved.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
    let count = await resolved.count();
    if (count === 0 && (candidate.strategy === "text" || candidate.strategy === "role")) {
      const relaxed = locatorForRelaxed(page, candidate);
      if (relaxed) {
        await relaxed.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
        const relaxedCount = await relaxed.count(); if (relaxedCount > 0) { resolved = relaxed; count = relaxedCount; }
      }
    }
    if (count > 1) { anyAmbiguous = true; continue; }
    if (count === 1) unique.push(resolved);
  }
  if (unique.length === 0 && target.role && (target.label || target.associatedField)) {
    const name = target.label ?? target.associatedField;
    const semantic = page.getByRole(target.role as any, { name, exact: true });
    await semantic.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
    const count = await semantic.count();
    if (count === 1) return semantic;
    if (count > 1) throw new RecordingControlError("AMBIGUOUS_TARGET", "Semantic target matched multiple elements");
    const relaxedSemantic = page.getByRole(target.role as any, { name, exact: false });
    await relaxedSemantic.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
    const relaxedCount = await relaxedSemantic.count();
    if (relaxedCount === 1) return relaxedSemantic;
    if (relaxedCount > 1) throw new RecordingControlError("AMBIGUOUS_TARGET", "Semantic target matched multiple elements");
    // Required-field markers are often rendered visually but omitted from the accessible
    // name. Re-resolve only after the original and substring names failed, and keep the
    // same uniqueness requirement so this never becomes a positional fallback.
    const normalizedName = stripRequiredMarker(name ?? "");
    if (normalizedName && normalizedName !== name) {
      const normalized = page.getByRole(target.role as any, { name: normalizedName, exact: true });
      await normalized.waitFor({ state: "attached", timeout: 10000 }).catch(() => {});
      const normalizedCount = await normalized.count();
      if (normalizedCount === 1) return normalized;
      if (normalizedCount > 1) throw new RecordingControlError("AMBIGUOUS_TARGET", "Normalized semantic target matched multiple elements");
    }
  }
  if (unique.length === 0 && anyAmbiguous) throw new RecordingControlError("AMBIGUOUS_TARGET", "Recorded target matched multiple elements");
  if (unique.length === 0) throw new RecordingControlError("TARGET_NOT_FOUND", "Recorded target has no unique runtime match");
  return unique[0];
}
export async function executeRecordingControlAction(page: Page, action: RecordingControlAction): Promise<RecordingControlResult> {
  if (page.isClosed()) throw new RecordingControlError("PAGE_CLOSED", "Authoritative recording page is closed");
  if (!["navigate", "click", "fill", "press", "select"].includes(action.kind)) throw new RecordingControlError("UNSUPPORTED_ACTION", "Unsupported recording control action");
  if (action.kind === "navigate") { if (!action.url.trim()) throw new RecordingControlError("INVALID_ACTION", "Navigation URL is required"); await page.goto(action.url, { waitUntil: "domcontentloaded" }); return { executed: true, action: action.kind }; }
  const locator = await resolveRecordingControlTarget(page, action.target);
  if (action.kind === "click") await locator.click();
  else if (action.kind === "fill") {
    // Segmented OTP widgets often expose their stable identity on the containing form.
    // Resolve the unique editable descendant without weakening the uniqueness contract.
    const tagName = typeof (locator as any).evaluate === "function"
      ? await locator.evaluate((element) => element.tagName.toLowerCase()).catch(() => "")
      : "";
    if (!["input", "textarea", "select"].includes(tagName)) {
      if (typeof (locator as any).locator !== "function") { await locator.fill(action.value ?? ""); return { executed: true, action: action.kind }; }
      const descendants = locator.locator('input:visible:not([type="submit"]):not([type="button"]),textarea:visible,[contenteditable="true"]');
      const descendantCount = await descendants.count();
      if (descendantCount === 1) await descendants.fill(action.value ?? "");
      else if (descendantCount > 1 && (action.value ?? "").length === descendantCount) {
        const value = action.value ?? "";
        if (typeof (descendants as any).evaluateAll === "function") await descendants.evaluateAll((elements, text) => {
          elements.forEach((element, position) => {
            if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
            const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")?.set;
            setter?.call(element, String(text)[position] ?? "");
            element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text)[position] ?? "" }));
            element.dispatchEvent(new Event("change", { bubbles: true }));
          });
        }, value);
        else await locator.fill(value);
      } else if (descendantCount === 0) {
        const allInputs = locator.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]),textarea');
        const allCount = await allInputs.count();
        if (allCount > 0 && (action.value ?? "").length === allCount) {
          const value = action.value ?? "";
          if (typeof (allInputs as any).evaluateAll === "function") await allInputs.evaluateAll((elements, text) => {
            elements.forEach((element, position) => {
              if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
              const setter = Object.getOwnPropertyDescriptor(element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype, "value")?.set;
              setter?.call(element, String(text)[position] ?? "");
              element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: String(text)[position] ?? "" }));
              element.dispatchEvent(new Event("change", { bubbles: true }));
            });
          }, value);
          else await locator.fill(value);
        } else await locator.fill(action.value ?? "");
      } else await locator.fill(action.value ?? "");
    } else await locator.fill(action.value ?? "");
  }
  else if (action.kind === "press") { if (!action.key?.trim()) throw new RecordingControlError("INVALID_ACTION", "Press key is required"); await locator.press(action.key); }
  else {
    if (action.selectionOrdinal !== undefined) {
      if (!Number.isInteger(action.selectionOrdinal) || action.selectionOrdinal < 0) throw new RecordingControlError("INVALID_ACTION", "Selection ordinal must be a non-negative integer");
      const value = await locator.evaluate((element, ordinal) => {
        if (!(element instanceof HTMLSelectElement)) throw new Error("Selection ordinal requires a native select");
        const options = Array.from(element.options).filter(option => !option.disabled && option.value.trim() !== "");
        const selected = options[ordinal as number];
        if (!selected) throw new Error("Selection ordinal is not present in the current option set");
        return selected.value;
      }, action.selectionOrdinal);
      await locator.selectOption(value);
    } else {
      if (!action.value?.trim()) throw new RecordingControlError("INVALID_ACTION", "Select value is required");
      await locator.selectOption(action.value);
    }
  }
  return { executed: true, action: action.kind };
}
