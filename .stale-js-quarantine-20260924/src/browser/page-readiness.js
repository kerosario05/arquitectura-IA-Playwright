"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.waitForPageReady = waitForPageReady;
const DEFAULT_OPTIONS = {
    domContentLoadedTimeoutMs: 60000,
    networkIdleTimeoutMs: 5000,
    stabilizationMs: 500,
    visibleHints: [],
    visibleHintTimeoutMs: 10000,
    requireVisibleHint: false
};
async function waitForPageReady(page, options) {
    const opts = { ...DEFAULT_OPTIONS, ...options };
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
