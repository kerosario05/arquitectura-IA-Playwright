import type { Locator, Page } from "playwright";

export type FilledInput = { stepIndex: number; label: string; locator: Locator; value: string };

const PROBE_TIMEOUT_MS = 300;
const MAX_TRACKED = 40;

/**
 * True for inputs that hold a secret (password, one-time code): they are never registered, so
 * a repair never types them again. A recorded literal is marked "masked" by the filler as a
 * precaution, which says nothing about the control itself.
 */
export async function isSecretInput(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => {
    const input = element as HTMLInputElement;
    const autocomplete = String(input.getAttribute("autocomplete") ?? "").toLowerCase();
    const identity = `${input.id ?? ""} ${input.getAttribute("name") ?? ""}`.toLowerCase();
    return String(input.type ?? "").toLowerCase() === "password"
      || /one-time-code|current-password|new-password/.test(autocomplete)
      || /(^|[^a-z])(pass(word)?|pwd|otp|token|secret)([^a-z]|$)/.test(identity);
  }, undefined, { timeout: PROBE_TIMEOUT_MS }).catch(() => true);
}

/**
 * Remembers the inputs a run filled so a later step can notice that the app cleared one (a dialog
 * that recomputes after another field changes) and, when the button the flow must press is
 * disabled, type the cleared values again. Only inputs that are still visible, editable and empty
 * are touched; secrets are never registered by the caller.
 */
export class FilledInputRegistry {
  private readonly entries = new Map<string, FilledInput>();
  private readonly reportedCleared = new Set<string>();

  remember(entry: FilledInput): void {
    const key = entry.label.trim().toLowerCase();
    this.entries.delete(key);
    this.entries.set(key, entry);
    this.reportedCleared.delete(key);
    while (this.entries.size > MAX_TRACKED) this.entries.delete(this.entries.keys().next().value as string);
  }

  private async isClearedNow(entry: FilledInput): Promise<boolean> {
    if (!(await entry.locator.isVisible().catch(() => false))) return false;
    if (!(await entry.locator.isEditable({ timeout: PROBE_TIMEOUT_MS }).catch(() => false))) return false;
    const current = await entry.locator.inputValue({ timeout: PROBE_TIMEOUT_MS }).catch(() => undefined);
    return current !== undefined && current.trim() === "";
  }

  /** Logs each filled input that turned empty since it was filled (once), with the step that observed it. */
  async reportCleared(currentStep: number, log: (line: string) => void): Promise<void> {
    for (const [key, entry] of this.entries) {
      if (this.reportedCleared.has(key) || entry.stepIndex >= currentStep) continue;
      if (await this.isClearedNow(entry)) {
        this.reportedCleared.add(key);
        log(`[fill-watch] field=${JSON.stringify(entry.label)} filledAtStep=${entry.stepIndex} emptyAtStep=${currentStep}`);
      }
    }
  }

  /** Logs what the page holds for every registered input (value length, visibility, widget classes). */
  async describe(log: (line: string) => void): Promise<void> {
    for (const entry of this.entries.values()) {
      const visible = await entry.locator.isVisible().catch(() => false);
      if (!visible) { // a hidden input has nothing to report; probing it only burns the probe timeouts
        log(`[fill-state] field=${JSON.stringify(entry.label)} filledAtStep=${entry.stepIndex} visible=false`);
        continue;
      }
      const editable = await entry.locator.isEditable({ timeout: PROBE_TIMEOUT_MS }).catch(() => false);
      const state = await entry.locator.evaluate((element) => {
        const input = element as HTMLInputElement;
        return {
          valueLength: String(input.value ?? "").length,
          type: input.type ?? "",
          cls: String(input.className ?? "").slice(0, 80),
          parentCls: String(input.parentElement?.className ?? "").slice(0, 80),
          ariaNow: input.getAttribute("aria-valuenow") ?? "",
        };
      }, undefined, { timeout: PROBE_TIMEOUT_MS }).catch(() => undefined);
      log(`[fill-state] field=${JSON.stringify(entry.label)} filledAtStep=${entry.stepIndex} visible=${visible} editable=${editable} state=${JSON.stringify(state ?? null)}`);
    }
  }

  /** Types again the filled inputs that are empty now; returns the labels it repaired. */
  async repairCleared(commit: (locator: Locator, value: string) => Promise<unknown>, log: (line: string) => void): Promise<string[]> {
    const repaired: string[] = [];
    for (const [key, entry] of this.entries) {
      if (!(await this.isClearedNow(entry))) continue;
      try {
        await commit(entry.locator, entry.value);
        repaired.push(entry.label);
        this.reportedCleared.delete(key);
        log(`[fill-repair] field=${JSON.stringify(entry.label)} filledAtStep=${entry.stepIndex} retyped=true`);
      } catch (error) {
        log(`[fill-repair] field=${JSON.stringify(entry.label)} retyped=false error=${JSON.stringify(error instanceof Error ? error.message.slice(0, 160) : String(error))}`);
      }
    }
    return repaired;
  }
}

/**
 * Types a value key by key and leaves the field (Tab), as a person does. Masked numeric widgets
 * (PrimeVue InputNumber) can show a value written in one shot without updating their model, so the
 * app clears it on the next re-render; typed keys reach the model.
 */
export async function typeLikeUser(locator: Locator, value: string): Promise<void> {
  await locator.click({ timeout: 2000 });
  await locator.press("Control+A");
  await locator.pressSequentially(value, { delay: 40 });
  await locator.press("Tab");
}

/** True when the page shows buttons with this exact name and every visible one is disabled. */
export async function isButtonTargetDisabled(page: Page, name: string): Promise<boolean> {
  const buttons = page.getByRole("button", { name, exact: true });
  const count = await buttons.count().catch(() => 0);
  let disabled = 0;
  for (let index = 0; index < Math.min(count, 5); index += 1) {
    const button = buttons.nth(index);
    if (!(await button.isVisible().catch(() => false))) continue;
    if (await button.isEnabled().catch(() => true)) return false;
    disabled += 1;
  }
  return disabled > 0;
}
