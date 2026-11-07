import { Page, Locator } from "playwright";

/** Resolve only an explicitly owned popup; never choose among global text matches. */
export async function resolveOwnedMenuItem(page: Page, ownerName: string | undefined, target: string): Promise<Locator | undefined> {
  if (!ownerName) return undefined;
  const owner = page.getByRole("button", { name: ownerName, exact: true }).filter({ visible: true });
  if (await owner.count() !== 1 || await owner.getAttribute("aria-expanded") !== "true") return undefined;
  const id = await owner.getAttribute("aria-controls");
  if (!id) return undefined;
  const popup = page.locator(`[id=${JSON.stringify(id)}]`).filter({ visible: true });
  if (await popup.count() !== 1) return undefined;
  const item = popup.getByRole("menuitem", { name: target, exact: true }).filter({ visible: true });
  if (await item.count() !== 1 || !await item.isEnabled()) return undefined;
  return item;
}
