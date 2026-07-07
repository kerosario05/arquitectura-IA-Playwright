import type { McpRouteProfile, TargetPathDefinition, JiraIssueSource } from "./scenario-types";
import { isCatalogListingIntent, type HuIntent } from "./hu-intent-classifier";

/**
 * Filter targetPaths to only those aligned with HU/issue scope.
 *
 * CRITICAL: Prevents deterministic seeds from expanding beyond HU scope.
 * Uses heuristic matching to align discovered products with HU intent.
 *
 * Heuristics:
 * - Match HU title/description/acceptance criteria against:
 *   - targetPath.target (product name)
 *   - targetPath.requiredIntermediates (navigation path)
 *   - targetPath.productMetadata.category/subcategory/variant
 * - Use routeProfile.domainTerms for category synonyms
 * - Use routeProfile.aliases for label normalization
 *
 * Multiproject-safe: No hardcoded categories/products.
 *
 * @param issueContext - HU/Jira issue context
 * @param targetPaths - All discovered targetPaths
 * @param routeProfile - Route profile with domain terms and aliases
 * @returns Filtered targetPaths aligned with HU scope
 */
export function filterTargetPathsByIssueScope(
  issueContext: JiraIssueSource | null,
  targetPaths: Record<string, TargetPathDefinition>,
  routeProfile: McpRouteProfile | null,
  huIntent?: HuIntent
): {
  alignedTargetPaths: Record<string, TargetPathDefinition>;
  diagnostics: {
    totalProducts: number;
    alignedProducts: number;
    filteredOutProducts: number;
    matchedKeywords: string[];
    warnings: string[];
  };
} {
  const diagnostics = {
    totalProducts: Object.keys(targetPaths).length,
    alignedProducts: 0,
    filteredOutProducts: 0,
    matchedKeywords: [] as string[],
    warnings: [] as string[],
  };

  // Guard: hu-scope-filter as a catalog product filter only applies to catalog_listing_flow.
  // For transactional_document_flow, private_navigation_flow, product_detail_flow, unknown_flow
  // the products mentioned in the HU are dataRequirements/options, not catalog targets.
  if (huIntent && !isCatalogListingIntent(huIntent)) {
    const issueKey = (issueContext as any)?.key ?? "unknown";
    console.log(`[hu-scope-filter] skipped reason=hu_intent_not_catalog_listing huIntent=${huIntent} issue=${issueKey}`);
    return { alignedTargetPaths: {}, diagnostics };
  }

  // If no issue context, return all (fallback to AI judgment)
  if (!issueContext) {
    diagnostics.warnings.push("No issue context - using all discovered products");
    diagnostics.alignedProducts = diagnostics.totalProducts;
    return { alignedTargetPaths: targetPaths, diagnostics };
  }

  // Build search corpus from HU
  const huCorpus = buildHuSearchCorpus(issueContext);

  // Extract keywords from HU corpus
  const huKeywords = extractKeywords(huCorpus);

  if (huKeywords.length === 0) {
    diagnostics.warnings.push("No keywords extracted from HU - using all discovered products");
    diagnostics.alignedProducts = diagnostics.totalProducts;
    return { alignedTargetPaths: targetPaths, diagnostics };
  }

  // Build domain terms and aliases for fuzzy matching
  const domainTerms = buildDomainTermsMap(routeProfile);
  const aliases = buildAliasesMap(routeProfile);

  // Extract unique categories from targetPaths
  const categories = new Set<string>();
  for (const tp of Object.values(targetPaths)) {
    if (tp.productMetadata?.category) {
      categories.add(tp.productMetadata.category);
    }
  }

  // Detect explicitly mentioned categories in HU
  // If HU mentions a category name directly, all products from that category should be aligned
  const explicitlyMentionedCategories = new Set<string>();

  for (const category of categories) {
    const normalizedCategory = category.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

    // Check if HU corpus mentions this category (substring match)
    if (huCorpus.includes(normalizedCategory)) {
      explicitlyMentionedCategories.add(category);
      console.log(`[hu-scope-filter] explicitly mentioned category detected: "${category}"`);
    }
  }

  if (explicitlyMentionedCategories.size > 0) {
    console.log(
      `[hu-scope-filter] HU mentions ${explicitlyMentionedCategories.size} categories explicitly: ` +
        Array.from(explicitlyMentionedCategories).join(", ")
    );
  }

  // Filter targetPaths by HU alignment
  const alignedTargetPaths: Record<string, TargetPathDefinition> = {};

  for (const [target, tp] of Object.entries(targetPaths)) {
    // Check if product belongs to explicitly mentioned category
    const productCategory = tp.productMetadata?.category;
    const isExplicitlyMentioned = productCategory && explicitlyMentionedCategories.has(productCategory);

    if (isExplicitlyMentioned) {
      // Auto-align products from explicitly mentioned categories
      alignedTargetPaths[target] = tp;
      diagnostics.alignedProducts++;

      // Add category as matched keyword for diagnostics
      const normalizedCategory = productCategory.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      if (!diagnostics.matchedKeywords.includes(normalizedCategory)) {
        diagnostics.matchedKeywords.push(normalizedCategory);
      }

      console.log(`[hu-scope-filter] auto-aligned "${target}" (category: ${productCategory} explicitly mentioned)`);
      continue;
    }

    // Otherwise, use standard alignment score
    const alignmentScore = calculateAlignmentScore(target, tp, huKeywords, domainTerms, aliases);

    if (alignmentScore.isAligned) {
      alignedTargetPaths[target] = tp;
      diagnostics.alignedProducts++;
      diagnostics.matchedKeywords.push(...alignmentScore.matchedKeywords);
    } else {
      diagnostics.filteredOutProducts++;
      console.log(
        `[hu-scope-filter] filtered out "${target}" - score=${alignmentScore.score} threshold=0.3`
      );
    }
  }

  // Deduplicate matched keywords
  diagnostics.matchedKeywords = Array.from(new Set(diagnostics.matchedKeywords));

  console.log(
    `[hu-scope-filter] total=${diagnostics.totalProducts} aligned=${diagnostics.alignedProducts} ` +
      `filteredOut=${diagnostics.filteredOutProducts} keywords=[${diagnostics.matchedKeywords.join(", ")}]`
  );

  // Warning if no products aligned - fallback to all products
  if (diagnostics.alignedProducts === 0) {
    diagnostics.warnings.push(
      `No products aligned with HU scope - HU may be too generic or products not related. Falling back to all products.`
    );
    diagnostics.alignedProducts = diagnostics.totalProducts;
    diagnostics.filteredOutProducts = 0;
    return { alignedTargetPaths: targetPaths, diagnostics };
  }

  return { alignedTargetPaths, diagnostics };
}

/**
 * Build search corpus from HU/issue
 */
function buildHuSearchCorpus(issue: JiraIssueSource): string {
  const parts: string[] = [];

  if (issue.summary) parts.push(issue.summary);
  if (issue.description) parts.push(issue.description);
  if (issue.acceptanceCriteria) parts.push(issue.acceptanceCriteria);
  if (issue.labels && issue.labels.length > 0) parts.push(issue.labels.join(" "));
  if (issue.components && issue.components.length > 0) parts.push(issue.components.join(" "));

  return parts
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // Remove diacritics for consistent matching
}

/**
 * Extract keywords from HU corpus
 *
 * Filters out stop words and short tokens.
 */
function extractKeywords(corpus: string): string[] {
  const stopWords = new Set([
    "el",
    "la",
    "los",
    "las",
    "de",
    "del",
    "en",
    "un",
    "una",
    "para",
    "por",
    "con",
    "que",
    "se",
    "como",
    "usuario",
    "debe",
    "poder",
    "validar",
    "mostrar",
    "visualizar",
    "acceder",
    "ver",
    "quiero",
    "quiere",
    "the",
    "a",
    "an",
    "and",
    "or",
    "but",
    "in",
    "on",
    "at",
    "to",
    "for",
    "of",
    "with",
    "by",
    "from",
    "as",
    "is",
    "are",
    "was",
    "were",
    "be",
    "been",
    "being",
    "have",
    "has",
    "had",
    "do",
    "does",
    "did",
    "will",
    "would",
    "should",
    "could",
    "may",
    "might",
    "must",
    "can",
    "user",
    "users",
    "want",
    "wants",
    "see",
    "view",
    "display",
    "show",
    "all",
    "options",
  ]);

  // Tokenize and normalize
  const tokens = corpus
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Remove diacritics
    .split(/\W+/)
    .filter((t) => t.length > 2) // Min length 3
    .filter((t) => !stopWords.has(t)); // Remove stop words

  return Array.from(new Set(tokens)); // Deduplicate
}

/**
 * Build domain terms map for fuzzy matching
 */
function buildDomainTermsMap(routeProfile: McpRouteProfile | null): Map<string, string[]> {
  const map = new Map<string, string[]>();

  if (!routeProfile?.domainTerms) return map;

  for (const [key, value] of Object.entries(routeProfile.domainTerms)) {
    const normalized = key.toLowerCase();
    const synonyms = Array.isArray(value) ? value : [value];
    map.set(normalized, synonyms.map((s) => s.toLowerCase()));
  }

  return map;
}

/**
 * Build aliases map for label normalization
 */
function buildAliasesMap(routeProfile: McpRouteProfile | null): Map<string, string[]> {
  const map = new Map<string, string[]>();

  if (!routeProfile?.aliases) return map;

  for (const [key, value] of Object.entries(routeProfile.aliases)) {
    const normalized = key.toLowerCase();
    const aliasList = Array.isArray(value) ? value : [value];
    map.set(normalized, aliasList.map((a) => a.toLowerCase()));
  }

  return map;
}

/**
 * Calculate alignment score between targetPath and HU keywords
 *
 * Returns score 0-1 and whether it passes threshold (0.3).
 */
function calculateAlignmentScore(
  target: string,
  tp: TargetPathDefinition,
  huKeywords: string[],
  domainTerms: Map<string, string[]>,
  aliases: Map<string, string[]>
): {
  score: number;
  isAligned: boolean;
  matchedKeywords: string[];
} {
  const matchedKeywords: string[] = [];
  let matchCount = 0;

  // Normalize target and metadata for matching
  const normalizedTarget = target.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const normalizedIntermediates = (tp.requiredIntermediates || [])
    .map((i) => i.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""))
    .join(" ");
  const normalizedCategory = (tp.productMetadata?.category || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const normalizedSubcategory = (tp.productMetadata?.subcategory || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  const normalizedVariant = (tp.productMetadata?.variant || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  // Build searchable text from targetPath
  const searchableText = [
    normalizedTarget,
    normalizedIntermediates,
    normalizedCategory,
    normalizedSubcategory,
    normalizedVariant,
  ].join(" ");

  // Check each HU keyword
  for (const keyword of huKeywords) {
    // Direct match
    if (searchableText.includes(keyword)) {
      matchCount++;
      matchedKeywords.push(keyword);
      continue;
    }

    // Domain terms match (bidirectional: keyword→synonym or synonym→keyword)
    let synonymMatch = false;
    for (const [term, synonyms] of domainTerms.entries()) {
      // Case 1: keyword is the canonical term, check if any synonym is in searchableText
      if (keyword === term && synonyms.some((s) => searchableText.includes(s))) {
        matchCount++;
        matchedKeywords.push(keyword);
        synonymMatch = true;
        break;
      }
      // Case 2: keyword is a synonym, check if canonical term is in searchableText
      if (synonyms.includes(keyword) && searchableText.includes(term)) {
        matchCount++;
        matchedKeywords.push(keyword);
        synonymMatch = true;
        break;
      }
      // Case 3: keyword matches term and term is in searchableText
      if (keyword === term && searchableText.includes(term)) {
        matchCount++;
        matchedKeywords.push(keyword);
        synonymMatch = true;
        break;
      }
    }
    if (synonymMatch) continue;

    // Alias match
    for (const [canonical, aliasList] of aliases.entries()) {
      if (keyword === canonical || aliasList.includes(keyword)) {
        if (searchableText.includes(canonical) || aliasList.some((a) => searchableText.includes(a))) {
          matchCount++;
          matchedKeywords.push(keyword);
          break;
        }
      }
    }
  }

  // Calculate score (percentage of HU keywords matched)
  const score = huKeywords.length > 0 ? matchCount / huKeywords.length : 0;

  // Threshold: require at least 30% keyword match OR match in category/intermediates
  const categoryMatch = huKeywords.some((kw) => normalizedCategory.includes(kw));
  const intermediatesMatch = huKeywords.some((kw) => normalizedIntermediates.includes(kw));

  const isAligned = score >= 0.3 || categoryMatch || intermediatesMatch;

  return { score, isAligned, matchedKeywords };
}
