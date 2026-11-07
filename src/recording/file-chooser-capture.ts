import type { ElementHandle, FileChooser, Page } from "@playwright/test";

// Apps often create a detached `<input type="file">` on click, so the recorded "attach" step has no
// DOM node to resolve: the only handle is the chooser (or detached input) the preceding click opened.
// The post-click settle wait after the opening click can itself last minutes.
const CHOOSER_MAX_AGE_MS = 600_000;
const armedPages = new WeakSet<Page>();
const pendingChoosers = new WeakMap<Page, { chooser: FileChooser; at: number }>();
const detachedInputPages = new WeakSet<Page>();
const DETACHED_INPUT_SIGNAL = "__codex_detached_file_input_clicked__";

type PendingInputWindow = { __codexFileInputPatched?: boolean; __codexPendingFileInput?: HTMLInputElement | null };

/** Idempotent; must run before the click that opens the chooser. */
export async function armFileChooserCapture(page: Page): Promise<void> {
  // Lightweight page doubles (unit tests) expose neither events nor evaluate: nothing to arm.
  if (typeof page?.on !== "function" || typeof page?.evaluate !== "function") return;
  if (!armedPages.has(page)) {
    armedPages.add(page);
    page.on("filechooser", (chooser) => {
      console.log("[file-chooser] captured=true");
      pendingChoosers.set(page, { chooser, at: Date.now() });
    });
    // The page tells us (console signal, no polling evaluate) that a detached file input was clicked.
    page.on("console", (message) => {
      if (message.text() === DETACHED_INPUT_SIGNAL) detachedInputPages.add(page);
    });
  }
  // A detached input that is clicked never reaches the browser's chooser: remember it instead.
  await page.evaluate((signal) => {
    const scope = window as unknown as PendingInputWindow;
    if (scope.__codexFileInputPatched) return;
    scope.__codexFileInputPatched = true;
    const originalClick = HTMLInputElement.prototype.click;
    HTMLInputElement.prototype.click = function patchedClick(this: HTMLInputElement) {
      if (this.type === "file" && !this.isConnected) {
        scope.__codexPendingFileInput = this;
        console.debug(signal);
        return;
      }
      return originalClick.call(this);
    };
  }, DETACHED_INPUT_SIGNAL).catch(() => undefined);
}

/** Forget any chooser/detached input left by an earlier click, so the next click is judged on its own. */
export async function clearPendingFileChooser(page: Page): Promise<void> {
  if (typeof page?.evaluate !== "function") return;
  pendingChoosers.delete(page);
  detachedInputPages.delete(page);
  await page.evaluate(() => { (window as unknown as PendingInputWindow).__codexPendingFileInput = null; }).catch(() => undefined);
}

/** Whether the last click opened a chooser (or tried to open a detached file input), without consuming it. */
export async function hasPendingFileChooser(page: Page): Promise<boolean> {
  if (!page || typeof page !== "object") return false;
  const pending = pendingChoosers.get(page);
  if (pending && Date.now() - pending.at <= CHOOSER_MAX_AGE_MS) return true;
  return detachedInputPages.has(page);
}

/** The most recent chooser opened by a click, consumed once. */
export function takePendingFileChooser(page: Page): FileChooser | undefined {
  const pending = pendingChoosers.get(page);
  pendingChoosers.delete(page);
  return pending && Date.now() - pending.at <= CHOOSER_MAX_AGE_MS ? pending.chooser : undefined;
}

/** The detached file input the last click tried to open, consumed once. */
export async function takePendingDetachedFileInput(page: Page): Promise<ElementHandle<HTMLInputElement> | undefined> {
  detachedInputPages.delete(page);
  const handle = await page.evaluateHandle(() => {
    const scope = window as unknown as PendingInputWindow;
    const input = scope.__codexPendingFileInput ?? null;
    scope.__codexPendingFileInput = null;
    return input;
  }).catch(() => undefined);
  const element = handle?.asElement() as ElementHandle<HTMLInputElement> | null | undefined;
  if (!element) await handle?.dispose().catch(() => undefined);
  return element ?? undefined;
}
