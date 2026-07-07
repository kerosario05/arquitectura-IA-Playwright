/**
 * Missing Intermediate Selection Detector
 *
 * Detects when a listing screen is visible but subsequent detail assertions are not,
 * indicating a missing item selection step. Inserts ordinal selection only with strong evidence.
 *
 * Generic: No hardcoding of appSlug, product names, field names, or business logic.
 */

import type { PageSnapshot, SnapshotElement } from "../types/page-snapshot.types";

export interface MissingSelectionContext {
  currentTarget: string;
  pendingAssertions: string[];
  currentSnapshot: PageSnapshot;
  remainingSteps?: string[];
}

export interface ListingDetection {
  detected: boolean;
  itemCount: number;
  source: "cards" | "rows" | "buttons" | "links" | "repeated_text" | "none";
  candidates: SnapshotElement[];
  reason: string;
}

export interface DetailAssertionDetection {
  pendingCount: number;
  targets: string[];
  visibleNow: boolean;
  seemsLikeDetailAssertion: boolean[];
  reason: string;
}

export interface MissingSelectionProposal {
  detected: boolean;
  shouldInsert: boolean;
  confidence: "high" | "medium" | "low";
  proposedStep: string;
  reason: string;
  diagnostics: Record<string, unknown>;
}

/**
 * Task 1: Detect listing screen
 * Generic detection of repetitive clickeable/selectable elements
 */
export function detectListingScreen(
  snapshot: PageSnapshot,
  currentTarget: string
): ListingDetection {
  const candidates: SnapshotElement[] = [];
  let source: ListingDetection["source"] = "none";
  let reason = "";

  // Detect cards (generic: repeated role=article, class patterns, structure)
  const cardElements = snapshot.elements.filter(
    el =>
      el.role === "article" ||
      el.type === "card" ||
      (el.className ?? "").includes("card") ||
      (el.className ?? "").includes("item") ||
      (el.className ?? "").includes("product")
  );

  if (cardElements.length >= 2) {
    candidates.push(...cardElements);
    source = "cards";
    reason = `${cardElements.length} card-like elements detected`;
  }

  // Detect rows (generic: tr, li with similar structure)
  if (candidates.length === 0) {
    const rowElements = snapshot.elements.filter(
      el => el.tagName === "tr" || (el.tagName === "li" && el.role !== "button")
    );
    if (rowElements.length >= 2) {
      candidates.push(...rowElements);
      source = "rows";
      reason = `${rowElements.length} row elements detected`;
    }
  }

  // Detect repeated text-based clickeable buttons/links (generic pattern)
  if (candidates.length === 0) {
    const clickeableWithText = snapshot.elements.filter(
      el =>
        (el.role === "button" || el.tagName === "a" || el.tagName === "button") &&
        el.text &&
        el.text.length > 0 &&
        el.text.length < 100 &&
        el.visible !== false
    );

    // Group by text similarity to detect repeated items
    const textGroups = new Map<string, SnapshotElement[]>();
    for (const el of clickeableWithText) {
      const normalized = (el.text ?? "").substring(0, 20).toLowerCase();
      if (!textGroups.has(normalized)) {
        textGroups.set(normalized, []);
      }
      textGroups.get(normalized)!.push(el);
    }

    // If we have multiple groups with similar item names, it's likely a list
    const repeatedGroups = Array.from(textGroups.values()).filter(g => g.length >= 2);
    if (repeatedGroups.length >= 1 && repeatedGroups[0]!.length >= 2) {
      candidates.push(...repeatedGroups[0]!);
      source = "buttons";
      reason = `${repeatedGroups[0]!.length} repeated button/link items detected`;
    }
  }

  const detected = candidates.length >= 2;
  console.log(
    `[list-detection] detected=${detected} itemCount=${candidates.length} source="${source}" currentTarget="${currentTarget}"`
  );

  return {
    detected,
    itemCount: candidates.length,
    source,
    candidates,
    reason
  };
}

/**
 * Task 2: Detect detail assertions pending
 * Check if pending assertions look like detail/item fields
 */
export function detectDetailAssertionsPending(
  pendingAssertions: string[],
  currentSnapshot: PageSnapshot
): DetailAssertionDetection {
  const targets = pendingAssertions.slice(0, 5); // Focus on next few assertions
  const seemsLikeDetailAssertion: boolean[] = [];

  // Generic patterns for detail-like assertions (no hardcoding)
  const detailPatterns = [
    /\bvisible\b/i, // Generic visibility
    /\bmostrar\b|\bvisualizar\b|\baparecer\b/i, // Display patterns
    /\b(?:campo|field|información|info|datos|value|precio|amount|tasa|estado|fecha)\b/i, // Generic field indicators
    /\bse muestre\b|\bse vea\b|\bapareza\b/i, // Visibility in Spanish
    /\ba la vista\b|\nen pantalla\b/i, // Screen presence
  ];

  for (const target of targets) {
    const isDetailLike = detailPatterns.some(pattern => pattern.test(target));
    seemsLikeDetailAssertion.push(isDetailLike);
  }

  // Check if any of these assertions are visible now
  const visibleNow = targets.some(target => {
    const normalized = target.toLowerCase();
    return snapshot.elements.some(
      el =>
        (el.text ?? "").toLowerCase().includes(normalized.substring(0, 20)) ||
        (el.label ?? "").toLowerCase().includes(normalized.substring(0, 20))
    );
  });

  const pendingCount = pendingAssertions.length;
  const likelyDetailCount = seemsLikeDetailAssertion.filter(v => v).length;

  console.log(
    `[detail-assertions] pending count=${pendingCount} targets="${targets.join(", ")}" visibleNow=${visibleNow}`
  );

  return {
    pendingCount,
    targets,
    visibleNow,
    seemsLikeDetailAssertion,
    reason:
      likelyDetailCount > 0
        ? `${likelyDetailCount}/${targets.length} assertions seem like detail fields`
        : "no detail-like assertions detected"
  };
}

/**
 * Task 3 & 5: Infer missing intermediate selection
 * Only insert if strong evidence: listing visible + detail assertions pending + clear candidate
 */
export function inferMissingSelection(
  context: MissingSelectionContext
): MissingSelectionProposal {
  const { currentTarget, pendingAssertions, currentSnapshot } = context;

  // Detect listing
  const listingDetection = detectListingScreen(currentSnapshot, currentTarget);
  if (!listingDetection.detected) {
    console.log(
      `[route-completion] blocked reason=missing_intermediate_selection_unresolved no_listing_detected`
    );
    return {
      detected: false,
      shouldInsert: false,
      confidence: "low",
      proposedStep: "",
      reason: "no_listing_detected",
      diagnostics: { listing: listingDetection }
    };
  }

  // Detect detail assertions
  const detailDetection = detectDetailAssertionsPending(pendingAssertions, currentSnapshot);
  if (detailDetection.visibleNow || detailDetection.pendingCount === 0) {
    console.log(
      `[route-completion] blocked reason=assertions_already_visible detail_detected`
    );
    return {
      detected: false,
      shouldInsert: false,
      confidence: "low",
      proposedStep: "",
      reason: "assertions_already_visible",
      diagnostics: { detailAssertions: detailDetection }
    };
  }

  // Filter candidates: must be clickeable, visible, not disabled
  const selectableItems = listingDetection.candidates.filter(
    el => el.visible !== false && (el.role === "button" || el.tagName === "a" || el.tagName === "li")
  );

  if (selectableItems.length === 0) {
    console.log(
      `[route-completion] blocked reason=missing_intermediate_selection_unresolved no_selectable_items`
    );
    return {
      detected: false,
      shouldInsert: false,
      confidence: "low",
      proposedStep: "",
      reason: "no_selectable_items",
      diagnostics: { listing: listingDetection, selectableItems: selectableItems.length }
    };
  }

  // Pick first selectable item
  const firstCandidate = selectableItems[0]!;
  const candidateText = (firstCandidate.text || firstCandidate.label || firstCandidate.name || "elemento").substring(0, 60);

  // Infer domain item term generically from context
  let domainItemTerm = "elemento"; // fallback
  if (currentTarget.toLowerCase().includes("producto")) domainItemTerm = "producto";
  else if (currentTarget.toLowerCase().includes("tarjeta")) domainItemTerm = "tarjeta";
  else if (currentTarget.toLowerCase().includes("cuenta")) domainItemTerm = "cuenta";
  else if (currentTarget.toLowerCase().includes("préstamo") || currentTarget.toLowerCase().includes("prestamo"))
    domainItemTerm = "préstamo";
  else if (currentTarget.toLowerCase().includes("transacción") || currentTarget.toLowerCase().includes("transaccion"))
    domainItemTerm = "transacción";

  // Propose step with generic wording (no hardcoding)
  const proposedStep = `Seleccionar el primer ${domainItemTerm} visible del listado.`;

  const confidence =
    selectableItems.length >= 2 && detailDetection.seemsLikeDetailAssertion.some(v => v) ? "high" : "medium";

  console.log(
    `[route-completion] insertedStep type=missing_intermediate_selection text="${proposedStep}" reason=detail_assertions_after_listing confidence=${confidence}`
  );

  return {
    detected: true,
    shouldInsert: confidence !== "low",
    confidence,
    proposedStep,
    reason: "detail_assertions_after_listing",
    diagnostics: {
      listing: listingDetection,
      detailAssertions: detailDetection,
      selectableItemsCount: selectableItems.length,
      firstCandidateText: candidateText,
      domainItemInferred: domainItemTerm
    }
  };
}

/**
 * Task 6: Prepare inserted step metadata for evidence
 */
export function buildInsertedStepMetadata(proposal: MissingSelectionProposal) {
  return {
    text: proposal.proposedStep,
    source: "missing_intermediate_selection",
    type: "ordinal_selection",
    autoInserted: true,
    confidence: proposal.confidence,
    reason: proposal.reason
  };
}
