import { Page, Locator } from "playwright";

/** Duplicate snapshot entries may describe a menuitem and its own nested link. */
export async function resolveSingleMenuOwner(page: Page, target: string): Promise<Locator | undefined> {
 const item = page.getByRole("menuitem", { name: target, exact: true }).filter({ visible: true });
 const count = await item.count();
 if (count !== 1) {
  console.log(`[single-menu-owner] result=rejected reason=owner_count count=${count}`);
  return undefined;
 }
 if (!await item.isEnabled()) {
  console.log('[single-menu-owner] result=rejected reason=owner_disabled');
  return undefined;
 }
 const matches = page.getByText(target, { exact: true }).filter({ visible: true });
 const textCount = await matches.count();
 if (textCount === 0) return undefined;
 // Use the exact accessible owner already resolved by Playwright. A second DOM
 // query with different name/visibility rules can disagree with that identity.
 const owner = await item.elementHandle();
 if (!owner) return undefined;
 try {
  const contained = await matches.evaluateAll((elements, owner) =>
   owner.isConnected && elements.every(el => {
    if (owner.contains(el)) return true;
    // Text outside the menu is not another action candidate unless it belongs
    // to an enabled interactive owner. Preserve ambiguity for actual controls.
    const control = el.closest('button,a[href],input,select,textarea,[role="button"],[role="link"],[role="menuitem"],[role="option"],[role="combobox"],[tabindex]');
    if (!control) return true;
    return false;
   }), owner);
  console.log(`[single-menu-owner] result=${contained ? 'resolved' : 'rejected'} reason=${contained ? 'single_owner' : 'independent_text_match'} textCount=${textCount}`);
  return contained ? item : undefined;
 } finally { await owner.dispose(); }
}
