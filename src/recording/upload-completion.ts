import type { Page } from "@playwright/test";

// Applications confirm an upload with a transient feedback message (toast / alert / status). That
// message is the upload's own completion signal: server-side processing that continues afterwards
// (a row still "syncing") must not hold the next recorded step.
const FAILURE_FEEDBACK = /\b(error|fall[oó]|fallid[oa]|fail(?:ed|ure)?|inv[aá]lid[oa]?|no se pudo|rechazad[oa]|unable|could not|denied)\b/i;

async function readVisibleFeedbackTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    // tsx/esbuild wraps named functions with __name, which does not exist in the page context.
    (globalThis as { __name?: unknown }).__name ??= (fn: unknown) => fn;
    const visible =(element: Element) => {
      const node = element as HTMLElement;
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
    };
    return Array.from(document.querySelectorAll('[role="alert"], [role="status"], [aria-live], [class*="toast" i], [class*="snackbar" i], [class*="notification" i]'))
      .filter(visible)
      .map((element) => (element.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
  });
}

/** Feedback messages already on screen before the upload starts (they cannot confirm it). */
export async function captureFeedbackBaseline(page: Page): Promise<Set<string>> {
  if (typeof page?.evaluate !== "function") return new Set();
  try { return new Set(await readVisibleFeedbackTexts(page)); } catch { return new Set(); }
}

/** True once a feedback message that was not there before appears and does not read as a failure. */
export function newNonFailureFeedbackProbe(page: Page, baseline: Set<string>): () => Promise<boolean> {
  return async () => {
    if (typeof page?.evaluate !== "function") return false;
    try {
      const texts = await readVisibleFeedbackTexts(page);
      return texts.some((text) => !baseline.has(text) && !FAILURE_FEEDBACK.test(text));
    } catch {
      return false;
    }
  };
}
