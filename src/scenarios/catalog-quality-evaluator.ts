import type { McpRouteProfile, TargetPathDefinition, JiraIssueSource } from "./scenario-types";

export type CatalogQualityStatus = "valid" | "stale" | "missing" | "incomplete" | "refreshed" | "refresh_failed";

export type CatalogRefreshReason =
  | "no_catalog"
  | "empty_target_paths"
  | "stale"
  | "missing_product_metadata"
  | "missing_clickable_to_detail"
  | "missing_detail_sections"
  | "insufficient_for_issue_scope"
  | "exhaustive_required";

export type CatalogQualityEvaluation = {
  status: CatalogQualityStatus;
  needsRefresh: boolean;
  reasons: CatalogRefreshReason[];
  incompleteTargets: Array<{
    target: string;
    reasons: string[];
  }>;
  targetCount: number;
  alignedTargetCount?: number;
};

export type CatalogRefreshOptions = {
  appSlug: string;
  routeProfile: McpRouteProfile | null;
  coverageMode: "representative" | "exhaustive";
  issueContext?: JiraIssueSource;
  catalogTTLHours?: number; // Default 24h
};

/**
 * Evaluate catalog quality and determine if refresh is needed
 *
 * Checks:
 * - Catalog exists
 * - targetPaths not empty
 * - Not stale (TTL)
 * - Critical metadata present (productMetadata, clickableToDetail, etc.)
 * - Sufficient for issue scope
 */
export function evaluateCatalogQuality(
  routeProfile: McpRouteProfile | null,
  options: CatalogRefreshOptions
): CatalogQualityEvaluation {
  const reasons: CatalogRefreshReason[] = [];
  const incompleteTargets: Array<{ target: string; reasons: string[] }> = [];

  // 1. No catalog or no routeProfile
  if (!routeProfile) {
    return {
      status: "missing",
      needsRefresh: true,
      reasons: ["no_catalog"],
      incompleteTargets: [],
      targetCount: 0,
    };
  }

  // 2. Empty targetPaths
  if (!routeProfile.targetPaths || Object.keys(routeProfile.targetPaths).length === 0) {
    return {
      status: "missing",
      needsRefresh: true,
      reasons: ["empty_target_paths"],
      incompleteTargets: [],
      targetCount: 0,
    };
  }

  const targetPaths = routeProfile.targetPaths;
  const targetCount = Object.keys(targetPaths).length;

  // 3. Check staleness (if catalog has discoveryTimestamp)
  const ttlHours = options.catalogTTLHours ?? 24;
  const ttlMs = ttlHours * 60 * 60 * 1000;

  // Check first product's discoveredAt timestamp
  const firstProduct = Object.values(targetPaths)[0];
  if (firstProduct?.productMetadata?.discoveredAt) {
    const discoveredAt = new Date(firstProduct.productMetadata.discoveredAt).getTime();
    const now = Date.now();
    if (now - discoveredAt > ttlMs) {
      reasons.push("stale");
    }
  }

  // 4. Check metadata completeness for each product
  let missingMetadataCount = 0;
  let missingClickableToDetailCount = 0;
  let missingDetailSectionsCount = 0;

  for (const [target, tp] of Object.entries(targetPaths)) {
    const targetReasons: string[] = [];

    // Check productMetadata exists
    if (!tp.productMetadata) {
      targetReasons.push("missing_product_metadata");
      missingMetadataCount++;
    } else {
      // Check presentationType
      if (!tp.productMetadata.presentationType) {
        targetReasons.push("missing_presentation_type");
      }

      // Check clickableToDetail for product_card
      if (
        tp.productMetadata.presentationType === "product_card" &&
        tp.productMetadata.clickableToDetail === undefined
      ) {
        targetReasons.push("missing_clickable_to_detail");
        missingClickableToDetailCount++;
      }

      // Check detailSections for detail types
      const isDetailType =
        tp.productMetadata.presentationType === "detail_page" ||
        (tp.productMetadata.presentationType === "product_card" && tp.productMetadata.clickableToDetail === true);

      if (isDetailType && (!tp.productMetadata.detailSections || tp.productMetadata.detailSections.length === 0)) {
        targetReasons.push("missing_detail_sections");
        missingDetailSectionsCount++;
      }

      // Check actionButtons for detail types
      if (isDetailType && (!tp.productMetadata.actionButtons || tp.productMetadata.actionButtons.length === 0)) {
        targetReasons.push("missing_action_buttons");
      }

      // Check validationStatus
      if (!tp.productMetadata.validationStatus) {
        targetReasons.push("missing_validation_status");
      }
    }

    // Check requiredIntermediates
    if (!tp.requiredIntermediates || tp.requiredIntermediates.length === 0) {
      targetReasons.push("missing_required_intermediates");
    }

    if (targetReasons.length > 0) {
      incompleteTargets.push({ target, reasons: targetReasons });
    }
  }

  // Aggregate reasons
  if (missingMetadataCount > 0) {
    reasons.push("missing_product_metadata");
  }
  if (missingClickableToDetailCount > 0) {
    reasons.push("missing_clickable_to_detail");
  }
  if (missingDetailSectionsCount > 0) {
    reasons.push("missing_detail_sections");
  }

  // 5. Check if issue scope is products/catalog and catalog lacks detail signals
  if (options.issueContext) {
    const huText = (
      options.issueContext.summary +
      " " +
      options.issueContext.description +
      " " +
      (options.issueContext.acceptanceCriteria || "")
    ).toLowerCase();

    const mentionsProducts =
      huText.includes("producto") ||
      huText.includes("products") ||
      huText.includes("catálogo") ||
      huText.includes("catalog") ||
      huText.includes("detalle") ||
      huText.includes("detail") ||
      huText.includes("información") ||
      huText.includes("information");

    if (mentionsProducts && (missingDetailSectionsCount > targetCount * 0.5 || missingMetadataCount > 0)) {
      reasons.push("insufficient_for_issue_scope");
    }
  }

  // 6. Check if exhaustive mode required but catalog not exhaustive
  if (options.coverageMode === "exhaustive") {
    // If representative products selected, but exhaustive mode requested
    const hasRepresentativeFlag = Object.values(targetPaths).some(
      (tp) => tp.productMetadata?.isRepresentative === true
    );
    if (hasRepresentativeFlag) {
      reasons.push("exhaustive_required");
    }
  }

  // Determine status
  let status: CatalogQualityStatus = "valid";
  const needsRefresh = reasons.length > 0 || incompleteTargets.length > targetCount * 0.3; // >30% incomplete

  if (needsRefresh) {
    if (reasons.includes("stale")) {
      status = "stale";
    } else if (incompleteTargets.length > 0) {
      status = "incomplete";
    }
  }

  return {
    status,
    needsRefresh,
    reasons,
    incompleteTargets,
    targetCount,
  };
}
