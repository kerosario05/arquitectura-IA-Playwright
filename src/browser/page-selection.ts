/**
 * Selects the page that belongs to the configured runtime target.
 *
 * Page order is intentionally not part of this contract.  A single page is
 * preserved for backwards compatibility; multiple pages require a target
 * match so an unrelated authentication window cannot receive application
 * actions by accident.
 */

export type RuntimePageLike = {
  url(): string;
  bringToFront?: () => Promise<void>;
  isClosed?: () => boolean;
};

export type RuntimePageContainerLike<TPage extends RuntimePageLike = RuntimePageLike> = {
  pages(): readonly TPage[];
};

export type RuntimePageSelectionOptions = {
  /** Prefer a page path after matching the configured target origin. */
  expectedPath?: string;
};

export type PageSelectionErrorCode =
  | "NO_BROWSER_PAGES"
  | "INVALID_RUNTIME_TARGET"
  | "TARGET_PAGE_NOT_FOUND"
  | "AMBIGUOUS_TARGET_PAGE";

export class RuntimePageSelectionError extends Error {
  readonly code: PageSelectionErrorCode;

  constructor(code: PageSelectionErrorCode, message: string) {
    super(message);
    this.name = "RuntimePageSelectionError";
    this.code = code;
  }
}

function normalizeComparableUrl(value: string): string {
  const parsed = new URL(value);
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/{2,}/g, "/").replace(/\/$/, "") || "/";
  return parsed.toString();
}

function normalizeComparablePath(value: string): string {
  const normalized = value.trim().replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

function getMatchRank(
  pageUrl: string,
  target: URL,
  comparableTarget: string,
  expectedPath?: string,
): number {
  let current: URL;
  try {
    current = new URL(pageUrl);
  } catch {
    return 0;
  }

  if (current.origin !== target.origin) return 0;
  if (normalizeComparableUrl(pageUrl) === comparableTarget) return 3;
  if (expectedPath && normalizeComparablePath(current.pathname) === normalizeComparablePath(expectedPath)) return 2;
  return 1;
}

async function focus<TPage extends RuntimePageLike>(page: TPage): Promise<TPage> {
  if (page.bringToFront) await page.bringToFront();
  return page;
}

/**
 * Select a runtime page using the project-configured URL/origin.
 *
 * With several pages, unrelated pages are never selected as a fallback.  If
 * more than one page has the same best match, the ambiguity is reported
 * explicitly instead of reintroducing an order-based choice.
 */
export async function selectRuntimePage<TPage extends RuntimePageLike>(
  container: RuntimePageContainerLike<TPage>,
  targetUrl: string,
  options: RuntimePageSelectionOptions = {},
): Promise<TPage> {
  const pages = Array.from(container.pages()).filter((page) => !page.isClosed?.());
  if (pages.length === 0) {
    throw new RuntimePageSelectionError("NO_BROWSER_PAGES", "No browser pages are available for runtime execution.");
  }

  let target: URL;
  let comparableTarget: string;
  try {
    target = new URL(targetUrl);
    comparableTarget = normalizeComparableUrl(targetUrl);
  } catch {
    throw new RuntimePageSelectionError("INVALID_RUNTIME_TARGET", "The configured runtime target URL is invalid.");
  }

  if (pages.length === 1) {
    const onlyPage = pages.find(() => true);
    if (!onlyPage) {
      throw new RuntimePageSelectionError("NO_BROWSER_PAGES", "No browser pages are available for runtime execution.");
    }
    return focus(onlyPage);
  }

  let bestRank = 0;
  let bestPage: TPage | undefined;
  let tied = false;

  for (const page of pages) {
    const rank = getMatchRank(page.url(), target, comparableTarget, options.expectedPath);
    if (rank > bestRank) {
      bestRank = rank;
      bestPage = page;
      tied = false;
    } else if (rank > 0 && rank === bestRank) {
      tied = true;
    }
  }

  if (!bestPage || bestRank === 0) {
    throw new RuntimePageSelectionError(
      "TARGET_PAGE_NOT_FOUND",
      "No browser page matches the configured runtime target origin.",
    );
  }
  if (tied) {
    throw new RuntimePageSelectionError(
      "AMBIGUOUS_TARGET_PAGE",
      "More than one browser page matches the configured runtime target.",
    );
  }

  return focus(bestPage);
}
