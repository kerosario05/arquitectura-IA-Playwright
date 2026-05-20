import type { Page } from "@playwright/test";

export type WaitForPageReadyOptions = {
  domContentLoadedTimeoutMs?: number;
  networkIdleTimeoutMs?: number;
  stabilizationMs?: number;
  visibleHints?: Array<string | RegExp>;
  visibleHintTimeoutMs?: number;
  requireVisibleHint?: boolean;
};

const DEFAULT_OPTIONS: Required<WaitForPageReadyOptions> = {
  domContentLoadedTimeoutMs: 60000,
  networkIdleTimeoutMs: 5000,
  stabilizationMs: 500,
  visibleHints: [],
  visibleHintTimeoutMs: 10000,
  requireVisibleHint: false
};

export async function waitForPageReady(
  page: Page,
  options?: WaitForPageReadyOptions
): Promise<void> {
  const opts: Required<WaitForPageReadyOptions> = { ...DEFAULT_OPTIONS, ...options };

  await page.waitForLoadState("domcontentloaded", { timeout: opts.domContentLoadedTimeoutMs });

  await page.waitForLoadState("networkidle", { timeout: opts.networkIdleTimeoutMs }).catch(() => {
  });

  if (opts.visibleHints.length > 0) {
    const hintChecks = opts.visibleHints.map((hint) => {
      if (typeof hint === "string") {
        return page.getByText(hint).first().isVisible({ timeout: opts.visibleHintTimeoutMs }).catch(() => false);
      }
      return page.getByText(hint).first().isVisible({ timeout: opts.visibleHintTimeoutMs }).catch(() => false);
    });

    const results = await Promise.all(hintChecks);
    const anyVisible = results.some((r) => r === true);

    if (!anyVisible && opts.requireVisibleHint) {
      throw new Error("None of the visible hints were found on the page.");
    }
  }

  if (opts.stabilizationMs > 0) {
    await page.waitForTimeout(opts.stabilizationMs);
  }
}
