import type { Page } from "@playwright/test";
import type {
  ProductCatalogDiscoveryResult,
  DiscoveredProduct,
  McpRouteProfile,
  EntryStepConfig,
  CatalogCandidate,
  ProductDetailSignals,
  DetectedProductCard,
} from "../scenarios/scenario-types";
import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";
import { scanCurrentPage } from "../explorer/page-scanner";
import { normalizeTarget } from "../scenarios/target-normalization";
import { waitForPageReady } from "../browser/page-readiness";

export type ProductCatalogDiscoveryOptions = {
  appSlug: string;
  routeProfile: McpRouteProfile | null;
  catalogMode?: "representative" | "exhaustive";
  maxProductsPerCategory?: number;
  maxDepth?: number; // Maximum depth for multilevel exploration (default: 3)
};

/**
 * Classify clickable candidates as category, subcategory, product, or detail
 *
 * Classification heuristics (multiproject, no hardcoding):
 * - category: Opens another list, groups multiple options, no detail signals
 * - subcategory: Similar to category but at deeper level
 * - product: Opens detail page with sections/buttons/description
 * - detail: Action buttons, info sections, already in detail view
 */
function classifyCandidate(
  element: SnapshotElement,
  context: { depth: number; hasMultipleItems: boolean }
): CatalogCandidate["type"] {
  const text = element.text || element.label || element.name || "";
  const tag = element.tagName?.toLowerCase();
  const role = element.role?.toLowerCase();

  // Detail indicators (already in detail view)
  const detailPatterns = [
    /^detalles?$/i,
    /^requisitos?$/i,
    /^beneficios?$/i,
    /^condiciones?$/i,
    /^informaci[oó]n/i,
    /^solicitar$/i,
    /^volver$/i,
    /^regresar$/i,
  ];

  for (const pattern of detailPatterns) {
    if (pattern.test(text)) {
      return "detail";
    }
  }

  // Category/subcategory indicators
  // At depth 0-1: likely categories
  // At depth 2+: likely subcategories or products
  if (context.depth <= 1 && context.hasMultipleItems) {
    // First level: categories
    return "category";
  } else if (context.depth === 2 && context.hasMultipleItems) {
    // Second level: subcategories
    return "subcategory";
  }

  // Default to product at deeper levels
  return "product";
}

/**
 * Capture detail signals when a product detail page is opened
 *
 * Looks for generic detail indicators:
 * - Section headings (Detalles, Requisitos, Beneficios, etc.)
 * - Action buttons (Solicitar, Volver, etc.)
 * - Detail text patterns
 */
async function captureProductDetailSignals(page: Page): Promise<ProductDetailSignals> {
  await waitForPageReady(page, { domContentLoadedTimeoutMs: 5000, stabilizationMs: 500 });

  const snapshot = await scanCurrentPage(page);

  const detailSections: string[] = [];
  const actionButtons: string[] = [];

  const detailSectionPatterns = [
    /^detalles?$/i,
    /^requisitos?$/i,
    /^beneficios?$/i,
    /^condiciones?$/i,
    /^tasas?$/i,
    /^informaci[oó]n\s+(?:del\s+)?producto/i,
    /^informaci[oó]n\s+legal/i,
    /^caracter[ií]sticas?$/i,
    /^descripci[oó]n$/i,
  ];

  const actionButtonPatterns = [
    /^solicitar$/i,
    /^volver$/i,
    /^regresar$/i,
    /^contratar$/i,
    /^pagar$/i,
    /^finalizar/i,
  ];

  for (const el of snapshot.elements) {
    const text = (el.text || el.label || el.name || "").trim();
    if (text.length === 0) continue;

    // Check for detail sections
    for (const pattern of detailSectionPatterns) {
      if (pattern.test(text) && !detailSections.includes(text)) {
        detailSections.push(text);
        break;
      }
    }

    // Check for action buttons
    const isButton =
      el.type === "button" || el.tagName?.toLowerCase() === "button" || el.role?.toLowerCase() === "button";
    if (isButton) {
      for (const pattern of actionButtonPatterns) {
        if (pattern.test(text) && !actionButtons.includes(text)) {
          actionButtons.push(text);
          break;
        }
      }
    }
  }

  const hasDetailPage = (detailSections.length > 0 && actionButtons.length > 0) || detailSections.length >= 2;

  console.log(
    `[catalog-discovery:detail] captured sections=${detailSections.length} buttons=${actionButtons.length} hasDetailPage=${hasDetailPage}`
  );

  return {
    detailSections,
    actionButtons,
    hasDetailPage,
  };
}

/**
 * Try to navigate back to previous screen
 *
 * Strategies:
 * 1. Click "Volver" button if exists and is safe
 * 2. Use browser back() as fallback
 * 3. If back() exits catalog context, re-navigate from entrySteps
 * 4. Return false if backtracking fails completely
 */
async function tryBackNavigation(page: Page, entrySteps: EntryStepConfig[]): Promise<boolean> {
  try {
    // Strategy 1: Look for "Volver" or "Regresar" button
    const backButtonPatterns = ["Volver", "Regresar", "Volver al listado"];

    for (const pattern of backButtonPatterns) {
      try {
        const locator = page.getByRole("button", { name: pattern });
        const count = await locator.count();
        if (count > 0) {
          await locator.first().click({ timeout: 3000 });
          await waitForPageReady(page, { domContentLoadedTimeoutMs: 3000, stabilizationMs: 500 });
          console.log(`[catalog-discovery:back] clicked "${pattern}" button`);
          return true;
        }
      } catch {
        // Try next pattern
      }
    }

    // Strategy 2: Browser back as fallback (but check if it stays in catalog)
    const urlBeforeBack = page.url();
    await page.goBack({ timeout: 5000, waitUntil: "domcontentloaded" });
    await waitForPageReady(page, { domContentLoadedTimeoutMs: 3000, stabilizationMs: 500 });
    const urlAfterBack = page.url();

    console.log(`[catalog-discovery:back] used browser back() from=${urlBeforeBack} to=${urlAfterBack}`);

    // Check if we exited catalog context (e.g., went to /success or login page)
    const exitedCatalog =
      urlAfterBack.includes("/success") ||
      urlAfterBack.includes("/login") ||
      urlAfterBack.includes("/home") ||
      urlAfterBack === urlBeforeBack; // Didn't actually go back

    if (exitedCatalog) {
      console.log(`[catalog-discovery:back] browser back() exited catalog, re-navigating from entrySteps`);

      // Strategy 3: Re-navigate from entrySteps
      const renavSuccess = await navigateToCatalogSection(page, entrySteps);
      if (renavSuccess) {
        console.log(`[catalog-discovery:back] successfully re-navigated to catalog`);
        return true;
      } else {
        console.log(`[catalog-discovery:back] re-navigation failed`);
        return false;
      }
    }

    return true;
  } catch (err) {
    console.log(`[catalog-discovery:back] failed: ${err}`);
    return false;
  }
}

/**
 * Detect product cards from a catalog grid/list
 *
 * Identifies repeated card/list-item structures that represent products.
 * Each card should have: title, descriptive text or bullets, optional image/icon.
 *
 * Returns detected cards for persistence as product_card presentation type.
 * Multiproject: no hardcoded terms, uses generic patterns.
 */
/**
 * Detect product cards/listings on screen
 *
 * Only called when there are NO useful navigable candidates (to avoid catalog_root false positives).
 * Requires minimum signals to validate as product cards.
 */
async function detectProductCards(
  snapshot: PageSnapshot,
  context: {
    depth: number;
    currentPath: string[];
    navigationCandidateCount: number;
    pageContext: "catalog_root" | "category_branch" | "product_listing" | "product_detail" | "unknown";
  }
): Promise<DetectedProductCard[]> {
  const detectedCards: DetectedProductCard[] = [];
  const seen = new Set<string>();

  // Safety: Don't detect cards on catalog_root or if there are navigation candidates
  if (context.pageContext === "catalog_root" || context.navigationCandidateCount > 0) {
    console.log(
      `[catalog-discovery:cards] skipping card detection: pageContext="${context.pageContext}" navCandidates=${context.navigationCandidateCount}`
    );
    return [];
  }

  // Find potential product containers (cards, list items, articles)
  const containers = snapshot.elements.filter((el) => {
    const tag = el.tagName?.toLowerCase();
    const role = el.role?.toLowerCase();
    const className = (el as any).className || "";

    // Match container patterns
    if (tag === "article") return true;
    if (role === "listitem" || role === "list-item") return true;

    if (typeof className === "string") {
      const normalizedClass = className.toLowerCase();
      const cardPatterns = [
        "card",
        "product",
        "item",
        "tile",
        "panel",
        "grid-item",
        "list-item",
        "catalog-item",
      ];
      for (const pattern of cardPatterns) {
        if (normalizedClass.includes(pattern)) return true;
      }
    }

    return false;
  });

  console.log(`[catalog-discovery:cards] found ${containers.length} potential card containers`);
  console.log(`[catalog-discovery:cards] current path: ${context.currentPath.join(" > ")}`);

  // Reject global intro cards, instructions, and list headings
  const instructionHeadingPatterns = [
    // Intro/welcome messages
    /^conoce\s+nuestros?\s+productos?$/i,
    /^nuestros?\s+productos?$/i,
    /^bienvenid[oa]s?\s+a\s+/i,
    /^explora\s+nuestras?\s+/i,
    /^descubre\s+/i,
    // Selection instructions
    /^seleccion[ae]\s+(un|una|el|la)\s+producto/i,
    /^elige\s+(un|una|el|la)\s+producto/i,
    /^escoge\s+(un|una|el|la)\s+producto/i,
    /^selecciona\s+tu\s+producto/i,
    /^elige\s+tu\s+producto/i,
    // List/catalog headings
    /^productos?\s+disponibles?$/i,
    /^listado\s+de\s+productos?$/i,
    /^cat[áa]logo\s+de\s+productos?$/i,
    /^ver\s+productos?$/i,
    /^todos\s+los\s+productos?$/i,
  ];

  // Debug: track rejected cards
  const rejectedCards: Array<{
    label: string;
    reason: string;
    bulletCount: number;
    hasImage: boolean;
    textPreview: string;
  }> = [];

  for (let i = 0; i < containers.length; i++) {
    const container = containers[i];

    console.log(`\n[catalog-discovery:cards] --- Container [${i}] ---`);
    console.log(`[catalog-discovery:cards] container text: "${(container.text || "").trim().substring(0, 100)}"`);
    console.log(`[catalog-discovery:cards] container role: ${container.role || "none"}`);
    console.log(`[catalog-discovery:cards] container tag: ${container.tagName || "none"}`);

    // Extract card content
    const children = getContainerChildren(container, snapshot);

    // Find title/heading (product label)
    // CRITICAL FIX: Check if container ITSELF is a heading FIRST to avoid off-by-one bug
    let productLabel: string | null = null;
    let isHeadingElement = false;
    let titleSource: "container_heading" | "child_heading" | "container_text" | "none" = "none";

    const containerTag = container.tagName?.toLowerCase();
    const containerRole = container.role?.toLowerCase();
    const containerIsHeading = containerTag?.startsWith("h") || containerRole === "heading";

    // Priority 1: If container ITSELF is a heading with valid text, use it
    if (containerIsHeading) {
      const containerText = (container.text || "").trim();
      if (containerText.length > 2) {
        isHeadingElement = true;
        const controlClassification = classifyControlType(containerText);
        if (!controlClassification || controlClassification.safeNavigation) {
          productLabel = containerText;
          titleSource = "container_heading";
          console.log(`[catalog-discovery:cards] using container heading as label: "${productLabel}"`);
        }
      }
    }

    // Priority 2: If no label yet, search children for heading
    if (!productLabel) {
      for (const child of children) {
        const text = (child.text || child.label || child.name || "").trim();
        const tag = child.tagName?.toLowerCase();
        const role = child.role?.toLowerCase();

        // Look for headings or prominent text (but not action controls)
        if ((tag?.startsWith("h") || role === "heading") && text.length > 2) {
          isHeadingElement = true;
          const controlClassification = classifyControlType(text);
          if (!controlClassification || controlClassification.safeNavigation) {
            productLabel = text;
            titleSource = "child_heading";
            console.log(`[catalog-discovery:cards] using child heading as label: "${productLabel}"`);
            break;
          }
        }
      }
    }

    // Priority 3: Fallback to container's own text
    if (!productLabel) {
      const containerText = (container.text || "").trim();
      if (containerText.length > 5) {
        productLabel = containerText;
        titleSource = "container_text";
        console.log(`[catalog-discovery:cards] using container text as label: "${productLabel}"`);
      }
    }

    console.log(`[catalog-discovery:cards] extracted label: "${productLabel || "null"}" titleSource=${titleSource}`);
    console.log(`[catalog-discovery:cards] isHeadingElement: ${isHeadingElement}`);

    if (!productLabel || !isValidProductLabel(productLabel, false)) {
      if (productLabel) {
        console.log(`[catalog-discovery:cards] REJECTED[${i}] "${productLabel}" - reason: invalid_product_label`);
        rejectedCards.push({
          label: productLabel,
          reason: "invalid_product_label",
          bulletCount: 0,
          hasImage: false,
          textPreview: "",
        });
      } else {
        console.log(`[catalog-discovery:cards] REJECTED[${i}] - reason: no_label_extracted`);
      }
      continue;
    }

    // CRITICAL FIX: Find clickable ancestor if label is from a heading
    let clickableAncestorFound = false;
    let clickableAncestorStrategy: string = "none";
    let clickableAncestorTag: string = "unknown";
    let labelElement: SnapshotElement | null = null;

    if (isHeadingElement) {
      // Find the heading element (container itself or first child heading)
      if (titleSource === "container_heading" && containerIsHeading) {
        labelElement = container;
      } else if (titleSource === "child_heading") {
        labelElement =
          children.find((c) => {
            const tag = c.tagName?.toLowerCase();
            const role = c.role?.toLowerCase();
            return (tag?.startsWith("h") || role === "heading") && (c.text || "").trim() === productLabel;
          }) || null;
      }

      if (labelElement) {
        const ancestorResult = findClickableAncestor(labelElement, snapshot, productLabel);
        if (ancestorResult.clickableAncestor) {
          clickableAncestorFound = true;
          clickableAncestorStrategy = ancestorResult.strategy;
          clickableAncestorTag = ancestorResult.containerTag;

          console.log(
            `[catalog-discovery:cards] found clickable ancestor for "${productLabel}" ` +
              `tag=${clickableAncestorTag} strategy=${clickableAncestorStrategy}`
          );
        }
      }
    }

    // Reject instruction headings and list titles
    const isInstructionHeading = instructionHeadingPatterns.some((pattern) => pattern.test(productLabel!));
    if (isInstructionHeading) {
      console.log(`[catalog-discovery:cards] REJECTED[${i}] "${productLabel}" - reason: instruction_heading_pattern`);
      rejectedCards.push({
        label: productLabel,
        reason: "instruction_heading_pattern",
        bulletCount: 0,
        hasImage: false,
        textPreview: "",
      });
      continue;
    }

    // Check for duplicates
    const normalized = normalizeTarget(productLabel);
    console.log(`[catalog-discovery:cards] normalized label: "${normalized}"`);
    if (seen.has(normalized)) {
      console.log(`[catalog-discovery:cards] REJECTED[${i}] "${productLabel}" - reason: duplicate_normalized_target`);
      rejectedCards.push({
        label: productLabel,
        reason: "duplicate_normalized_target",
        bulletCount: 0,
        hasImage: false,
        textPreview: "",
      });
      continue;
    }
    seen.add(normalized);

    // Extract card signals
    const cardTextPreview = children
      .map((c) => (c.text || "").trim())
      .filter((t) => t.length > 0 && t !== productLabel)
      .slice(0, 3)
      .join(" ");

    // Count bullet points (text starting with •, -, *, or in list items)
    const bulletCount = children.filter((c) => {
      const text = (c.text || "").trim();
      const role = c.role?.toLowerCase();
      return text.startsWith("•") || text.startsWith("-") || text.startsWith("*") || role === "listitem";
    }).length;

    // Check for images/icons
    const hasImageOrIcon = children.some((c) => {
      const tag = c.tagName?.toLowerCase();
      const role = c.role?.toLowerCase();
      return tag === "img" || role === "img" || role === "image";
    });

    console.log(`[catalog-discovery:cards] signals for "${productLabel}": bullets=${bulletCount} hasImage=${hasImageOrIcon} textPreview="${cardTextPreview.substring(0, 50)}"`);

    // Check if card or children are clickable
    const isClickable = children.some((c) => {
      const evidence = detectClickableEvidence(c);
      return evidence.hasEvidence;
    });

    // Build locator strategy if clickable
    let locatorStrategy: CatalogCandidate["locatorStrategy"] | undefined;
    if (isClickable) {
      const clickableChild = children.find((c) => detectClickableEvidence(c).hasEvidence);
      if (clickableChild) {
        locatorStrategy = buildLocatorStrategy(clickableChild, productLabel, false);
      }
    }

    // Structural validation: Reject cards that are likely headings/instructions
    // Check if this is a heading element with no clickable children and minimal text
    if (isHeadingElement && !isClickable && cardTextPreview.length < 50) {
      console.log(
        `[catalog-discovery:cards] REJECTED[${i}] "${productLabel}" - reason: heading_element_no_clickable_no_content`
      );
      rejectedCards.push({
        label: productLabel,
        reason: "heading_element_no_clickable_no_content",
        bulletCount,
        hasImage: hasImageOrIcon,
        textPreview: cardTextPreview.substring(0, 100),
      });
      continue;
    }

    // Validation: Require minimum signals for true product cards
    // At least bulletCount >= 1 OR significant text preview OR clickable with image
    const hasMinimumSignals =
      bulletCount >= 1 || cardTextPreview.length >= 30 || (isClickable && hasImageOrIcon);

    if (!hasMinimumSignals) {
      console.log(
        `[catalog-discovery:cards] REJECTED[${i}] "${productLabel}" - reason: insufficient_product_signals (bullets=${bulletCount} textLen=${cardTextPreview.length} clickable=${isClickable} hasImage=${hasImageOrIcon})`
      );
      rejectedCards.push({
        label: productLabel,
        reason: "insufficient_product_signals",
        bulletCount,
        hasImage: hasImageOrIcon,
        textPreview: cardTextPreview.substring(0, 100),
      });
      continue;
    }

    // Additional check: If textPreview is identical to label, reject (likely a bare heading)
    if (cardTextPreview.length > 0 && cardTextPreview.trim() === productLabel.trim()) {
      console.log(
        `[catalog-discovery:cards] REJECTED[${i}] "${productLabel}" - reason: text_preview_identical_to_label`
      );
      rejectedCards.push({
        label: productLabel,
        reason: "text_preview_identical_to_label",
        bulletCount,
        hasImage: hasImageOrIcon,
        textPreview: cardTextPreview.substring(0, 100),
      });
      continue;
    }

    detectedCards.push({
      productLabel,
      normalizedLabel: normalized,
      cardTextPreview: cardTextPreview.substring(0, 200),
      bulletCount,
      hasImageOrIcon,
      visibleSignals: [],
      cardIndex: i,
      isClickable: isClickable || clickableAncestorFound, // Clickable if children or ancestor clickable
      locatorStrategy,
      confidence: bulletCount >= 2 || cardTextPreview.length > 50 ? "high" : "medium",
      // NEW: Clickable ancestor metadata for detail probing
      clickableAncestorFound,
      clickableAncestorStrategy,
      clickableAncestorTag,
      labelElementTag: isHeadingElement ? (labelElement?.tagName?.toLowerCase() || "unknown") : "none",
    });

    console.log(
      `[catalog-discovery:cards] ACCEPTED[${i}] "${productLabel}" bullets=${bulletCount} hasImage=${hasImageOrIcon} ` +
        `clickable=${isClickable || clickableAncestorFound} confidence=${bulletCount >= 2 || cardTextPreview.length > 50 ? "high" : "medium"} ` +
        `clickableAncestorFound=${clickableAncestorFound} clickableAncestorStrategy=${clickableAncestorStrategy}`
    );
  }

  // Validation: Require minimum 2 cards (unless very strong signals)
  if (detectedCards.length === 1) {
    const singleCard = detectedCards[0];
    const hasStrongSignals = singleCard.bulletCount >= 3 && singleCard.cardTextPreview.length > 100;
    if (!hasStrongSignals) {
      console.log(
        `[catalog-discovery:cards] rejected single card without strong signals: "${singleCard.productLabel}"`
      );
      rejectedCards.push({
        label: singleCard.productLabel,
        reason: "single_card_weak_signals",
        bulletCount: singleCard.bulletCount,
        hasImage: singleCard.hasImageOrIcon,
        textPreview: singleCard.cardTextPreview.substring(0, 100),
      });

      // Log rejected cards summary
      if (rejectedCards.length > 0) {
        console.log(`[catalog-discovery:cards] rejected ${rejectedCards.length} cards:`);
        for (const rejected of rejectedCards) {
          console.log(
            `  - "${rejected.label}" reason=${rejected.reason} bullets=${rejected.bulletCount} hasImage=${rejected.hasImage}`
          );
        }
      }

      return [];
    }
  }

  console.log(`[catalog-discovery:cards] detected ${detectedCards.length} valid product cards`);

  // Log rejected cards summary if any
  if (rejectedCards.length > 0) {
    console.log(`[catalog-discovery:cards] rejected ${rejectedCards.length} cards during validation:`);
    for (const rejected of rejectedCards) {
      console.log(
        `  - "${rejected.label}" reason=${rejected.reason} bullets=${rejected.bulletCount} hasImage=${rejected.hasImage} textPreview="${rejected.textPreview.substring(0, 50)}"`
      );
    }
  }

  return detectedCards;
}

/**
 * Probe product cards for detail screens
 *
 * For each detected card, tries to click it (using clickable ancestor or fallback) and detects if a detail screen appears.
 * This is essential to determine clickableToDetail accurately.
 *
 * In exhaustive mode, ALL cards are probed regardless of clickable evidence in snapshot.
 * The snapshot may not capture complete DOM hierarchy, so we probe to discover actual clickability.
 *
 * Returns cards enriched with detail probe results.
 */
async function probeProductCardsForDetail(
  page: Page,
  detectedCards: DetectedProductCard[],
  entrySteps: EntryStepConfig[],
  exhaustiveMode: boolean = false
): Promise<
  Array<
    DetectedProductCard & {
      detailProbeAttempted: boolean;
      detailProbeResult: "validated_detail" | "no_detail" | "click_failed";
      detailSignals?: ProductDetailSignals;
    }
  >
> {
  const probedCards: Array<
    DetectedProductCard & {
      detailProbeAttempted: boolean;
      detailProbeResult: "validated_detail" | "no_detail" | "click_failed";
      detailSignals?: ProductDetailSignals;
    }
  > = [];

  console.log(
    `[catalog-discovery:probe] starting detail probing for ${detectedCards.length} cards (exhaustiveMode=${exhaustiveMode})`
  );

  for (const card of detectedCards) {
    let detailProbeAttempted = false;
    let detailProbeResult: "validated_detail" | "no_detail" | "click_failed" = "click_failed";
    let detailSignals: ProductDetailSignals | undefined;

    // In exhaustive mode, probe ALL cards to discover actual clickability
    // In representative mode, only probe cards with clickable evidence
    const shouldProbe = exhaustiveMode || card.isClickable || card.clickableAncestorFound;

    if (!shouldProbe) {
      console.log(`[catalog-discovery:probe] skipping "${card.productLabel}" - not clickable (representative mode)`);
      probedCards.push({
        ...card,
        detailProbeAttempted: false,
        detailProbeResult: "no_detail",
      });
      continue;
    }

    try {
      detailProbeAttempted = true;

      console.log(
        `[catalog-discovery:probe] attempting click on "${card.productLabel}" ` +
          `clickableAncestorFound=${card.clickableAncestorFound} strategy=${card.clickableAncestorStrategy || "fallback"}`
      );

      // Build locator for click attempt
      // Priority 1: Use clickable ancestor if found
      // Priority 2: Use card's locatorStrategy
      // Priority 3: Fallback to text match

      let clicked = false;
      const urlBeforeClick = page.url();

      // Try clicking using text locator (most reliable for headings)
      try {
        const locator = page.getByText(card.productLabel, { exact: true });
        const count = await locator.count();

        if (count > 0) {
          const isVisible = await locator.first().isVisible({ timeout: 1000 }).catch(() => false);
          if (isVisible) {
            await locator.first().click({ timeout: 5000 });
            clicked = true;
            console.log(`[catalog-discovery:probe] clicked "${card.productLabel}" using text locator`);
          }
        }
      } catch (err) {
        console.log(`[catalog-discovery:probe] text locator click failed for "${card.productLabel}": ${err}`);
      }

      // If text click failed, try locatorStrategy if available
      if (!clicked && card.locatorStrategy) {
        try {
          let locator;
          const strategy = card.locatorStrategy;

          switch (strategy.type) {
            case "role":
              if (strategy.role) {
                locator = page.getByRole(strategy.role as any, { name: strategy.text });
              } else {
                locator = page.getByText(strategy.text);
              }
              break;

            case "testId":
              locator = page.locator(strategy.selector!);
              break;

            case "containerText":
              locator = page.locator(`text=${strategy.text}`).locator("button, a, [role=button], [role=link]").first();
              break;

            case "text":
              locator = page.getByText(strategy.text, { exact: true });
              break;

            default:
              locator = null;
          }

          if (locator) {
            const count = await locator.count();
            if (count > 0) {
              const isVisible = await locator.first().isVisible({ timeout: 1000 }).catch(() => false);
              if (isVisible) {
                await locator.first().click({ timeout: 5000 });
                clicked = true;
                console.log(`[catalog-discovery:probe] clicked "${card.productLabel}" using locatorStrategy`);
              }
            }
          }
        } catch (err) {
          console.log(`[catalog-discovery:probe] locatorStrategy click failed for "${card.productLabel}": ${err}`);
        }
      }

      if (!clicked) {
        console.log(`[catalog-discovery:probe] could not click "${card.productLabel}" - no valid locator found`);
        detailProbeResult = "click_failed";
        probedCards.push({
          ...card,
          detailProbeAttempted,
          detailProbeResult,
        });
        continue;
      }

      // Wait for navigation or content change
      await waitForPageReady(page, { domContentLoadedTimeoutMs: 5000, stabilizationMs: 500 });

      const urlAfterClick = page.url();
      const urlChanged = urlAfterClick !== urlBeforeClick;

      console.log(
        `[catalog-discovery:probe] after click on "${card.productLabel}" urlChanged=${urlChanged} ` +
          `from=${urlBeforeClick} to=${urlAfterClick}`
      );

      // Capture detail signals
      detailSignals = await captureProductDetailSignals(page);

      if (detailSignals.hasDetailPage) {
        detailProbeResult = "validated_detail";
        console.log(
          `[catalog-discovery:probe] detail detected for "${card.productLabel}" ` +
            `sections=${detailSignals.detailSections?.length || 0} buttons=${detailSignals.actionButtons?.length || 0}`
        );
      } else {
        detailProbeResult = "no_detail";
        console.log(
          `[catalog-discovery:probe] no detail detected for "${card.productLabel}" - card is not clickable to detail`
        );
      }

      // Navigate back to list
      const backSuccess = await tryBackNavigation(page, entrySteps);
      if (!backSuccess) {
        console.log(`[catalog-discovery:probe] WARNING: backtracking failed after probing "${card.productLabel}"`);
        // Continue anyway - we have the probe result
      }

      // Re-scan to refresh locators for next card
      await waitForPageReady(page, { domContentLoadedTimeoutMs: 3000, stabilizationMs: 500 });
    } catch (err) {
      console.log(`[catalog-discovery:probe] error probing "${card.productLabel}": ${err}`);
      detailProbeResult = "click_failed";
    }

    probedCards.push({
      ...card,
      detailProbeAttempted,
      detailProbeResult,
      detailSignals,
    });
  }

  const validatedDetailCount = probedCards.filter((c) => c.detailProbeResult === "validated_detail").length;
  const noDetailCount = probedCards.filter((c) => c.detailProbeResult === "no_detail").length;
  const clickFailedCount = probedCards.filter((c) => c.detailProbeResult === "click_failed").length;

  console.log(
    `[catalog-discovery:probe] completed probing: validated_detail=${validatedDetailCount} ` +
      `no_detail=${noDetailCount} click_failed=${clickFailedCount}`
  );

  return probedCards;
}

/**
 * Scroll and rescan for additional product cards in exhaustive mode
 *
 * Handles cases where product cards are in scrollable containers
 * and need incremental loading to capture all variants.
 *
 * @param page Playwright page
 * @param initialCards Cards detected before scrolling
 * @param context Detection context
 * @returns Combined deduplicated cards (initial + scrolled)
 */
async function scrollAndRescanForCards(
  page: Page,
  initialCards: DetectedProductCard[],
  context: {
    depth: number;
    currentPath: string[];
    navigationCandidateCount: number;
    pageContext: "catalog_root" | "category_branch" | "product_listing" | "product_detail" | "unknown";
  }
): Promise<DetectedProductCard[]> {
  console.log(`[catalog-discovery:scroll] starting scroll/rescan for additional cards`);

  const allCards = [...initialCards];
  const seenNormalized = new Set(initialCards.map((c) => c.normalizedLabel));

  try {
    // Try to scroll the page - check for scrollable height
    const scrollableHeight = await page.evaluate(() => {
      return document.documentElement.scrollHeight - document.documentElement.clientHeight;
    });

    if (scrollableHeight <= 0) {
      console.log(`[catalog-discovery:scroll] page not scrollable, skipping scroll/rescan`);
      return allCards;
    }

    // Perform incremental scrolls
    const scrollSteps = 3; // Number of scroll attempts
    const scrollAmount = Math.floor(scrollableHeight / scrollSteps);

    for (let i = 1; i <= scrollSteps; i++) {
      console.log(`[catalog-discovery:scroll] scroll step ${i}/${scrollSteps}`);

      // Scroll down
      await page.evaluate((amount) => {
        window.scrollBy(0, amount);
      }, scrollAmount);

      // Wait for any lazy-loaded content
      await page.waitForTimeout(800);
      await waitForPageReady(page, { domContentLoadedTimeoutMs: 3000, stabilizationMs: 300 });

      // Re-scan for cards
      const snapshot = await scanCurrentPage(page);
      const newCards = await detectProductCards(snapshot, context);

      // Add new cards (deduplicate by normalizedLabel)
      let newCardsCount = 0;
      for (const card of newCards) {
        if (!seenNormalized.has(card.normalizedLabel)) {
          allCards.push(card);
          seenNormalized.add(card.normalizedLabel);
          newCardsCount++;
          console.log(`[catalog-discovery:scroll] found new card after scroll: "${card.productLabel}"`);
        }
      }

      if (newCardsCount === 0) {
        console.log(`[catalog-discovery:scroll] no new cards found, stopping scroll`);
        break;
      }
    }

    console.log(
      `[catalog-discovery:scroll] completed: initial=${initialCards.length} total=${allCards.length} new=${allCards.length - initialCards.length}`
    );
  } catch (err) {
    console.log(`[catalog-discovery:scroll] scroll/rescan failed: ${err}`);
  }

  return allCards;
}

/**
 * Explore multilevel catalog recursively
 *
 * Discovers products by exploring categories/subcategories until reaching final products.
 * Uses backtracking to return to previous level after exploration.
 *
 * @param page Playwright page
 * @param currentPath Current navigation path (e.g. ["Información de productos", "Cuentas"])
 * @param depth Current depth (0 = root catalog screen)
 * @param maxDepth Maximum depth to explore
 * @returns Discovered products with full paths
 */
async function exploreMultilevelCatalog(
  page: Page,
  currentPath: string[],
  depth: number,
  maxDepth: number,
  entrySteps: EntryStepConfig[],
  catalogMode?: "representative" | "exhaustive"
): Promise<DiscoveredProduct[]> {
  if (depth >= maxDepth) {
    console.log(`[catalog-discovery] max depth=${maxDepth} reached at path=${currentPath.join(" > ")}`);
    return [];
  }

  console.log(`[catalog-discovery] depth=${depth} exploring path="${currentPath.join(" > ")}"`);

  // Scan current screen
  await waitForPageReady(page, { domContentLoadedTimeoutMs: 5000, stabilizationMs: 500 });
  const snapshot = await scanCurrentPage(page);

  // Check if current screen is already a product detail page
  // This happens when clicking a product takes us directly to detail, not to a list
  const detailSignals = await captureProductDetailSignals(page);
  console.log(
    `[catalog-discovery:detail] captured sections=${detailSignals.detailSections?.length || 0} ` +
      `buttons=${detailSignals.actionButtons?.length || 0} hasDetailPage=${detailSignals.hasDetailPage}`
  );

  if (detailSignals.hasDetailPage && currentPath.length > 0) {
    // Current screen is a detail page - persist the last path segment as final product
    const productLabel = currentPath[currentPath.length - 1];
    console.log(`[catalog-discovery] detected detail screen for product="${productLabel}"`);

    const product: DiscoveredProduct = {
      label: productLabel,
      normalizedLabel: normalizeTarget(productLabel),
      confidence: "high",
      groupKey: buildGroupKey(productLabel),
      locator: `text="${productLabel}"`,
      discoveryPath: currentPath,
      detailSignals,
      presentationType: "detail_page",
      validationStatus: "validated_detail",
    };

    console.log(
      `[catalog-discovery] captured product with detailSignals sections=${detailSignals.detailSections?.length || 0} ` +
        `buttons=${detailSignals.actionButtons?.length || 0}`
    );

    // Don't explore controls on detail screen - return this product
    return [product];
  }

  // Find clickable candidates FIRST - check if we have navigation options
  const candidates = await detectCatalogCandidates(snapshot, { depth, hasMultipleItems: snapshot.elements.length > 5 });

  // Infer page context to decide whether to check for product cards
  const pageContext = inferPageContext(snapshot, candidates, currentPath, depth);
  console.log(`[catalog-discovery] depth=${depth} pageContext="${pageContext}"`);

  console.log(
    `[catalog-discovery] depth=${depth} candidates categories=${candidates.filter((c) => c.type === "category").length} ` +
      `subcategories=${candidates.filter((c) => c.type === "subcategory").length} ` +
      `products=${candidates.filter((c) => c.type === "product").length}`
  );

  const discoveredProducts: DiscoveredProduct[] = [];

  // If we have categories/subcategories, explore them FIRST
  const navCandidates = candidates.filter((c) => c.type === "category" || c.type === "subcategory");

  if (navCandidates.length > 0) {
    console.log(`[catalog-discovery] depth=${depth} detected branch screen with ${navCandidates.length} navigation candidates, exploring branches first`);

    for (const candidate of navCandidates) {
      try {
        // Click on category/subcategory using smart click strategy
        const clicked = await clickCandidate(page, candidate);
        if (!clicked) {
          console.log(`[catalog-discovery] skipped candidate "${candidate.label}": click failed or not clickable`);
          continue;
        }

        await waitForPageReady(page, { domContentLoadedTimeoutMs: 5000, stabilizationMs: 500 });

        console.log(`[catalog-discovery] exploring path="${currentPath.join(" > ")} > ${candidate.label}"`);

        // Recursively explore this branch
        const branchProducts = await exploreMultilevelCatalog(
          page,
          [...currentPath, candidate.label],
          depth + 1,
          maxDepth,
          entrySteps,
          catalogMode
        );

        discoveredProducts.push(...branchProducts);

        // Navigate back
        const backSuccess = await tryBackNavigation(page, entrySteps);
        if (!backSuccess) {
          console.log(`[catalog-discovery] backtracking failed at depth=${depth}, cannot continue exploration`);
          break;
        }

        // Re-scan after backtracking to refresh locators for remaining candidates
        await waitForPageReady(page, { domContentLoadedTimeoutMs: 3000, stabilizationMs: 500 });
        console.log(`[catalog-discovery] re-scanned after backtracking, ready for next candidate`);
      } catch (err) {
        console.log(`[catalog-discovery] error exploring candidate "${candidate.label}": ${err}`);
        // Try to recover by going back
        await tryBackNavigation(page, entrySteps);
      }
    }
  }

  // If we have product candidates, try to open their details
  const productCandidates = candidates.filter((c) => c.type === "product");

  if (productCandidates.length > 0) {
    console.log(`[catalog-discovery] depth=${depth} detected product list count=${productCandidates.length}`);

    for (const candidate of productCandidates) {
      try {
        // Click on product using smart click strategy
        const clicked = await clickCandidate(page, candidate);
        if (!clicked) {
          console.log(`[catalog-discovery] skipped product "${candidate.label}": click failed or not clickable`);
          continue;
        }

        console.log(`[catalog-discovery] opened product detail target="${candidate.label}"`);

        // Capture detail signals
        const productDetailSignals = await captureProductDetailSignals(page);

        // Only add as product if detail page was reached
        if (productDetailSignals.hasDetailPage) {
          const product: DiscoveredProduct = {
            label: candidate.label,
            normalizedLabel: candidate.normalizedLabel,
            confidence: productDetailSignals.hasDetailPage ? "high" : "medium",
            groupKey: buildGroupKey(candidate.label),
            locator: candidate.locator,
            href: candidate.href,
            discoveryPath: [...currentPath, candidate.label],
            detailSignals: productDetailSignals,
            presentationType: "detail_page",
            validationStatus: "validated_detail",
          };

          discoveredProducts.push(product);

          console.log(
            `[catalog-discovery] captured detailSignals sections=${productDetailSignals.detailSections?.length || 0} ` +
              `buttons=${productDetailSignals.actionButtons?.length || 0}`
          );
        } else {
          console.log(`[catalog-discovery] skipping "${candidate.label}": no detail signals detected`);
        }

        // Navigate back to list
        await tryBackNavigation(page, entrySteps);

        // Re-scan after backtracking to refresh locators for remaining products
        await waitForPageReady(page, { domContentLoadedTimeoutMs: 3000, stabilizationMs: 500 });
        console.log(`[catalog-discovery] re-scanned after backtracking, ready for next product`);
      } catch (err) {
        console.log(`[catalog-discovery] error opening product "${candidate.label}": ${err}`);
        await tryBackNavigation(page, entrySteps);
      }
    }
  }

  // Only check for product cards if:
  // 1. NO navigable candidates were explored
  // 2. Page context is NOT catalog_root (avoid false positives on landing screens)
  // 3. We're likely on a terminal listing or unknown screen with product evidence
  if (
    navCandidates.length === 0 &&
    !detailSignals.hasDetailPage &&
    pageContext !== "catalog_root" &&
    currentPath.length > 0
  ) {
    console.log(
      `[catalog-discovery] no navigable candidates, checking for product cards pageContext="${pageContext}"`
    );

    let detectedCards = await detectProductCards(snapshot, {
      depth,
      currentPath,
      navigationCandidateCount: navCandidates.length,
      pageContext,
    });

    // In exhaustive mode, scroll and rescan to capture all variants
    if (catalogMode === "exhaustive" && detectedCards.length > 0) {
      console.log(`[catalog-discovery] exhaustive mode: performing scroll/rescan for additional cards`);
      detectedCards = await scrollAndRescanForCards(page, detectedCards, {
        depth,
        currentPath,
        navigationCandidateCount: navCandidates.length,
        pageContext,
      });
    }

    if (detectedCards.length > 0) {
      // Probe cards for detail screens (critical for accurate clickableToDetail detection)
      console.log(`[catalog-discovery] detected ${detectedCards.length} product cards, starting detail probing`);

      const probedCards = await probeProductCardsForDetail(page, detectedCards, entrySteps, catalogMode === "exhaustive");

      // Persist each card with probe results
      console.log(
        `[catalog-discovery] persisting ${probedCards.length} product cards with detail probe results`
      );

      const cardProducts: DiscoveredProduct[] = probedCards.map((card) => {
        // Determine presentation type and validation status based on probe results
        let presentationType: "product_card" | "detail_page" = "product_card";
        let validationStatus: "validated_card" | "validated_detail" = "validated_card";
        let clickableToDetail = false;
        const detailSignals: ProductDetailSignals = {
          detailSections: [],
          actionButtons: [],
          hasDetailPage: false,
        };

        if (card.detailProbeResult === "validated_detail" && card.detailSignals) {
          // Card opens detail screen
          presentationType = "detail_page"; // It's effectively a detail page (card that opens detail)
          validationStatus = "validated_detail";
          clickableToDetail = true;
          detailSignals.detailSections = card.detailSignals.detailSections || [];
          detailSignals.actionButtons = card.detailSignals.actionButtons || [];
          detailSignals.hasDetailPage = true;
        } else {
          // Card does not open detail (no_detail or click_failed)
          presentationType = "product_card";
          validationStatus = "validated_card";
          clickableToDetail = false;
        }

        console.log(
          `[catalog-discovery:persist] "${card.productLabel}" ` +
            `clickableToDetail=${clickableToDetail} presentationType=${presentationType} ` +
            `detailProbeResult=${card.detailProbeResult} ` +
            `clickableAncestorFound=${card.clickableAncestorFound} ` +
            `labelElementTag=${card.labelElementTag} clickableAncestorTag=${card.clickableAncestorTag}`
        );

        return {
          label: card.productLabel,
          normalizedLabel: card.normalizedLabel,
          confidence: card.confidence,
          groupKey: buildGroupKey(card.productLabel),
          locator: card.locatorStrategy
            ? `${card.locatorStrategy.type}:${card.locatorStrategy.text}`
            : `text="${card.productLabel}"`,
          discoveryPath: currentPath,
          detailSignals,
          presentationType,
          validationStatus,
          cardSignals: {
            cardTextPreview: card.cardTextPreview,
            bulletCount: card.bulletCount,
            hasImageOrIcon: card.hasImageOrIcon,
            visibleSignals: card.visibleSignals,
            cardIndex: card.cardIndex,
          },
          clickableToDetail,
          // Include probe metadata for diagnostics
          probeMetadata: {
            detailProbeAttempted: card.detailProbeAttempted,
            detailProbeResult: card.detailProbeResult,
            clickableAncestorFound: card.clickableAncestorFound,
            clickableAncestorStrategy: card.clickableAncestorStrategy,
            clickableAncestorTag: card.clickableAncestorTag,
            labelElementTag: card.labelElementTag,
          },
        };
      });

      discoveredProducts.push(...cardProducts);
      console.log(`[catalog-discovery] persisted ${cardProducts.length} product cards as products`);
    }
  }

  return discoveredProducts;
}

/**
 * Detect clickable evidence for an element
 *
 * Returns evidence object indicating if element is truly interactive.
 */
function detectClickableEvidence(el: SnapshotElement): {
  hasEvidence: boolean;
  evidence: CatalogCandidate["clickableEvidence"];
  rejectedReason?: string;
} {
  const tag = el.tagName?.toLowerCase();
  const role = el.role?.toLowerCase();
  const type = el.type?.toLowerCase();

  // Check for heading (should be rejected)
  if (tag?.startsWith("h") || role === "heading") {
    return {
      hasEvidence: false,
      evidence: undefined,
      rejectedReason: "heading_not_clickable",
    };
  }

  const evidence: CatalogCandidate["clickableEvidence"] = {};
  let hasAnyEvidence = false;

  // Interactive roles
  const interactiveRoles = ["button", "link", "menuitem", "tab", "option"];
  if (role && interactiveRoles.includes(role)) {
    evidence.hasRole = true;
    hasAnyEvidence = true;
  }

  // Clickable tags
  if (tag === "button" || tag === "a") {
    evidence.hasClickableTag = true;
    hasAnyEvidence = true;
  }

  // Button/link type
  if (type === "button" || type === "link") {
    evidence.hasClickableTag = true;
    hasAnyEvidence = true;
  }

  // Interactive ARIA attributes
  const ariaAttrs = (el as any).ariaExpanded || (el as any).ariaControls || (el as any).ariaHasPopup;
  if (ariaAttrs) {
    evidence.hasInteractiveAria = true;
    hasAnyEvidence = true;
  }

  // Check onclick attribute
  const hasOnClick = (el as any).onclick !== undefined;
  if (hasOnClick) {
    evidence.hasInteractiveAria = true;
    hasAnyEvidence = true;
  }

  // Check tabindex (indicates focusable/interactive element)
  const tabindex = (el as any).tabIndex || (el as any).tabindex;
  if (tabindex !== undefined && tabindex >= 0) {
    evidence.hasInteractiveAria = true;
    hasAnyEvidence = true;
  }

  // Check if container has internal clickable
  // This is checked in the calling code by looking at children

  if (!hasAnyEvidence) {
    return {
      hasEvidence: false,
      evidence: undefined,
      rejectedReason: "no_interactive_evidence",
    };
  }

  return {
    hasEvidence: true,
    evidence,
  };
}

/**
 * Find clickable ancestor for a heading element
 *
 * Searches upward from a heading (h3/h2) to find a clickable ancestor that wraps the product card.
 * The ancestor should be interactive (button, a, role, onclick, etc.) but not a global container.
 *
 * Returns the clickable ancestor element and strategy, or null if none found.
 */
function findClickableAncestor(
  labelElement: SnapshotElement,
  snapshot: PageSnapshot,
  productLabel: string
): {
  clickableAncestor: SnapshotElement | null;
  strategy: "button" | "link" | "role_button" | "onclick" | "tabindex" | "none";
  containerTag: string;
} {
  const labelIndex = snapshot.elements.indexOf(labelElement);
  if (labelIndex === -1) {
    return { clickableAncestor: null, strategy: "none", containerTag: "unknown" };
  }

  // Search backward in snapshot to find potential ancestors
  // Ancestors should appear BEFORE the heading in DOM order
  const potentialAncestors: SnapshotElement[] = [];

  for (let i = labelIndex - 1; i >= 0; i--) {
    const candidate = snapshot.elements[i];
    const tag = candidate.tagName?.toLowerCase();

    // Skip if it's another heading at same level (indicates sibling, not ancestor)
    if (tag?.startsWith("h")) continue;

    // Collect potential ancestors (containers, clickable elements)
    const isContainer = isProductContainer(candidate);
    const clickableEvidence = detectClickableEvidence(candidate);

    if (isContainer || clickableEvidence.hasEvidence) {
      potentialAncestors.push(candidate);
    }

    // Stop at global containers
    if (tag === "body" || tag === "main" || tag === "section") {
      break;
    }

    // Stop after collecting enough candidates (limit search depth)
    if (potentialAncestors.length >= 10) {
      break;
    }
  }

  // Find the closest clickable ancestor that contains the product label text
  for (const ancestor of potentialAncestors) {
    const ancestorText = (ancestor.text || "").toLowerCase();
    const labelText = productLabel.toLowerCase();

    // Check if ancestor contains the label text
    if (!ancestorText.includes(labelText)) {
      continue;
    }

    // Check if ancestor is clickable
    const evidence = detectClickableEvidence(ancestor);
    if (!evidence.hasEvidence) {
      continue;
    }

    // Check that ancestor doesn't contain multiple product labels (too broad)
    // This prevents selecting a container that wraps multiple cards
    let otherProductCount = 0;
    for (let i = labelIndex + 1; i < snapshot.elements.length && i < labelIndex + 20; i++) {
      const sibling = snapshot.elements[i];
      const siblingTag = sibling.tagName?.toLowerCase();

      if (siblingTag?.startsWith("h") && sibling !== labelElement) {
        const siblingText = (sibling.text || "").trim();
        if (siblingText.length > 5 && ancestorText.includes(siblingText.toLowerCase())) {
          otherProductCount++;
        }
      }
    }

    if (otherProductCount > 0) {
      console.log(`[catalog-discovery:ancestor] rejected ancestor for "${productLabel}": contains ${otherProductCount} other products`);
      continue;
    }

    // Determine strategy
    const tag = ancestor.tagName?.toLowerCase();
    const role = ancestor.role?.toLowerCase();
    let strategy: "button" | "link" | "role_button" | "onclick" | "tabindex" | "none" = "none";

    if (tag === "button") strategy = "button";
    else if (tag === "a") strategy = "link";
    else if (role === "button") strategy = "role_button";
    else if ((ancestor as any).onclick !== undefined) strategy = "onclick";
    else if ((ancestor as any).tabIndex !== undefined && (ancestor as any).tabIndex >= 0) strategy = "tabindex";

    console.log(
      `[catalog-discovery:ancestor] found clickable ancestor for "${productLabel}" tag=${tag} role=${role} strategy=${strategy}`
    );

    return {
      clickableAncestor: ancestor,
      strategy,
      containerTag: tag || "unknown",
    };
  }

  console.log(`[catalog-discovery:ancestor] no clickable ancestor found for "${productLabel}"`);
  return { clickableAncestor: null, strategy: "none", containerTag: "unknown" };
}

/**
 * Build locator strategy for a candidate
 */
function buildLocatorStrategy(
  el: SnapshotElement,
  label: string,
  hasInternalClickable: boolean
): CatalogCandidate["locatorStrategy"] {
  const tag = el.tagName?.toLowerCase();
  const role = el.role?.toLowerCase();
  const testId = (el as any).testId || (el as any)["data-testid"];

  // Priority 1: testId
  if (testId) {
    return {
      type: "testId",
      text: label,
      selector: `[data-testid="${testId}"]`,
    };
  }

  // Priority 2: role
  if (role && ["button", "link", "menuitem", "tab"].includes(role)) {
    return {
      type: "role",
      role,
      text: label,
    };
  }

  // Priority 3: clickable tag
  if (tag === "button" || tag === "a") {
    return {
      type: "role",
      role: tag === "button" ? "button" : "link",
      text: label,
    };
  }

  // Priority 4: container with internal clickable
  if (hasInternalClickable) {
    return {
      type: "containerText",
      text: label,
    };
  }

  // Fallback: text locator
  return {
    type: "text",
    text: label,
  };
}

/**
 * Click a candidate using its locator strategy
 *
 * Returns true if click succeeded, false if should skip candidate.
 */
async function clickCandidate(page: Page, candidate: CatalogCandidate): Promise<boolean> {
  const strategy = candidate.locatorStrategy;

  console.log(
    `[catalog-discovery:click] attempting "${candidate.label}" strategy=${strategy.type} role=${strategy.role || "none"}`
  );

  // Build locator based on strategy
  let locator;

  try {
    switch (strategy.type) {
      case "testId":
        locator = page.locator(strategy.selector!);
        break;

      case "role":
        if (strategy.role) {
          locator = page.getByRole(strategy.role as any, { name: strategy.text });
        } else {
          locator = page.getByText(strategy.text);
        }
        break;

      case "containerText":
        // Try to find clickable element within container with this text
        locator = page.locator(`text=${strategy.text}`).locator("button, a, [role=button], [role=link]").first();
        break;

      case "text":
        locator = page.getByText(strategy.text, { exact: true });
        break;

      case "css":
        locator = page.locator(strategy.selector!);
        break;

      default:
        console.log(`[catalog-discovery:click] unknown strategy type: ${strategy.type}`);
        return false;
    }

    // Apply nth if specified
    if (strategy.nth !== undefined) {
      locator = locator.nth(strategy.nth);
    } else {
      locator = locator.first();
    }

    // Validate before clicking
    const count = await locator.count();
    if (count === 0) {
      console.log(`[catalog-discovery:click] skipped "${candidate.label}": locator count=0`);
      return false;
    }

    // Check if visible
    const isVisible = await locator.isVisible({ timeout: 1000 }).catch(() => false);
    if (!isVisible) {
      console.log(`[catalog-discovery:click] skipped "${candidate.label}": not visible`);
      return false;
    }

    // Attempt click
    await locator.click({ timeout: 5000 });
    console.log(`[catalog-discovery:click] clicked "${candidate.label}"`);
    return true;
  } catch (err) {
    console.log(`[catalog-discovery:click] failed "${candidate.label}": ${err}`);
    return false;
  }
}

/**
 * Classify if element is an action control or global navigation
 *
 * Action controls should NOT be explored as catalog branches.
 * Returns control type if detected, null if not a control.
 */
function classifyControlType(
  label: string
): { isControl: boolean; controlType: string; safeNavigation: boolean } | null {
  const normalized = label.toLowerCase().trim();

  // Global action controls (NOT safe to click during exploration)
  const sensitiveControls = [
    { pattern: /^finalizar\s+sesi[oó]n$/i, type: "finalizar_sesion", safe: false },
    { pattern: /^salir$/i, type: "salir", safe: false },
    { pattern: /^solicitar$/i, type: "solicitar", safe: false },
    { pattern: /^contratar$/i, type: "contratar", safe: false },
    { pattern: /^pagar$/i, type: "pagar", safe: false },
    { pattern: /^cancelar$/i, type: "cancelar", safe: false },
    { pattern: /^cerrar\s+sesi[oó]n$/i, type: "cerrar_sesion", safe: false },
    { pattern: /^eliminar$/i, type: "eliminar", safe: false },
  ];

  for (const control of sensitiveControls) {
    if (control.pattern.test(normalized)) {
      return {
        isControl: true,
        controlType: control.type,
        safeNavigation: control.safe,
      };
    }
  }

  // Safe navigation controls (OK to use for backtracking)
  const safeControls = [
    { pattern: /^volver$/i, type: "volver", safe: true },
    { pattern: /^regresar$/i, type: "regresar", safe: true },
    { pattern: /^volver\s+al\s+listado$/i, type: "volver_listado", safe: true },
    { pattern: /^atr[aá]s$/i, type: "atras", safe: true },
  ];

  for (const control of safeControls) {
    if (control.pattern.test(normalized)) {
      return {
        isControl: true,
        controlType: control.type,
        safeNavigation: control.safe,
      };
    }
  }

  return null;
}

/**
 * Extract all clickable elements from snapshot
 *
 * Returns elements that have real interactive evidence (buttons, links, clickable tags/roles).
 * Does NOT return containers with internal clickables - returns the clickables themselves.
 */
function extractClickableElements(snapshot: PageSnapshot): SnapshotElement[] {
  const clickableElements: SnapshotElement[] = [];

  for (const el of snapshot.elements) {
    const evidence = detectClickableEvidence(el);
    if (evidence.hasEvidence) {
      clickableElements.push(el);
    }
  }

  return clickableElements;
}

/**
 * Extract label from a clickable element
 *
 * Uses the element's own accessible name, text, or aria-label.
 * Does NOT use parent container headings or page-level titles.
 */
function extractLabelFromClickable(
  clickable: SnapshotElement,
  snapshot: PageSnapshot
): { label: string | null; source: string } {
  // Priority 1: Accessible name (most reliable)
  if (clickable.name && clickable.name.trim().length > 0) {
    return { label: clickable.name.trim(), source: "accessible_name" };
  }

  // Priority 2: aria-label
  const ariaLabel = (clickable as any).ariaLabel || (clickable as any)["aria-label"];
  if (ariaLabel && typeof ariaLabel === "string" && ariaLabel.trim().length > 0) {
    return { label: ariaLabel.trim(), source: "aria_label" };
  }

  // Priority 3: Element text content
  if (clickable.text && clickable.text.trim().length > 0) {
    return { label: clickable.text.trim(), source: "element_text" };
  }

  // Priority 4: Element label attribute
  if (clickable.label && clickable.label.trim().length > 0) {
    return { label: clickable.label.trim(), source: "element_label" };
  }

  // Priority 5: title attribute
  const title = (clickable as any).title;
  if (title && typeof title === "string" && title.trim().length > 0) {
    return { label: title.trim(), source: "title_attr" };
  }

  // No valid label found
  return { label: null, source: "none" };
}

/**
 * Detect catalog candidates (clickable items that could be categories, subcategories, or products)
 *
 * Iterates over clickable elements directly (not containers).
 * Uses label from the clickable element itself (not parent containers or headings).
 * Logs rejected candidates with reasons.
 */
async function detectCatalogCandidates(
  snapshot: PageSnapshot,
  context: { depth: number; hasMultipleItems: boolean }
): Promise<CatalogCandidate[]> {
  const candidates: CatalogCandidate[] = [];
  const seen = new Set<string>();
  const rejected: Array<{ label: string; reason: string; source?: string }> = [];

  // Extract clickable elements directly (not containers)
  const clickableElements = extractClickableElements(snapshot);

  console.log(`[catalog-discovery:debug] found ${clickableElements.length} clickable elements`);

  for (const clickable of clickableElements) {
    // Extract label from clickable element itself
    const { label, source } = extractLabelFromClickable(clickable, snapshot);

    if (!label) {
      rejected.push({
        label: clickable.text || clickable.name || "(no text)",
        reason: "no_clickable_label",
        source,
      });
      continue;
    }

    // Check if this is an action control
    const controlClassification = classifyControlType(label);
    if (controlClassification && !controlClassification.safeNavigation) {
      rejected.push({
        label,
        reason: `action_control_${controlClassification.controlType}`,
        source,
      });
      console.log(
        `[catalog-discovery:control] rejected action control "${label}" type=${controlClassification.controlType}`
      );
      continue;
    }

    // Validate label (pass true because element has clickable evidence)
    if (!isValidProductLabel(label, true)) {
      rejected.push({ label, reason: "invalid_product_label", source });
      continue;
    }

    const normalized = normalizeTarget(label);
    if (seen.has(normalized)) continue;

    seen.add(normalized);

    // Get evidence for logging
    const evidence = detectClickableEvidence(clickable);
    const type = classifyCandidate(clickable, context);
    const locatorStrategy = buildLocatorStrategy(clickable, label, false);

    candidates.push({
      label,
      normalizedLabel: normalized,
      type,
      locator: buildLocatorString(clickable),
      confidence: "high",
      locatorStrategy,
      clickableEvidence: evidence.evidence,
    });

    console.log(
      `[catalog-discovery:candidate] "${label}" type=${type} strategy=${locatorStrategy.type} ` +
        `role=${locatorStrategy.role || "none"} source=${source} ` +
        `tag=${clickable.tagName || "none"} clickableRole=${clickable.role || "none"}`
    );
  }

  // Log rejected candidates
  if (rejected.length > 0) {
    console.log(`[catalog-discovery:rejected] ${rejected.length} candidates rejected:`);
    for (const r of rejected.slice(0, 5)) {
      console.log(`  - "${r.label}" reason=${r.reason} source=${r.source || "unknown"}`);
    }
  }

  // Debug logging if no candidates
  if (candidates.length === 0) {
    console.log(`[catalog-discovery:debug] no clickable candidates found`);
    console.log(`[catalog-discovery:debug] snapshot elements=${snapshot.elements.length}`);
    console.log(`[catalog-discovery:debug] clickable elements found=${clickableElements.length}`);

    // Show sample of clickable elements for debugging
    const clickableSample = clickableElements.slice(0, 5).map((el) => ({
      role: el.role || "none",
      tag: el.tagName || "none",
      text: (el.text || "").substring(0, 30),
      name: (el.name || "").substring(0, 30),
    }));

    if (clickableSample.length > 0) {
      console.log(`[catalog-discovery:debug] clickableElements sample:`, JSON.stringify(clickableSample, null, 2));
    }

    const visibleTexts = snapshot.elements
      .map((el) => (el.text || el.label || "").trim())
      .filter((t) => t.length > 0)
      .slice(0, 10);
    console.log(`[catalog-discovery:debug] visible texts sample: ${visibleTexts.join(", ")}`);
  }

  return candidates;
}

/**
 * Build a Playwright locator from a candidate
 */
/**
 * Extract label from container element
 */
function extractLabelFromContainer(container: SnapshotElement, snapshot: PageSnapshot): string | null {
  const children = getContainerChildren(container, snapshot);

  // Try to find heading or prominent text
  for (const child of children) {
    const text = (child.text || child.label || child.name || "").trim();
    const tag = child.tagName?.toLowerCase();
    const role = child.role?.toLowerCase();

    if ((tag?.startsWith("h") || role === "heading") && text.length > 2) {
      return text;
    }

    if ((tag === "a" || child.type === "link") && text.length > 2) {
      return text;
    }
  }

  // Fallback to container text
  return (container.text || "").trim() || null;
}

/**
 * Infer page context type based on current snapshot, candidates, and navigation path
 *
 * Context types (multiproject):
 * - catalog_root: Entry/landing screen with main category navigation
 * - category_branch: Intermediate navigation screen with subcategories
 * - product_listing: Terminal listing of actual products (cards/table/grid)
 * - product_detail: Individual product detail page
 * - unknown: Cannot determine context
 */
function inferPageContext(
  snapshot: PageSnapshot,
  candidates: CatalogCandidate[],
  currentPath: string[],
  depth: number
): "catalog_root" | "category_branch" | "product_listing" | "product_detail" | "unknown" {
  // If depth=0 and we have multiple navigation candidates, it's catalog_root
  if (depth === 0 && candidates.filter((c) => c.type === "category" || c.type === "subcategory").length >= 2) {
    return "catalog_root";
  }

  // If we have category/subcategory candidates, it's a branch screen
  const navCandidatesCount = candidates.filter((c) => c.type === "category" || c.type === "subcategory").length;
  if (navCandidatesCount >= 2) {
    return "category_branch";
  }

  // If we have product candidates or are at deeper levels with items, likely product_listing
  const productCandidatesCount = candidates.filter((c) => c.type === "product").length;
  if (productCandidatesCount >= 2 || (depth >= 2 && snapshot.elements.length > 5)) {
    return "product_listing";
  }

  // If currentPath is deep and no clear navigation, might be terminal listing
  if (currentPath.length >= 2 && navCandidatesCount === 0 && snapshot.elements.length > 3) {
    return "product_listing";
  }

  return "unknown";
}

/**
 * Main catalog discovery orchestrator (MULTILEVEL VERSION)
 *
 * Discovers products from a catalog page with multilevel exploration.
 * Supports catalogs with categories/subcategories that must be explored to reach final products.
 * This is app-agnostic and works with any catalog structure.
 *
 * Fails safely: returns empty products array if navigation fails.
 */
export async function discoverProductCatalog(
  page: Page,
  options: ProductCatalogDiscoveryOptions
): Promise<ProductCatalogDiscoveryResult> {
  const {
    appSlug,
    routeProfile,
    catalogMode = "representative",
    maxProductsPerCategory = 2,
    maxDepth = parseInt(process.env.AI_CATALOG_DISCOVERY_MAX_DEPTH || "3", 10),
  } = options;

  console.log(`[catalog-discovery] starting discovery for ${appSlug} mode=${catalogMode} maxDepth=${maxDepth}`);

  // Build entry steps once for navigation and backtracking
  const entrySteps = routeProfile ? buildEntryStepsFromRouteProfile(routeProfile) : [];

  // Navigate to catalog section if route profile has entry steps
  if (entrySteps.length > 0) {
    const navigationSucceeded = await navigateToCatalogSection(page, entrySteps);

    if (!navigationSucceeded) {
      console.log(`[catalog-discovery] navigation failed - returning empty result`);
      return buildEmptyResult(appSlug, page.url());
    }
  }

  // Build initial path from route profile entry
  const initialPath = routeProfile?.entry?.map((e) => e.visibleLabel) || [];

  // Explore multilevel catalog
  let products: DiscoveredProduct[] = [];
  try {
    products = await exploreMultilevelCatalog(page, initialPath, 0, maxDepth, entrySteps, catalogMode);
  } catch (err) {
    console.log(`[catalog-discovery] exploration failed: ${err}`);
    return buildEmptyResult(appSlug, page.url());
  }

  console.log(`[catalog-discovery] exploration complete: discovered ${products.length} products`);

  // If no products found, return empty result
  if (products.length === 0) {
    console.log(`[catalog-discovery] no products discovered - returning empty result`);
    return buildEmptyResult(appSlug, page.url());
  }

  // Infer categories/subcategories from discovery paths
  for (const product of products) {
    if (product.discoveryPath && product.discoveryPath.length > 1) {
      const pathDepth = product.discoveryPath.length;
      if (pathDepth >= 2) product.category = product.discoveryPath[pathDepth - 2];
      if (pathDepth >= 3) product.subcategory = product.discoveryPath[pathDepth - 3];
    }
  }

  // Group by category
  const productGroups = groupProductsByCategory(products);

  // Select representative or all products
  const selectedProducts =
    catalogMode === "representative"
      ? selectRepresentativeProducts(productGroups, maxProductsPerCategory)
      : products;

  // Mark selected products as representative
  selectedProducts.forEach((p) => {
    p.isRepresentative = true;
  });

  // Extract unique categories
  const categories = Array.from(new Set(products.map((p) => p.category).filter((c): c is string => !!c)));

  console.log(
    `[catalog-discovery] discovered total=${products.length} categories=${categories.length} selected=${selectedProducts.length}`
  );

  return {
    appSlug,
    catalogUrl: page.url(),
    capturedAt: new Date().toISOString(),
    products,
    categories,
    totalProducts: products.length,
    representativeProducts: selectedProducts,
  };
}

/**
 * Build empty result for failed discovery
 */
function buildEmptyResult(appSlug: string, catalogUrl: string): ProductCatalogDiscoveryResult {
  return {
    appSlug,
    catalogUrl,
    capturedAt: new Date().toISOString(),
    products: [],
    categories: [],
    totalProducts: 0,
    representativeProducts: [],
  };
}

/**
 * Validate that the current screen is a catalog/product list
 *
 * Requirements:
 * - At least 2 valid product candidates (minimum for a list)
 * - Products have meaningful labels (not greetings/headings)
 * - Context indicates a list (multiple similar elements)
 */
/**
 * Build entry steps from route profile
 *
 * Combines entrySteps (with when="before_first_functional_step") + entry
 * to build the complete navigation flow to catalog.
 */
function buildEntryStepsFromRouteProfile(routeProfile: McpRouteProfile): EntryStepConfig[] {
  const steps: EntryStepConfig[] = [];

  // 1. Add entrySteps that should run before functional steps
  if (routeProfile.entrySteps && routeProfile.entrySteps.length > 0) {
    for (const entryStep of routeProfile.entrySteps) {
      if (entryStep.when === "before_first_functional_step") {
        steps.push({
          action: entryStep.action as "click",
          target: entryStep.target,
          description: `Entry step: ${entryStep.target}`,
        });
      }
    }
  }

  // 2. Add main entry navigation
  if (routeProfile.entry && routeProfile.entry.length > 0) {
    for (const entry of routeProfile.entry) {
      steps.push({
        action: "click",
        target: entry.visibleLabel,
        description: `Navigate to ${entry.businessLabel}`,
      });
    }
  }

  return steps;
}

/**
 * Navigate to catalog section using entry steps
 *
 * Returns true if all steps succeeded, false otherwise.
 * Fails safely on first navigation error.
 */
async function navigateToCatalogSection(page: Page, entrySteps: EntryStepConfig[]): Promise<boolean> {
  console.log(`[catalog-discovery] navigating using ${entrySteps.length} entry steps`);

  for (const step of entrySteps) {
    if (step.action === "click") {
      // Try multiple locator strategies
      const locators = [
        page.getByRole("button", { name: step.target }),
        page.getByRole("link", { name: step.target }),
        page.getByText(step.target, { exact: true }),
        page.getByText(step.target),
      ];

      let clicked = false;
      for (const locator of locators) {
        try {
          await locator.first().click({ timeout: 5000 });
          clicked = true;
          console.log(`[catalog-discovery] clicked "${step.target}"`);
          await waitForPageReady(page, { domContentLoadedTimeoutMs: 5000, stabilizationMs: 500 });
          break;
        } catch {
          // Try next locator
        }
      }

      if (!clicked) {
        console.log(`[catalog-discovery] error: could not click "${step.target}" - navigation failed`);
        return false;
      }
    }
  }

  return true;
}

/**
 * Check if element is a product container (card, list item, article)
 */
function isProductContainer(el: SnapshotElement): boolean {
  const tag = el.tagName?.toLowerCase();
  const role = el.role?.toLowerCase();
  const className = (el as any).className || "";

  if (tag === "article") return true;
  if (role === "listitem" || role === "list-item") return true;

  const containerPatterns = [
    "card",
    "list-item",
    "listitem",
    "product-item",
    "product-card",
    "item-card",
    "catalog-item",
    "product",
  ];

  if (typeof className === "string") {
    const normalizedClass = className.toLowerCase();
    for (const pattern of containerPatterns) {
      if (normalizedClass.includes(pattern)) return true;
    }
  }

  return false;
}

/**
 * Filter false positives: greetings, headings, page titles, non-product items
 *
 * Uses generic patterns (no app-specific hardcoding):
 * - Greetings: ¡Hola!, Hello, Welcome, Bienvenido
 * - Page titles: short single words or obvious headings (ONLY if not clickable)
 * - Overly generic: "Producto", "Item", "Card"
 * - Too short: less than 3 characters (unless numeric product codes)
 *
 * CRITICAL: If element has real clickable evidence, do NOT reject short labels.
 * Short clickable labels like "Tarjetas", "Cuentas", "Préstamos" are VALID categories.
 */
function isValidProductLabel(label: string, hasClickableEvidence: boolean): boolean {
  const trimmed = label.trim();

  // Too short
  if (trimmed.length < 3) {
    return false;
  }

  // Greetings pattern (multiproject)
  const greetingPatterns = [
    /^¡?Hola!?$/i,
    /^Hello!?$/i,
    /^Hi!?$/i,
    /^Welcome!?$/i,
    /^Bienvenid[oa]s?!?$/i,
    /^Greetings?!?$/i,
    /^Saludos?!?$/i,
  ];

  for (const pattern of greetingPatterns) {
    if (pattern.test(trimmed)) {
      console.log(`[catalog-discovery:filter] rejected greeting: "${trimmed}"`);
      return false;
    }
  }

  // Overly generic labels
  const genericPatterns = [
    /^Productos?$/i,
    /^Items?$/i,
    /^Cards?$/i,
    /^Opciones?$/i,
    /^Ver\s+m[áa]s$/i,
    /^M[áa]s\s+informaci[óo]n$/i,
  ];

  for (const pattern of genericPatterns) {
    if (pattern.test(trimmed)) {
      console.log(`[catalog-discovery:filter] rejected generic label: "${trimmed}"`);
      return false;
    }
  }

  // Page section headings (too short, too generic)
  // CRITICAL: Only reject if NOT clickable
  // Clickable short labels like "Tarjetas", "Cuentas" are valid
  if (!hasClickableEvidence && trimmed.split(/\s+/).length === 1 && trimmed.length < 10) {
    // Single word under 10 chars is likely a heading, not a product
    // Exception: if it contains numbers (e.g., "Cuenta123")
    if (!/\d/.test(trimmed)) {
      console.log(`[catalog-discovery:filter] rejected short non-clickable heading: "${trimmed}"`);
      return false;
    }
  }

  return true;
}

/**
 * Extract product data from a container element
 */
/**
 * Get children elements of a container
 */
function getContainerChildren(container: SnapshotElement, snapshot: PageSnapshot): SnapshotElement[] {
  const containerIndex = snapshot.elements.indexOf(container);
  if (containerIndex === -1) return [];

  const children: SnapshotElement[] = [];

  // Simple heuristic: elements that come after the container in DOM order
  // and before the next container are likely children
  let foundNextContainer = false;
  for (let i = containerIndex + 1; i < snapshot.elements.length; i++) {
    const el = snapshot.elements[i];
    if (isProductContainer(el)) {
      foundNextContainer = true;
      break;
    }
    children.push(el);
  }

  return children;
}

/**
 * Build a locator string for an element
 */
function buildLocatorString(el: SnapshotElement): string {
  const testId = (el as any).testId || (el as any)["data-testid"];
  if (testId) return `[data-testid="${testId}"]`;

  const domId = (el as any).domId || (el as any).id;
  if (domId) return `#${domId}`;

  if (el.role && el.text) {
    return `role=${el.role}[name="${el.text}"]`;
  }

  if (el.text) {
    return `text="${el.text}"`;
  }

  return "unknown";
}

/**
 * Build a group key for deduplication
 *
 * Removes special characters and normalizes to lowercase
 */
function buildGroupKey(label: string): string {
  return normalizeTarget(label).replace(/[^a-z0-9]/g, "_");
}

/**
 * Group products by category/variant
 *
 * Uses heuristics to detect category names in product labels
 */
function groupProductsByCategory(products: DiscoveredProduct[]): Map<string, DiscoveredProduct[]> {
  const groups = new Map<string, DiscoveredProduct[]>();

  // Category detection patterns (multiproject, no hardcoding)
  // Note: \w doesn't match accented characters, so we use broader patterns
  const categoryPatterns = [
    /^([^:]+?):/i, // "Cuentas: Personal en Pesos" → "Cuentas"
    /^([^\s-]+?(?:\s+[^\s-]+?)*?)\s+-\s+/i, // "Tarjetas - Crédito Classic" → "Tarjetas"
    /^([^\s]+(?:\s+[^\s]+)*?)\s+en\s+/i, // "Depósito en Pesos" → "Depósito" (handles accents)
    /^([^\s]+(?:\s+[^\s]+)*?)\s+de\s+/i, // "Cuenta de Ahorro" → "Cuenta"
  ];

  for (const product of products) {
    let category = "General";

    // Try to detect category from label
    for (const pattern of categoryPatterns) {
      const match = product.label.match(pattern);
      if (match && match[1]) {
        category = match[1].trim();
        break;
      }
    }

    // Store category in product
    product.category = category;

    // Detect variant (Pesos, Dólares, Euros, etc.)
    const variantPatterns = [
      /\b(pesos?|dolares?|d[óo]lares?|euros?)\b/i,
      /\b(usd|eur|mxn|ars|cop|clp)\b/i,
    ];
    for (const pattern of variantPatterns) {
      const match = product.label.match(pattern);
      if (match && match[1]) {
        product.variant = match[1].trim();
        break;
      }
    }

    // Add to group
    if (!groups.has(category)) {
      groups.set(category, []);
    }
    groups.get(category)!.push(product);
  }

  console.log(`[catalog-discovery] grouped into ${groups.size} categories`);
  for (const [category, items] of groups.entries()) {
    console.log(`[catalog-discovery] category="${category}" count=${items.length}`);
  }

  return groups;
}

/**
 * Select representative products (1-2 per category)
 */
function selectRepresentativeProducts(
  productGroups: Map<string, DiscoveredProduct[]>,
  maxPerCategory: number
): DiscoveredProduct[] {
  const selected: DiscoveredProduct[] = [];

  for (const [category, products] of productGroups.entries()) {
    // Sort by confidence (high first) and label length (shorter first for clarity)
    const sorted = products.sort((a, b) => {
      const confA = a.confidence === "high" ? 3 : a.confidence === "medium" ? 2 : 1;
      const confB = b.confidence === "high" ? 3 : b.confidence === "medium" ? 2 : 1;
      if (confA !== confB) return confB - confA;
      return a.label.length - b.label.length;
    });

    // Take first N products from this category
    const take = Math.min(maxPerCategory, sorted.length);
    selected.push(...sorted.slice(0, take));

    console.log(`[catalog-discovery] selected ${take}/${sorted.length} from category="${category}"`);
  }

  return selected;
}
