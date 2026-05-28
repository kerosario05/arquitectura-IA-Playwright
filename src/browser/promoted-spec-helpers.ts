import type { Page } from "@playwright/test";

export type PromotedSpecStepReadyOptions = {
  previousUrl?: string;
  timeoutMs?: number;
  pollMs?: number;
  stabilizationMs?: number;
  requireUrlChange?: boolean;
  expectEntityList?: boolean;
};

export type ListReadinessOptions = {
  timeoutMs?: number;
  pollMs?: number;
  minCards?: number;
  loadingTimeoutMs?: number;
};

export type ListReadinessState = {
  cardsVisible: number;
  listItemsVisible: number;
  loadingDetected: boolean;
  zeroProductsDetected: boolean;
  hasEntityContainers: boolean;
  visibleHeadings: string[];
  visibleButtons: string[];
  ready: boolean;
};

export type PageDiagnostics = {
  currentUrl: string;
  title: string;
  visibleHeadings: string[];
  visibleButtons: string[];
  visibleTexts: string[];
  loadingDetected: boolean;
  skeletonDetected: boolean;
  listReadiness: ListReadinessState;
  pageClosed?: boolean;
  pageClosedReason?: string;
};

const LOADING_KEYWORDS = [
  "cargando", "loading", "procesando", "processing", "espere",
  "un momento", "por favor espere", "preparando", "preparing",
  "buscando", "consultando", "obteniendo", "sincronizando",
  "searching", "fetching", "syncing", "synchronizing"
];

const SKELETON_KEYWORDS = [
  "skeleton", "placeholder", "shimmer", "spinner", "loading-spinner"
];

const ZERO_PRODUCT_KEYWORDS = [
  "0 productos", "0 items", "0 resultados", "0 cuentas", "0 tarjetas",
  "no hay productos disponibles", "no hay resultados", "sin productos", "sin resultados"
];

function normalizeText(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
}

async function scanPageTexts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const texts: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const style = window.getComputedStyle(parent);
        if (style.display === "none" || style.visibility === "hidden") return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const text = node.textContent?.trim();
      if (text && text.length > 0) texts.push(text);
    }
    return texts;
  });
}

async function scanVisibleElements(page: Page, selector: string): Promise<string[]> {
  try {
    const elements = await page.locator(selector).all();
    const texts: string[] = [];
    for (const el of elements.slice(0, 20)) {
      try {
        const text = await el.textContent();
        if (text && text.trim().length > 0) {
          texts.push(text.trim());
        }
      } catch {
        // Element detached, skip
      }
    }
    return texts;
  } catch {
    return [];
  }
}

function containsAny(texts: string[], keywords: string[]): boolean {
  const normalizedTexts = texts.map(normalizeText);
  return keywords.some(kw => normalizedTexts.some(t => t.includes(normalizeText(kw))));
}

export async function waitForPromotedSpecStepReady(
  page: Page,
  options: PromotedSpecStepReadyOptions = {}
): Promise<void> {
  const {
    previousUrl,
    timeoutMs = 15000,
    pollMs = 300,
    stabilizationMs = 500,
    requireUrlChange = previousUrl !== undefined,
    expectEntityList = false
  } = options;

  const startTime = Date.now();
  let urlChanged = !requireUrlChange;

  while (Date.now() - startTime < timeoutMs) {
    const currentUrl = page.url();
    if (previousUrl && currentUrl !== previousUrl) {
      urlChanged = true;
    }

    const texts = await scanPageTexts(page);
    const isTransientLoading = containsAny(texts, LOADING_KEYWORDS);
    const isTransientZero = containsAny(texts, ZERO_PRODUCT_KEYWORDS);

    if (urlChanged && !isTransientLoading && !isTransientZero) {
      if (expectEntityList) {
        const readiness = await checkListReadiness(page, { timeoutMs: 0, pollMs: 0, minCards: 1 });
        if (readiness.ready) {
          await page.waitForTimeout(stabilizationMs);
          return;
        }
      } else {
        await page.waitForTimeout(stabilizationMs);
        return;
      }
    } else if (urlChanged && isTransientLoading) {
      await page.waitForTimeout(pollMs);
      continue;
    }

    await page.waitForTimeout(pollMs);
  }

  if (requireUrlChange && !urlChanged) {
    const currentUrl = page.url();
    throw new Error(
      `Page did not transition after action. URL unchanged: "${currentUrl}". ` +
      `This may indicate the click target did not trigger navigation.`
    );
  }
}

export async function waitForListReadiness(
  page: Page,
  options: ListReadinessOptions = {}
): Promise<ListReadinessState> {
  const {
    timeoutMs = 10000,
    pollMs = 500,
    minCards = 1,
    loadingTimeoutMs = 8000
  } = options;

  const startTime = Date.now();
  let lastLoadingState = false;

  while (Date.now() - startTime < timeoutMs) {
    const readiness = await checkListReadiness(page, { timeoutMs: 0, pollMs: 0, minCards });

    if (readiness.loadingDetected) {
      lastLoadingState = true;
      if (Date.now() - startTime < loadingTimeoutMs) {
        await page.waitForTimeout(pollMs);
        continue;
      }
    }

    if (readiness.ready) {
      return readiness;
    }

    if (!readiness.loadingDetected && lastLoadingState) {
      await page.waitForTimeout(500);
      const recheck = await checkListReadiness(page, { timeoutMs: 0, pollMs: 0, minCards });
      if (recheck.ready) return recheck;
    }

    await page.waitForTimeout(pollMs);
  }

  return await checkListReadiness(page, { timeoutMs: 0, pollMs: 0, minCards });
}

async function checkListReadiness(
  page: Page,
  _options: { timeoutMs: number; pollMs: number; minCards: number }
): Promise<ListReadinessState> {
  const texts = await scanPageTexts(page);
  const loadingDetected = containsAny(texts, LOADING_KEYWORDS);
  const zeroProductsDetected = containsAny(texts, ZERO_PRODUCT_KEYWORDS);

  const cardsVisible = await page.locator('[class*="card"], [class*="Card"]').filter({ visible: true }).count().catch(() => 0);
  const listItemsVisible = await page.locator('[role="listitem"], [class*="list-item"], [class*="listitem"]').filter({ visible: true }).count().catch(() => 0);

  const entityContainers = await page.locator('[class*="product"], [class*="entity"], [class*="item"]').filter({ visible: true }).count().catch(() => 0);
  const hasEntityContainers = entityContainers > 0;

  const visibleHeadings = await scanVisibleElements(page, "h1:visible, h2:visible, h3:visible, h4:visible, h5:visible, h6:visible");
  const visibleButtons = await scanVisibleElements(page, "button:visible, [role='button']:visible, a:visible");

  const ready = (cardsVisible >= _options.minCards || listItemsVisible >= _options.minCards || hasEntityContainers) && !loadingDetected && !zeroProductsDetected;

  return {
    cardsVisible,
    listItemsVisible,
    loadingDetected,
    zeroProductsDetected,
    hasEntityContainers,
    visibleHeadings: visibleHeadings.slice(0, 5),
    visibleButtons: visibleButtons.slice(0, 10),
    ready
  };
}

export async function capturePageDiagnostics(page: Page): Promise<PageDiagnostics> {
  // Check if page/context is closed before attempting diagnostics
  try {
    if (!page.context() || !page.isClosed()) {
      // Page is accessible, continue with diagnostics
    } else {
      return {
        currentUrl: "(page closed)",
        title: "",
        visibleHeadings: [],
        visibleButtons: [],
        visibleTexts: [],
        loadingDetected: false,
        skeletonDetected: false,
        listReadiness: {
          cardsVisible: 0,
          listItemsVisible: 0,
          loadingDetected: false,
          zeroProductsDetected: false,
          hasEntityContainers: false,
          visibleHeadings: [],
          visibleButtons: [],
          ready: false
        },
        pageClosed: true,
        pageClosedReason: "context_closed_during_diagnostics"
      };
    }
  } catch {
    // Page/context is closed or inaccessible
    return {
      currentUrl: "(page closed)",
      title: "",
      visibleHeadings: [],
      visibleButtons: [],
      visibleTexts: [],
      loadingDetected: false,
      skeletonDetected: false,
      listReadiness: {
        cardsVisible: 0,
        listItemsVisible: 0,
        loadingDetected: false,
        zeroProductsDetected: false,
        hasEntityContainers: false,
        visibleHeadings: [],
        visibleButtons: [],
        ready: false
      },
      pageClosed: true,
      pageClosedReason: "error_accessing_page"
    };
  }

  const currentUrl = page.url();
  const title = await page.title().catch(() => "");

  const visibleHeadings = await scanVisibleElements(page, "h1:visible, h2:visible, h3:visible").catch(() => []);
  const visibleButtonsRaw = await scanVisibleElements(page, "button:visible, [role='button']:visible").catch(() => []);
  const visibleButtons = visibleButtonsRaw.slice(0, 10);

  const texts = await scanPageTexts(page).catch(() => []);
  const visibleTexts = texts.filter(t => t.length > 3 && t.length < 100).slice(0, 20);

  const loadingDetected = containsAny(texts, LOADING_KEYWORDS);
  const skeletonDetected = containsAny(texts, SKELETON_KEYWORDS);

  const listReadiness = await checkListReadiness(page, { timeoutMs: 0, pollMs: 0, minCards: 1 }).catch(() => ({
    cardsVisible: 0,
    listItemsVisible: 0,
    loadingDetected: false,
    zeroProductsDetected: false,
    hasEntityContainers: false,
    visibleHeadings: [],
    visibleButtons: [],
    ready: false
  }));

  return {
    currentUrl,
    title,
    visibleHeadings: visibleHeadings.slice(0, 5),
    visibleButtons: visibleButtons.slice(0, 10),
    visibleTexts,
    loadingDetected,
    skeletonDetected,
    listReadiness
  };
}

export function buildListReadinessErrorMessage(
  target: string,
  diagnostics: PageDiagnostics,
  tokens: string[],
  candidates: Array<{ text: string; matchScore: number; clickable: boolean }>
): string {
  const lines: string[] = [];
  lines.push(`Could not find product matching "${target}".`);
  lines.push(`Strong tokens: [${tokens.map(t => `"${t}"`).join(", ")}]`);
  lines.push("");
  lines.push(`Page diagnostics:`);
  lines.push(`  Current URL: ${diagnostics.currentUrl}`);
  lines.push(`  Title: ${diagnostics.title || "(empty)"}`);

  if (diagnostics.visibleHeadings.length > 0) {
    lines.push(`  Visible headings: [${diagnostics.visibleHeadings.map(h => `"${h}"`).join(", ")}]`);
  }

  if (diagnostics.visibleButtons.length > 0) {
    lines.push(`  Visible buttons: [${diagnostics.visibleButtons.slice(0, 5).map(b => `"${b}"`).join(", ")}]`);
  }

  lines.push("");
  lines.push(`List readiness:`);
  lines.push(`  Cards visible: ${diagnostics.listReadiness.cardsVisible}`);
  lines.push(`  List items visible: ${diagnostics.listReadiness.listItemsVisible}`);
  lines.push(`  Entity containers: ${diagnostics.listReadiness.hasEntityContainers}`);
  lines.push(`  Loading detected: ${diagnostics.listReadiness.loadingDetected}`);
  lines.push(`  Zero products detected: ${diagnostics.listReadiness.zeroProductsDetected}`);

  if (diagnostics.loadingDetected) {
    lines.push("");
    lines.push(`Loading indicators detected on page. The previous navigation may still be in progress.`);
  }

  if (diagnostics.skeletonDetected) {
    lines.push(`Skeleton/placeholder elements detected. Page may still be rendering.`);
  }

  if (candidates.length > 0) {
    lines.push("");
    lines.push(`Visible candidates:`);
    for (const c of candidates.slice(0, 5)) {
      const displayText = c.text.length > 60 ? c.text.substring(0, 57) + "..." : c.text;
      lines.push(`  - "${displayText}" score: ${c.matchScore.toFixed(2)}, clickable: ${c.clickable}`);
    }
  } else {
    lines.push("");
    lines.push(`No visible candidates found on page.`);
  }

  lines.push("");
  lines.push(`Strategies tried: role, text, heading, semantic_tokens, product_condition`);
  lines.push(`This may indicate the previous POM step did not navigate to the expected list page.`);

  return lines.join("\n");
}
