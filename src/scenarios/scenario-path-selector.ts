import type { JiraIssueSource, McpRouteProfile, TargetPathDefinition } from "./scenario-types";

export interface ScenarioPathSelection {
  selectedIntent: string;
  selectedProductCategory: string;
  accessMode: "public" | "private";
  selectedPath: {
    targetPathKey: string;
    target: string;
    requiredIntermediates: string[];
  } | null;
  selectedRouteCandidates: Array<{
    targetPathKey: string;
    target: string;
    requiredIntermediates: string[];
    matchScore: number;
  }>;
  selectedLabels: string[];
  selectedActions: string[];
  rejectedPaths: Array<{
    targetPathKey: string;
    target: string;
    reason:
      | "access_mode_mismatch"
      | "category_blocked"
      | "explicit_term_blocked"
      | "public_root_for_private_hu"
      | "no_match";
  }>;
  gaps: string[];
  confidence: "high" | "medium" | "low";
  diagnostics: {
    totalTargetPaths: number;
    evaluatedPaths: number;
    selectedCount: number;
    rejectedCount: number;
    matchedKeywords: string[];
  };
}

export interface SelectPathInput {
  issue: JiraIssueSource;
  huEvidence: {
    businessIntent: string;
    productCategory: string;
    accessMode: "public" | "private";
    allowedTerms: string[];
    blockedTerms: string[];
  };
  appSlug: string;
  routeProfile?: McpRouteProfile | null;
  targetPaths?: Record<string, TargetPathDefinition>;
}

/**
 * Detect action keywords from HU description.
 * Matches HU-driven actions without modifying scenario generation.
 */
function detectActionsFromHU(issueDescription: string): string[] {
  const actions: string[] = [];
  const description = (issueDescription || "").toLowerCase();

  const actionPatterns: Record<string, RegExp> = {
    "Enviar vía correo": /enviar.*correo|envío.*email|email.*envío/i,
    "Imprimir": /imprimir|print|impresión/i,
    "Volver al listado": /volver.*listado|regresa.*listado|back.*list|listado/i,
    "Volver al menú": /volver.*menú|regresa.*menú|back.*menu/i,
    "Finalizar sesión": /finalizar.*sesión|cerrar.*sesión|logout|log out/i,
    "Reintentar": /reintentar|retry|intentar de nuevo/i,
  };

  for (const [action, pattern] of Object.entries(actionPatterns)) {
    if (pattern.test(description)) {
      actions.push(action);
    }
  }

  return actions;
}

/**
 * Extract keywords from HU title and description for path matching.
 */
function extractKeywordsFromHU(issue: JiraIssueSource): string[] {
  const text = `${issue.summary || ""} ${issue.description || ""}`.toLowerCase();
  const keywords = text
    .split(/[\s,;.()]+/)
    .filter((w) => w.length > 2 && !/^(de|la|el|un|una|que|para|por|con|del|los|las)$/.test(w));
  return [...new Set(keywords)];
}

/**
 * Calculate match score between targetPath and HU evidence.
 * Higher score = better match.
 */
function calculatePathMatchScore(
  targetPath: TargetPathDefinition,
  huEvidence: SelectPathInput["huEvidence"],
  huKeywords: string[]
): number {
  let score = 0;

  // Match product label with HU keywords
  const targetLabel = (targetPath.target || "").toLowerCase();
  const intermediates = (targetPath.requiredIntermediates || [])
    .map((i) => i.toLowerCase())
    .join(" ");
  const fullPath = `${targetLabel} ${intermediates}`.toLowerCase();

  for (const keyword of huKeywords) {
    if (targetLabel.includes(keyword) || fullPath.includes(keyword)) {
      score += 2;
    }
  }

  // Match product metadata category with HU product category
  if (targetPath.productMetadata?.category) {
    const categoryNorm = targetPath.productMetadata.category.toLowerCase();
    const productCategoryNorm = huEvidence.productCategory.toLowerCase();
    if (categoryNorm.includes(productCategoryNorm) || productCategoryNorm.includes(categoryNorm)) {
      score += 5;
    }
  }

  // Prefer paths that don't start with public catalog entry for private HU
  if (huEvidence.accessMode === "private") {
    const firstIntermediate = (targetPath.requiredIntermediates?.[0] || "").toLowerCase();
    if (
      !firstIntermediate.includes("información de productos") &&
      !firstIntermediate.includes("catálogo") &&
      !firstIntermediate.includes("productos")
    ) {
      score += 3;
    }
  }

  return score;
}

/**
 * Determine rejection reason for a path.
 */
function getRejectionReason(
  targetPath: TargetPathDefinition,
  huEvidence: SelectPathInput["huEvidence"]
): ScenarioPathSelection["rejectedPaths"][0]["reason"] | null {
  const firstIntermediate = (targetPath.requiredIntermediates?.[0] || "").toLowerCase();

  // Public root for private HU
  if (
    huEvidence.accessMode === "private" &&
    (firstIntermediate.includes("información de productos") ||
      firstIntermediate.includes("catálogo") ||
      firstIntermediate.includes("productos"))
  ) {
    return "public_root_for_private_hu";
  }

  // Category blocked by HU
  if (targetPath.productMetadata?.category) {
    const categoryNorm = targetPath.productMetadata.category.toLowerCase();
    for (const blocked of huEvidence.blockedTerms) {
      if (categoryNorm.includes(blocked.toLowerCase())) {
        return "category_blocked";
      }
    }
  }

  // Product explicitly blocked
  const targetLabel = (targetPath.target || "").toLowerCase();
  for (const blocked of huEvidence.blockedTerms) {
    if (targetLabel.includes(blocked.toLowerCase())) {
      return "explicit_term_blocked";
    }
  }

  return null;
}

/**
 * Build synthetic path from HU evidence when no private routes are available.
 * Creates a fallback path based on intent + productCategory mapping.
 */
function buildSyntheticPathFromHuEvidence(
  issue: JiraIssueSource,
  huEvidence: SelectPathInput["huEvidence"]
): { targetPathKey: string; target: string; requiredIntermediates: string[] } | null {
  // Only build synthetic paths for private HU
  if (huEvidence.accessMode !== "private") {
    return null;
  }

  // Map intent + productCategory combinations to synthetic paths
  const syntheticPathMap: Record<
    string,
    { target: string; intermediates: string[] }
  > = {
    // balance_inquiry + term_deposit
    "balance_inquiry|term_deposit": {
      target: "Depósitos a Plazo",
      intermediates: ["Consulta de balance", "Depósitos a Plazo"],
    },
    // balance_inquiry + credit_card
    "balance_inquiry|credit_card": {
      target: "Tarjeta de Crédito",
      intermediates: ["Consulta de balance", "Tarjeta de Crédito"],
    },
    // balance_inquiry + cash_account
    "balance_inquiry|cash_account": {
      target: "Cuentas de Efectivo",
      intermediates: ["Consulta de balance", "Cuentas de Efectivo"],
    },
    // balance_inquiry + loan
    "balance_inquiry|loan": {
      target: "Préstamos",
      intermediates: ["Consulta de balance", "Préstamos"],
    },
    // account_statement + term_deposit
    "account_statement|term_deposit": {
      target: "Depósitos a Plazo",
      intermediates: ["Estado de Cuenta", "Depósitos a Plazo"],
    },
    // account_statement + credit_card
    "account_statement|credit_card": {
      target: "Tarjeta de Crédito",
      intermediates: ["Estado de Cuenta", "Tarjeta de Crédito"],
    },
    // product_payment + any
    "product_payment|term_deposit": {
      target: "Depósitos a Plazo",
      intermediates: ["Pago de Servicios", "Depósitos a Plazo"],
    },
  };

  const key = `${huEvidence.businessIntent}|${huEvidence.productCategory}`;
  const mapping = syntheticPathMap[key];

  if (!mapping) {
    return null;
  }

  return {
    targetPathKey: `synthetic_${huEvidence.productCategory}_${huEvidence.businessIntent}`,
    target: mapping.target,
    requiredIntermediates: mapping.intermediates,
  };
}

/**
 * Select scenario path from scanned catalog based on HU evidence.
 * Operates in observation mode: logs results without modifying generation.
 */
export function selectScenarioPathFromScannedCatalog(
  input: SelectPathInput
): ScenarioPathSelection {
  const { issue, huEvidence, appSlug, targetPaths = {} } = input;

  const diagnostics = {
    totalTargetPaths: Object.keys(targetPaths).length,
    evaluatedPaths: 0,
    selectedCount: 0,
    rejectedCount: 0,
    matchedKeywords: [] as string[],
  };

  const huKeywords = extractKeywordsFromHU(issue);
  const actions = detectActionsFromHU(issue.description || "");
  const selectedCandidates: ScenarioPathSelection["selectedRouteCandidates"] = [];
  const rejectedPaths: ScenarioPathSelection["rejectedPaths"] = [];
  const gaps: string[] = [];

  // Evaluate each target path
  for (const [key, targetPath] of Object.entries(targetPaths)) {
    diagnostics.evaluatedPaths++;

    const rejectionReason = getRejectionReason(targetPath, huEvidence);

    if (rejectionReason) {
      rejectedPaths.push({
        targetPathKey: key,
        target: targetPath.target || "unknown",
        reason: rejectionReason,
      });
      diagnostics.rejectedCount++;
      continue;
    }

    const matchScore = calculatePathMatchScore(targetPath, huEvidence, huKeywords);

    if (matchScore > 0) {
      selectedCandidates.push({
        targetPathKey: key,
        target: targetPath.target || "unknown",
        requiredIntermediates: targetPath.requiredIntermediates || [],
        matchScore,
      });
      diagnostics.selectedCount++;
    }
  }

  // Sort candidates by match score (descending)
  selectedCandidates.sort((a, b) => b.matchScore - a.matchScore);

  // Select best path or highest scorer
  let selectedPath =
    selectedCandidates.length > 0
      ? {
          targetPathKey: selectedCandidates[0].targetPathKey,
          target: selectedCandidates[0].target,
          requiredIntermediates: selectedCandidates[0].requiredIntermediates,
        }
      : null;

  // NEW: Build synthetic path for private HU without matched scanned path
  let syntheticPathBuilt = false;
  if (selectedPath === null && huEvidence.accessMode === "private") {
    const syntheticPath = buildSyntheticPathFromHuEvidence(issue, huEvidence);
    if (syntheticPath) {
      selectedPath = syntheticPath;
      syntheticPathBuilt = true;
      console.log(
        `[path-selector] syntheticPathBuilt=true issue=${issue.key} ` +
        `intent=${huEvidence.businessIntent} product=${huEvidence.productCategory} ` +
        `source=hu_evidence_synthetic_path`
      );
    }
  }

  // Determine confidence
  let confidence: ScenarioPathSelection["confidence"] = "low";
  if (selectedCandidates.length > 0) {
    if (selectedCandidates[0].matchScore >= 7) {
      confidence = "high";
    } else if (selectedCandidates[0].matchScore >= 4) {
      confidence = "medium";
    }
  } else if (syntheticPathBuilt) {
    confidence = "medium"; // Synthetic paths have medium confidence
  }

  // Build gaps
  if (selectedCandidates.length === 0 && diagnostics.totalTargetPaths === 0) {
    gaps.push("No target paths available for matching");
  } else if (selectedCandidates.length === 0) {
    gaps.push(`No matching paths found for product category: ${huEvidence.productCategory}`);
  }

  if (rejectedPaths.length > 0 && selectedPath === null) {
    gaps.push(
      `All ${rejectedPaths.length} evaluated paths were rejected: ${rejectedPaths
        .map((p) => p.reason)
        .join(", ")}`
    );
  }

  // Extract matched keywords (those that contributed to score)
  diagnostics.matchedKeywords = huKeywords.filter((kw) =>
    selectedCandidates.some(
      (c) => c.target.toLowerCase().includes(kw) || c.requiredIntermediates.some((i) => i.toLowerCase().includes(kw))
    )
  );

  const selection: ScenarioPathSelection = {
    selectedIntent: huEvidence.businessIntent,
    selectedProductCategory: huEvidence.productCategory,
    accessMode: huEvidence.accessMode,
    selectedPath,
    selectedRouteCandidates: selectedCandidates,
    selectedLabels: selectedPath ? selectedPath.requiredIntermediates : [],
    selectedActions: actions,
    rejectedPaths,
    gaps,
    confidence,
    diagnostics,
  };

  // Observation-mode logging (no side effects)
  console.log(
    `[path-selector] issue=${issue.key} intent=${huEvidence.businessIntent} ` +
      `product=${huEvidence.productCategory} access=${huEvidence.accessMode} confidence=${confidence}`
  );

  if (selectedPath) {
    const pathSource = syntheticPathBuilt ? "synthetic" : "scanned";
    console.log(
      `[path-selector] selectedPath=${selectedPath.targetPathKey} target="${selectedPath.target}" ` +
      `source=${pathSource}`
    );
    console.log(
      `[path-selector] selectedLabels=${selectedPath.requiredIntermediates.length} ` +
        `labels="${selectedPath.requiredIntermediates.join(" → ")}"`
    );
  } else {
    console.log(`[path-selector] selectedPath=none`);
  }

  console.log(
    `[path-selector] selectedActions=${actions.length} rejected=${rejectedPaths.length} ` +
      `candidates=${selectedCandidates.length}/${diagnostics.evaluatedPaths}`
  );

  for (const rejected of rejectedPaths) {
    console.log(`[path-selector] rejected path="${rejected.target}" reason=${rejected.reason}`);
  }

  if (gaps.length > 0) {
    console.log(`[path-selector] gaps=${gaps.join("; ")}`);
  }

  return selection;
}
