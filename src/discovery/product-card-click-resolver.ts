import type { Page, Locator } from "@playwright/test";
import type { PageSnapshot } from "../types/page-snapshot.types";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { scanCurrentPage } from "../explorer/page-scanner";

/**
 * Product card click strategy - describes how to click on a product card/list item
 */
export type ProductClickStrategy =
  | "exact_text"           // Click on the exact text/title of the product
  | "clickable_ancestor"   // Click on nearest clickable ancestor (button, link, etc.)
  | "card_center"          // Click on the center of the card container
  | "inner_button"         // Click on a button/icon inside the card
  | "inner_link"           // Click on a link (a[href]) inside the card
  | "card_container";      // Click on the card container itself if it has handlers

export type ProductClickCandidate = {
  strategy: ProductClickStrategy;
  locator: Locator;
  description: string;
  role?: string;
  tagName?: string;
  bbox?: { x: number; y: number; width: number; height: number };
  confidence: number;
};

export type ProductCardClickResult = {
  success: boolean;
  strategy?: ProductClickStrategy;
  reason: string;
  attemptedStrategies: Array<{
    strategy: ProductClickStrategy;
    success: boolean;
    error?: string;
  }>;
};

/**
 * Detect if a target is a product/card/list item that requires special click handling
 */
export function isProductCardTarget(
  target: string,
  semanticRole?: string,
  locatorStrategy?: string
): boolean {
  // Check semantic role
  if (semanticRole === "product" || semanticRole === "card" || semanticRole === "item") {
    return true;
  }

  // Check if locator strategy suggests product
  if (locatorStrategy === "product_condition") {
    return true;
  }

  // Check if target text suggests product/card
  const productKeywords = [
    "tarjeta", "cuenta", "crédito", "credito", "débito", "debito",
    "ahorro", "corriente", "plazo", "préstamo", "prestamo",
    "inversión", "inversion", "seguro", "póliza", "poliza"
  ];

  const targetLower = target.toLowerCase();
  const hasProductKeyword = productKeywords.some(kw => targetLower.includes(kw));

  return hasProductKeyword;
}

/**
 * Normalize text for comparison (remove accents, lowercase, alphanumeric only)
 */
function normalizeForComparison(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Wait for page stability before scanning for product cards
 * Ensures target is visible and URL is stable, with retry logic for SPA navigations
 */
async function waitForCandidateScanStability(
  page: Page,
  target: string
): Promise<{ targetVisible: boolean; elementCount: number }> {
  const startTime = Date.now();
  console.log(`[product-card-click] preCandidateWait started target="${target}"`);

  let targetVisible = false;
  let elementCount = 0;

  try {
    // Strategy 1: Wait for network idle (SPA navigations often trigger XHR)
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {
      console.log(`[product-card-click] networkidle timeout (continuing)`);
    });

    // Strategy 2: Wait for URL stability (no changes for 500ms)
    let lastUrl = page.url();
    let stableCount = 0;
    while (stableCount < 5) { // 5 checks * 100ms = 500ms stable
      await page.waitForTimeout(100);
      const currentUrl = page.url();
      if (currentUrl === lastUrl) {
        stableCount++;
      } else {
        stableCount = 0;
        lastUrl = currentUrl;
      }
    }

    // Strategy 3: Wait for target text to be visible (with retries)
    const targetLocator = page.getByText(target, { exact: false }).first();
    const maxRetries = 10;
    for (let i = 0; i < maxRetries; i++) {
      targetVisible = await targetLocator.isVisible({ timeout: 500 }).catch(() => false);
      if (targetVisible) {
        break;
      }
      await page.waitForTimeout(500);
    }

    // Strategy 4: Count DOM elements to verify page has loaded
    elementCount = await page.locator('body *').count().catch(() => 0);

    const elapsedMs = Date.now() - startTime;
    const currentUrl = page.url();

    console.log(
      `[product-card-click] preCandidateWait completed targetVisible=${targetVisible} ` +
      `elementCount=${elementCount} urlStable=true elapsedMs=${elapsedMs} url=${currentUrl}`
    );

    // If target not visible or too few elements, log warning
    if (!targetVisible) {
      console.log(
        `[product-card-click] warning: target not visible after ${elapsedMs}ms ` +
        `retries=10 url=${currentUrl}`
      );
    }
    if (elementCount < 100) {
      console.log(
        `[product-card-click] warning: few elements detected count=${elementCount} ` +
        `expected>100 possibleCause=page_not_fully_loaded`
      );
    }

    return { targetVisible, elementCount };
  } catch (err) {
    const elapsedMs = Date.now() - startTime;
    console.log(`[product-card-click] preCandidateWait error elapsedMs=${elapsedMs} err=${String(err)}`);
    return { targetVisible: false, elementCount: 0 };
  }
}

/**
 * Find clickable candidates within a product card
 * Returns ordered list of click strategies to try
 *
 * IMPORTANT: Uses Locator API instead of page.evaluate to avoid __name transpilation issues
 */
export async function findProductCardClickCandidates(
  page: Page,
  initialLocator: Locator,
  target: string,
  snapshot: PageSnapshot
): Promise<ProductClickCandidate[]> {
  const candidates: ProductClickCandidate[] = [];
  const normalizedTarget = normalizeForComparison(target);

  console.log(`[product-card-click] evaluateStrategy=locator_based browserEvalSafe=true`);

  // Wait for page stability before scanning
  const waitResult = await waitForCandidateScanStability(page, target);

  // Early exit if target not visible and few elements (page not loaded)
  // Do NOT use exact_text fallback as it will timeout - intermediate recovery should have run first
  if (!waitResult.targetVisible && waitResult.elementCount < 100) {
    console.log(
      `[product-card-click] earlyExit targetNotVisible=true fewElements=${waitResult.elementCount} ` +
      `reason=page_not_fully_loaded noFallback=true`
    );
    console.log(
      `[product-card-click] skipping exact_text fallback (will timeout) ` +
      `reason=target_not_on_page intermediate_recovery_should_have_run`
    );
    // Return empty candidates - intermediate recovery should have already attempted to fix this
    return candidates;
  }

  try {
    // Get bounding box of initial element for spatial search
    const initialBox = await initialLocator.boundingBox().catch(() => null);

    // Strategy 1: Find visual card container using broad scan
    // Scan all elements, check text content, bbox, and cursor style
    const allElements = await page.locator('body *').all();
    const maxScan = Math.min(allElements.length, 200); // Scan up to 200 elements

    console.log(`[product-card-click] scan totalElements=${allElements.length} scanLimit=${maxScan}`);

    let textMatches = 0;
    let pointerMatches = 0;
    let visualCardMatches = 0;
    const visualCardCandidates: Array<{
      element: Locator;
      bbox: { x: number; y: number; width: number; height: number };
      className: string;
      tagName: string;
      cursor: string;
      area: number;
    }> = [];

    for (let i = 0; i < maxScan; i++) {
      const element = allElements[i];
      try {
        const textContent = await element.textContent({ timeout: 100 }).catch(() => "");
        const normalizedContent = normalizeForComparison(textContent || "");

        if (!normalizedContent.includes(normalizedTarget)) {
          continue;
        }
        textMatches++;

        const bbox = await element.boundingBox().catch(() => null);
        if (!bbox || bbox.width < 100 || bbox.height < 100) {
          continue;
        }

        const className = await element.getAttribute("class").catch(() => "") || "";
        const tagName = await element.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
        const cursor = await element.evaluate((el) => window.getComputedStyle(el).cursor).catch(() => "auto");

        if (cursor !== "pointer" && !className.includes("cursor-pointer")) {
          console.log(
            `[product-card-click] visualCardReject reason=no_pointer_cursor ` +
            `tag=${tagName} bbox={w:${bbox.width},h:${bbox.height}} cursor=${cursor}`
          );
          continue;
        }
        pointerMatches++;

        // Check if looks like a card (not body/main/grid)
        const looksLikeCard = /card|product|item|tile|box|rounded|shadow|border|flex-col|flex-row/i.test(className) || tagName === "div";
        const isGiantContainer = tagName === "body" || tagName === "main" || /grid|container|wrapper|layout/i.test(className);

        if (!looksLikeCard || isGiantContainer) {
          console.log(
            `[product-card-click] visualCardReject reason=${isGiantContainer ? "giant_container" : "not_card_like"} ` +
            `tag=${tagName} class=${className.substring(0, 50)}`
          );
          continue;
        }

        visualCardMatches++;
        visualCardCandidates.push({
          element,
          bbox,
          className,
          tagName,
          cursor,
          area: bbox.width * bbox.height
        });
      } catch (err) {
        // Skip element on error
        continue;
      }
    }

    console.log(
      `[product-card-click] scan textMatches=${textMatches} pointerMatches=${pointerMatches} ` +
      `visualCardMatches=${visualCardMatches}`
    );

    // Select the most specific card (smallest area that still qualifies)
    if (visualCardCandidates.length > 0) {
      // Sort by area ascending (smallest first)
      visualCardCandidates.sort((a, b) => a.area - b.area);

      // Pick the smallest card that's not too small (prefer 150-600 width range if available)
      let selectedCard = visualCardCandidates[0];
      for (const card of visualCardCandidates) {
        if (card.bbox.width >= 150 && card.bbox.width <= 600) {
          selectedCard = card;
          break;
        }
      }

      const { element, bbox, className, tagName, cursor } = selectedCard;

      console.log(
        `[product-card-debug] visualCardFound=true target="${target}" ` +
        `bbox={x:${bbox.x},y:${bbox.y},width:${bbox.width},height:${bbox.height}} ` +
        `cursor=${cursor} classIncludesCursorPointer=${className.includes("cursor-pointer")}`
      );

      // A. card_container - click the container element itself
      candidates.push({
        strategy: "card_container",
        locator: element,
        description: `Visual card container with cursor:pointer`,
        tagName,
        bbox,
        confidence: 0.88
      });

      // B. heading_center - find heading inside card
      const headingLocator = element.locator("h1, h2, h3, h4, h5, h6").filter({ hasText: target }).first();
      const headingVisible = await headingLocator.isVisible({ timeout: 500 }).catch(() => false);
      if (headingVisible) {
        const headingBbox = await headingLocator.boundingBox().catch(() => null);
        const headingText = await headingLocator.textContent().catch(() => "");

        candidates.push({
          strategy: "card_center",
          locator: headingLocator,
          description: `Product heading center: ${headingText?.trim() || target}`,
          tagName: "h3",
          bbox: headingBbox ?? undefined,
          confidence: 0.86
        });
      }

      // C. card_image_center - find image inside card
      const imageLocator = element.locator("img").first();
      const imageVisible = await imageLocator.isVisible({ timeout: 500 }).catch(() => false);
      if (imageVisible) {
        const imageBbox = await imageLocator.boundingBox().catch(() => null);

        candidates.push({
          strategy: "card_center",
          locator: imageLocator,
          description: `Card image center`,
          tagName: "img",
          bbox: imageBbox ?? undefined,
          confidence: 0.84
        });
      }

      // D. visual_card_center - click center coordinates of card
      candidates.push({
        strategy: "card_center",
        locator: element,
        description: `Visual card center`,
        bbox,
        confidence: 0.82
      });

      // E-G. Coordinate-based strategies (upper, body, lower)
      candidates.push({
        strategy: "card_center",
        locator: element,
        description: `Card upper center (20%)`,
        bbox: {
          x: bbox.x + bbox.width / 2,
          y: bbox.y + bbox.height * 0.20,
          width: 0,
          height: 0
        },
        confidence: 0.78
      });

      candidates.push({
        strategy: "card_center",
        locator: element,
        description: `Card body center (50%)`,
        bbox: {
          x: bbox.x + bbox.width / 2,
          y: bbox.y + bbox.height * 0.50,
          width: 0,
          height: 0
        },
        confidence: 0.76
      });

      candidates.push({
        strategy: "card_center",
        locator: element,
        description: `Card lower center (80%)`,
        bbox: {
          x: bbox.x + bbox.width / 2,
          y: bbox.y + bbox.height * 0.80,
          width: 0,
          height: 0
        },
        confidence: 0.74
      });
    }

    // Strategy 2: SPA clickables - Angular/React attributes
    const spaClickablesLocator = page.locator(
      `[routerLink]:has-text("${target}"), ` +
      `[ng-reflect-router-link]:has-text("${target}"), ` +
      `[data-testid]:has-text("${target}"), ` +
      `[data-cy]:has-text("${target}"), ` +
      `[data-qa]:has-text("${target}")`
    ).first();

    const spaVisible = await spaClickablesLocator.isVisible({ timeout: 1000 }).catch(() => false);
    if (spaVisible) {
      const spaBox = await spaClickablesLocator.boundingBox().catch(() => null);
      const tagName = await spaClickablesLocator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
      const routerLink = await spaClickablesLocator.getAttribute("routerLink").catch(() => null) ||
                         await spaClickablesLocator.getAttribute("ng-reflect-router-link").catch(() => null);

      candidates.push({
        strategy: "inner_link",
        locator: spaClickablesLocator,
        description: `SPA link with route: ${routerLink || "detected"}`,
        tagName,
        bbox: spaBox ?? undefined,
        confidence: 0.72
      });
    }

    // Strategy 3: clickable_ancestor (nearest button, a, [role=button])
    const clickableAncestorLocator = page.locator(
      `button:has-text("${target}"), ` +
      `a[href]:has-text("${target}"), ` +
      `[role="button"]:has-text("${target}"), ` +
      `[onclick]:has-text("${target}")`
    ).first();

    const ancestorVisible = await clickableAncestorLocator.isVisible({ timeout: 1000 }).catch(() => false);
    if (ancestorVisible) {
      const ancestorBox = await clickableAncestorLocator.boundingBox().catch(() => null);
      const tagName = await clickableAncestorLocator.evaluate((el) => el.tagName.toLowerCase()).catch(() => "");
      const role = await clickableAncestorLocator.getAttribute("role").catch(() => null) ?? undefined;

      candidates.push({
        strategy: "clickable_ancestor",
        locator: clickableAncestorLocator,
        description: `Clickable ancestor containing "${target}"`,
        role,
        tagName,
        bbox: ancestorBox ?? undefined,
        confidence: 0.70
      });
    }

    // Strategy 4: inner_button - buttons inside card (FILTER by text match)
    if (visualCardCandidates.length > 0) {
      const innerButtonLocator = initialLocator.locator('xpath=ancestor::*[contains(@class, "card") or contains(@class, "product") or contains(@class, "item")][1]//button').first();
      const innerButtonVisible = await innerButtonLocator.isVisible({ timeout: 500 }).catch(() => false);

      if (innerButtonVisible) {
        const buttonBox = await innerButtonLocator.boundingBox().catch(() => null);
        const buttonText = await innerButtonLocator.textContent().catch(() => "");
        const buttonTextNormalized = normalizeForComparison(buttonText || "");

        // Only include if button text contains target (exclude category buttons)
        if (buttonTextNormalized.includes(normalizedTarget) || normalizedTarget.includes(buttonTextNormalized)) {
          candidates.push({
            strategy: "inner_button",
            locator: innerButtonLocator,
            description: `Button inside card: "${buttonText?.trim() || 'unnamed'}"`,
            tagName: "button",
            bbox: buttonBox ?? undefined,
            confidence: 0.68
          });
        } else {
          console.log(
            `[product-card-click] excluded candidate strategy=inner_button ` +
            `reason=text_not_matching_detail_target text="${buttonText?.trim()}"`
          );
        }
      }
    }

    // Strategy 5: exact_text (original locator) - lowest priority fallback
    const isVisible = await initialLocator.isVisible({ timeout: 1000 }).catch(() => false);
    if (isVisible) {
      candidates.push({
        strategy: "exact_text",
        locator: initialLocator,
        description: `Direct click on text "${target}"`,
        confidence: 0.50
      });
    }

  } catch (err) {
    console.log(`[product-card-click] error finding candidates: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Sort candidates by confidence (highest first)
  candidates.sort((a, b) => b.confidence - a.confidence);

  // Warning if only exact_text fallback was generated
  if (candidates.length === 1 && candidates[0].strategy === "exact_text") {
    console.log(
      `[product-card-click] warning=no_visual_card_candidates target="${target}" ` +
      `fallbackOnly=exact_text`
    );
  }

  console.log(`[product-card-click] target="${target}" candidates=${candidates.length}`);
  candidates.forEach((c, idx) => {
    console.log(
      `[product-card-click] candidate[${idx}] strategy=${c.strategy} ` +
      `confidence=${c.confidence.toFixed(2)} ` +
      `role=${c.role ?? "none"} tag=${c.tagName ?? "none"} ` +
      `desc="${c.description}"`
    );
  });

  return candidates;
}

/**
 * Write diagnostic dump when product card click fails
 */
async function writeProductCardDebug(
  page: Page,
  target: string,
  candidates: ProductClickCandidate[],
  attemptedStrategies: Array<{ strategy: ProductClickStrategy; success: boolean; error?: string }>,
  evidenceDir?: string
): Promise<void> {
  if (!evidenceDir) return;

  try {
    const debugData = {
      target,
      timestamp: new Date().toISOString(),
      url: page.url(),
      candidates: candidates.map(c => ({
        strategy: c.strategy,
        description: c.description,
        confidence: c.confidence,
        tagName: c.tagName,
        role: c.role,
        bbox: c.bbox
      })),
      attemptedStrategies,
      snapshot: await page.evaluate(() => {
        // Capture DOM structure around target
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT
        );

        const elements: any[] = [];
        let count = 0;
        while (walker.nextNode() && count < 100) {
          const el = walker.currentNode as Element;
          const computed = window.getComputedStyle(el);

          elements.push({
            tagName: el.tagName.toLowerCase(),
            className: el.className,
            id: el.id,
            textContent: el.textContent?.substring(0, 100),
            cursor: computed.cursor,
            hasOnclick: el.hasAttribute("onclick"),
            hasRouterLink: el.hasAttribute("routerLink") || el.hasAttribute("ng-reflect-router-link"),
            hasClickHandler: el.hasAttribute("(click)") || el.hasAttribute("ng-click"),
            dataTestId: el.getAttribute("data-testid"),
            ariaLabel: el.getAttribute("aria-label"),
            bbox: el.getBoundingClientRect()
          });
          count++;
        }

        return elements;
      })
    };

    const sanitizedTarget = target
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .substring(0, 50);

    const debugPath = join(evidenceDir, `product-card-debug-${sanitizedTarget}.json`);
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(debugPath, JSON.stringify(debugData, null, 2), "utf-8");

    console.log(`[product-card-debug] wrote path=${debugPath}`);
  } catch (err) {
    console.log(`[product-card-debug] error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Try clicking using multiple strategies until one succeeds
 * Returns the strategy that worked
 */
export async function tryProductCardClickStrategies(
  page: Page,
  candidates: ProductClickCandidate[],
  target: string,
  checkDetailOpened: () => Promise<boolean>,
  evidenceDir?: string
): Promise<ProductCardClickResult> {
  const attemptedStrategies: Array<{
    strategy: ProductClickStrategy;
    success: boolean;
    error?: string;
  }> = [];

  console.log(`[product-card-click] starting escalated click attempts target="${target}"`);

  // Capture initial URL to detect navigation
  const initialUrl = page.url();
  console.log(`[product-card-click] initialUrl=${initialUrl}`);

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];

    console.log(
      `[product-card-click] attempt=${i + 1}/${candidates.length} ` +
      `strategy=${candidate.strategy} desc="${candidate.description}"`
    );

    try {
      // Execute click based on strategy
      if (candidate.strategy === "card_center" && candidate.bbox) {
        // Position-based click
        // If width/height are 0, bbox contains exact coordinates; otherwise calculate center
        const centerX = candidate.bbox.width === 0
          ? candidate.bbox.x
          : candidate.bbox.x + candidate.bbox.width / 2;
        const centerY = candidate.bbox.height === 0
          ? candidate.bbox.y
          : candidate.bbox.y + candidate.bbox.height / 2;

        console.log(
          `[product-card-click] position-click x=${centerX.toFixed(1)} y=${centerY.toFixed(1)}`
        );
        await page.mouse.click(centerX, centerY);
      } else {
        // Locator-based click
        await candidate.locator.click({ timeout: 5000 });
      }

      // Custom detail-ready wait: poll until detail signals appear or timeout
      const DETAIL_TIMEOUT_MS = 20000;
      const DETAIL_POLL_MS = 600;
      console.log(`[detail-wait] started reason=post_selection_click target="${target}" timeoutMs=${DETAIL_TIMEOUT_MS}`);
      const detailPollStart = Date.now();
      let detailReady = false;
      let detailReadyReason = "";
      let loadingLogged = false;
      let pollingLogged = false;
      while (Date.now() - detailPollStart < DETAIL_TIMEOUT_MS) {
        await page.waitForTimeout(DETAIL_POLL_MS);
        const currentSnapshot = await scanCurrentPage(page).catch(() => null);
        // Detect loading
        const hasLoading = currentSnapshot ? (() => {
          const texts: string[] = [];
          if ((currentSnapshot as any).elements) {
            for (const el of (currentSnapshot as any).elements) {
              if (el.text) texts.push(el.text.toLowerCase());
            }
          }
          return texts.some(t => /cargando|loading|procesando|processing|espere/i.test(t));
        })() : false;
        if (hasLoading && !loadingLogged) {
          loadingLogged = true;
          console.log(`[detail-wait] loadingDetected=true source=text`);
        }
        // Check detail-ready signals
        const dc = await checkDetailOpened();
        if (dc) { detailReady = true; detailReadyReason = "checkDetailOpened"; break; }
        // Alert/dialog signal
        const hasAlert = currentSnapshot && (currentSnapshot as any).elements?.some((e: any) =>
          e.visible && (e.role === "alert" || e.role === "alertdialog" || e.tagName === "dialog")
        );
        const buttonCount = currentSnapshot ? (currentSnapshot as any).elements?.filter((e: any) =>
          (e.role === "button" || e.tagName === "button") && e.visible
        ).length || 0 : 0;
        if (hasAlert && buttonCount >= 1) { detailReady = true; detailReadyReason = "alert_with_buttons"; break; }
        // Button increase as detail signal
        if (buttonCount >= 3) { detailReady = true; detailReadyReason = "detail_buttons_visible"; break; }
        // Log still waiting periodically
        const elapsed = Date.now() - detailPollStart;
        if (elapsed > 3000 && !pollingLogged) {
          pollingLogged = true;
          console.log(`[detail-wait] stillWaiting reason=no_detail_signals waitedMs=${elapsed} loading=${hasLoading} buttons=${buttonCount} alert=${hasAlert}`);
        }
      }
      if (detailReady) {
        console.log(`[detail-wait] detailReady=true reason=${detailReadyReason} waitedMs=${Date.now() - detailPollStart}`);
        console.log(`[product-card-click] detailOpened=true reason=post_click_detail_wait`);
      } else {
        const reason = loadingLogged ? "timeout_still_loading" : "timeout_no_detail_signals";
        console.log(`[detail-wait] detailReady=false reason=${reason} waitedMs=${Date.now() - detailPollStart}`);
      }

      const currentUrl = page.url();
      const detailOpened = detailReady;

      console.log(
        `[product-card-click] attempt=${i + 1} strategy=${candidate.strategy} ` +
        `urlChanged=${currentUrl !== initialUrl} detailOpened=${detailOpened}`
      );

      attemptedStrategies.push({
        strategy: candidate.strategy,
        success: detailOpened
      });

      if (detailReady) {
        console.log(
          `[product-card-click] success=true strategy=${candidate.strategy} ` +
          `attempts=${i + 1}/${candidates.length}`
        );

        return {
          success: true,
          strategy: candidate.strategy,
          reason: "detail_opened",
          attemptedStrategies
        };
      } else {
        console.log(
          `[product-card-click] attempt=${i + 1} strategy=${candidate.strategy} ` +
          `result=no_detail continuing_to_next_strategy`
        );

        // If not the last strategy and URL changed, try to return to the list page
        if (i < candidates.length - 1 && currentUrl !== initialUrl) {
          console.log(`[product-card-click] urlChanged detected oldUrl="${initialUrl}" newUrl="${currentUrl}"`);

          // Try to go back
          try {
            console.log(`[product-card-click] navigating_back_to_retry`);
            await page.goBack({ waitUntil: "domcontentloaded", timeout: 3000 });
            await page.waitForTimeout(500);
          } catch {
            // Going back failed, continue anyway
            console.log(`[product-card-click] goBack failed, continuing`);
          }
        } else if (i < candidates.length - 1 && currentUrl === initialUrl) {
          console.log(`[product-card-click] retryReset skipped reason=same_url_same_screen`);
        }
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.log(
        `[product-card-click] attempt=${i + 1} strategy=${candidate.strategy} ` +
        `error="${errorMsg}"`
      );

      attemptedStrategies.push({
        strategy: candidate.strategy,
        success: false,
        error: errorMsg
      });
    }
  }

  // All strategies failed - write diagnostic dump
  console.log(
    `[product-card-click] failed target="${target}" ` +
    `attempts=${candidates.length} none_opened_detail`
  );

  await writeProductCardDebug(page, target, candidates, attemptedStrategies, evidenceDir);

  return {
    success: false,
    reason: "no_strategy_opened_detail",
    attemptedStrategies
  };
}
