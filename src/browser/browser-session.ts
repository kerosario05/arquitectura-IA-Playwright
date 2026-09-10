import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  BrowserType,
  LaunchOptions,
  Page,
} from "@playwright/test";
import { RuntimePageSelectionError, selectRuntimePage } from "./page-selection";

export type RuntimeBrowserSessionOptions = {
  browserType: BrowserType;
  headless: boolean;
  targetUrl: string;
  expectedPath?: string;
  profilePath?: string;
  channel?: string;
  contextOptions?: BrowserContextOptions;
  launchOptions?: LaunchOptions;
  createTargetPageIfMissing?: boolean;
};

export type RuntimeBrowserSession = {
  browser?: Browser;
  context: BrowserContext;
  page: Page;
  persistent: boolean;
  profilePath?: string;
  close: () => Promise<void>;
};

async function resolveSessionPage(
  context: BrowserContext,
  targetUrl: string,
  expectedPath: string | undefined,
  createTargetPageIfMissing: boolean,
): Promise<Page> {
  const pages = context.pages();
  if (pages.length === 0) {
    const page = await context.newPage();
    return page;
  }

  try {
    return await selectRuntimePage(context, targetUrl, { expectedPath });
  } catch (error) {
    const canCreate = error instanceof RuntimePageSelectionError
      && error.code === "TARGET_PAGE_NOT_FOUND"
      && createTargetPageIfMissing;
    if (!canCreate) throw error;

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
export async function launchRuntimeBrowserSession(
  options: RuntimeBrowserSessionOptions,
): Promise<RuntimeBrowserSession> {
  const launchOptions: LaunchOptions = {
    ...options.launchOptions,
    headless: options.headless,
    ...(options.channel ? { channel: options.channel } : {}),
  };

  if (options.profilePath) {
    const context = await options.browserType.launchPersistentContext(options.profilePath, {
      ...launchOptions,
      ...options.contextOptions,
    });
    const page = await resolveSessionPage(
      context,
      options.targetUrl,
      options.expectedPath,
      options.createTargetPageIfMissing ?? true,
    );
    return {
      context,
      page,
      persistent: true,
      profilePath: options.profilePath,
      close: () => context.close(),
    };
  }

  const browser = await options.browserType.launch(launchOptions);
  const context = await browser.newContext(options.contextOptions);
  const page = await resolveSessionPage(
    context,
    options.targetUrl,
    options.expectedPath,
    options.createTargetPageIfMissing ?? true,
  );
  return {
    browser,
    context,
    page,
    persistent: false,
    close: () => browser.close(),
  };
}
