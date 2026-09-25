"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.launchRuntimeBrowserSession = launchRuntimeBrowserSession;
exports.buildRuntimeContextOptions = buildRuntimeContextOptions;
const page_selection_1 = require("./page-selection");
/**
 * Resolve the effective BrowserContext options used by the runtime. A persistent
 * profile must never let a stale Service Worker from a previous run (or a
 * different app sharing the profile) intercept navigation. Block service workers
 * unless the caller explicitly overrides the policy.
 */
function buildRuntimeContextOptions(contextOptions) {
    return {
        ...contextOptions,
        serviceWorkers: contextOptions?.serviceWorkers ?? "block",
    };
}
async function resolveSessionPage(context, targetUrl, expectedPath, createTargetPageIfMissing) {
    const pages = context.pages();
    if (pages.length === 0) {
        const page = await context.newPage();
        return page;
    }
    try {
        return await (0, page_selection_1.selectRuntimePage)(context, targetUrl, { expectedPath });
    }
    catch (error) {
        const canCreate = error instanceof page_selection_1.RuntimePageSelectionError
            && error.code === "TARGET_PAGE_NOT_FOUND"
            && createTargetPageIfMissing;
        if (!canCreate)
            throw error;
        const page = await context.newPage();
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
        await page.bringToFront();
        return page;
    }
}
/**
 * Launch or reuse the dedicated runtime browser session. A configured profile
 * uses Playwright's persistent context; no corporate profile is copied or
 * mutated. Existing pages are selected by target origin/path, never by order.
 */
async function launchRuntimeBrowserSession(options) {
    const launchOptions = {
        ...options.launchOptions,
        headless: options.headless,
        ...(options.channel ? { channel: options.channel } : {}),
    };
    if (options.profilePath) {
        const context = await options.browserType.launchPersistentContext(options.profilePath, {
            ...launchOptions,
            ...buildRuntimeContextOptions(options.contextOptions),
        });
        const page = await resolveSessionPage(context, options.targetUrl, options.expectedPath, options.createTargetPageIfMissing ?? true);
        return {
            context,
            page,
            persistent: true,
            profilePath: options.profilePath,
            close: () => context.close(),
        };
    }
    const browser = await options.browserType.launch(launchOptions);
    const context = await browser.newContext(buildRuntimeContextOptions(options.contextOptions));
    const page = await resolveSessionPage(context, options.targetUrl, options.expectedPath, options.createTargetPageIfMissing ?? true);
    return {
        browser,
        context,
        page,
        persistent: false,
        close: () => browser.close(),
    };
}
