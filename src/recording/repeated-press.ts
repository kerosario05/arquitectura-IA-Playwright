import type { Page } from "@playwright/test";

/**
 * A recorded press can be stored as `role:button|Name` in one step and as `css:[aria-label="Name"]`
 * in another: both name the same control. The accessible name is the shared identity.
 */
export function pressNameKey(ref: string | undefined): string | undefined {
  const text = ref?.trim() ?? "";
  const role = /^role:(?:button|link)\|(.+)$/i.exec(text);
  if (role) return role[1].trim().toLowerCase();
  const aria = /^css:.*\[aria-label=["']([^"']+)["']\]/i.exec(text);
  return aria ? aria[1].trim().toLowerCase() : undefined;
}

/** Accessible name of a recorded press ref, original case (for role+name lookups). */
export function pressName(ref: string | undefined): string | undefined {
  const text = ref?.trim() ?? "";
  return /^role:(?:button|link)\|(.+)$/i.exec(text)?.[1]?.trim()
    ?? /^css:.*\[aria-label=["']([^"']+)["']\]/i.exec(text)?.[1]?.trim();
}

/** Live controls that a recorded press ref (or its accessible name) can still point at. */
export async function countLiveControlsForPress(page: Page, ref: string): Promise<number> {
  const key = pressNameKey(ref);
  if (!key) return -1;
  const text = ref.trim();
  const name = /^role:(?:button|link)\|(.+)$/i.exec(text)?.[1]?.trim()
    ?? /\[aria-label=["']([^"']+)["']\]/i.exec(text)?.[1]?.trim()
    ?? key;
  const byRole = await page.getByRole("button", { name, exact: true }).count().catch(() => 0);
  // Only controls the user could actually press count (hidden/detached copies do not).
  const byLabel = await page.locator(`[aria-label="${name.replace(/"/g, '\\"')}"]`).filter({ visible: true }).count().catch(() => 0);
  return Math.max(byRole, byLabel);
}
