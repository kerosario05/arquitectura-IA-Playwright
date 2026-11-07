import type { Browser, Page } from "@playwright/test";

/**
 * `--start-maximized` is only a startup hint and Chromium can ignore it when
 * launched with `--no-startup-window`. Apply the state through CDP after the
 * visible recording page exists.
 */
export async function maximizeBrowserWindow(target: Page | Browser): Promise<boolean> {
  // Older callers invoke this immediately on connect, before any window exists.
  // Never guess among multiple pages; the recorder supplies its own page later.
  if ('contexts' in target) {
    const pages = target.contexts().flatMap(context => context.pages());
    return pages.length === 1 ? maximizeBrowserWindow(pages[0]) : false;
  }
  const page = target;
  try {
    const cdp = await page.context().newCDPSession(page);
    try {
      // Browser-level sessions have no implicit target. Bind the operation to
      // the recorder's page rather than relying on whichever window is active.
      const {targetInfo} = await cdp.send("Target.getTargetInfo");
      const window = await cdp.send("Browser.getWindowForTarget", {targetId:targetInfo.targetId});
      if (typeof window?.windowId !== "number") return false;
      // Chromium requires restoring a minimized/fullscreen window before
      // changing to another non-normal state.
      await cdp.send("Browser.setWindowBounds", {
        windowId: window.windowId,
        bounds: { windowState: "normal" },
      });
      await cdp.send("Browser.setWindowBounds", {
        windowId: window.windowId,
        bounds: { windowState: "maximized" },
      });
      await page.bringToFront();
      const result = await cdp.send("Browser.getWindowBounds", {windowId:window.windowId});
      return result.bounds.windowState === 'maximized';
    } finally {
      await cdp.detach().catch(() => undefined);
    }
  } catch {
    // Window management is best-effort; recording can still proceed if a
    // Chromium build does not expose the Browser CDP domain.
    return false;
  }
}
