import type { McpScenario, McpRouteProfile, TargetPathDefinition, JiraIssueSource } from "./scenario-types";
import { filterTargetPathsByIssueScope } from "./scenario-hu-scope-filter";
import { normalizeTarget } from "./target-normalization";
import { isCatalogListingIntent, type HuIntent } from "./hu-intent-classifier";

/**
 * Normalize a label for deduplication
 * Removes accents, converts to lowercase, normalizes whitespace
 */
function normalizeLabel(label: string): string {
  return normalizeTarget(label);
}

/**
 * Deduplicate navigation steps by normalized label
 * Preserves order and keeps first occurrence
 */
function deduplicateNavigationSteps(steps: string[]): string[] {
  const seen = new Set<string>();
  const deduplicated: string[] = [];

  for (const step of steps) {
    // Extract label from step (format: "N. Clic en \"Label\".")
    const match = step.match(/Clic en [""]([^""]+)[""]/);
    if (!match) {
      deduplicated.push(step);
      continue;
    }

    const label = match[1];
    const normalized = normalizeLabel(label);

    if (!seen.has(normalized)) {
      seen.add(normalized);
      deduplicated.push(step);
    } else {
      console.log(`[catalog-seeds:dedup] skipping duplicate step: "${label}" (normalized: "${normalized}")`);
    }
  }

  // Renumber steps sequentially
  return deduplicated.map((step, index) => {
    const stepMatch = step.match(/^\d+\.\s+(.+)$/);
    if (stepMatch) {
      return `${index + 1}. ${stepMatch[1]}`;
    }
    return step;
  });
}

/**
 * Resolve functional group from targetPath
 *
 * When productMetadata.category is "General" or empty, use requiredIntermediates
 * after "Información de productos" to determine functional category.
 *
 * Examples:
 * - Préstamo Personal → "Préstamos"
 * - Tarjeta Visa Gold → "Tarjetas / Tarjeta de Crédito"
 * - Cuenta en Pesos → "Cuentas / Cuenta de Ahorro"
 * - Depósito en Pesos → "Depósitos a plazo"
 */
function resolveFunctionalGroup(tp: TargetPathDefinition): string {
  const category = tp.productMetadata?.category;

  // If category is valid (not "General" or empty), use it
  if (category && category !== "General") {
    return category;
  }

  // Use requiredIntermediates after "Información de productos" to determine category
  const intermediates = tp.requiredIntermediates || [];

  // Find index of "Información de productos" (or similar catalog root)
  const catalogRootPatterns = [
    /información de productos/i,
    /productos/i,
    /catálogo/i,
    /catalog/i,
  ];

  let catalogRootIndex = -1;
  for (let i = 0; i < intermediates.length; i++) {
    const intermediate = intermediates[i];
    for (const pattern of catalogRootPatterns) {
      if (pattern.test(intermediate)) {
        catalogRootIndex = i;
        break;
      }
    }
    if (catalogRootIndex !== -1) break;
  }

  // If catalog root found, use intermediates after it
  if (catalogRootIndex !== -1 && catalogRootIndex < intermediates.length - 1) {
    // Use the next intermediate after catalog root as the functional group
    const functionalGroup = intermediates[catalogRootIndex + 1];
    console.log(
      `[catalog-seeds:group] resolved functional group for "${tp.productMetadata?.productLabel}" from intermediates: "${functionalGroup}"`
    );
    return functionalGroup;
  }

  // Fallback: use first intermediate as category
  if (intermediates.length > 0) {
    console.log(
      `[catalog-seeds:group] using first intermediate as functional group for "${tp.productMetadata?.productLabel}": "${intermediates[0]}"`
    );
    return intermediates[0];
  }

  // Final fallback: use "General"
  console.log(
    `[catalog-seeds:group] no functional group found for "${tp.productMetadata?.productLabel}", using "General"`
  );
  return "General";
}

/**
 * Generate deterministic seed scenarios for coverage guarantee.
 *
 * When AI-generated scenarios don't cover all aligned products/categories, this function
 * creates fallback scenarios using only routeProfile.targetPaths metadata.
 *
 * Coverage modes:
 * - representative: Generate 1 seed per aligned category (if not covered by AI)
 * - exhaustive: Generate 1 seed per aligned product (if not covered by AI)
 *
 * CRITICAL: Seeds are generated ONLY for products that:
 * 1. Are discovered in routeProfile.targetPaths (source=runtime_discovery)
 * 2. Are ALIGNED WITH HU SCOPE (filtered by filterTargetPathsByIssueScope)
 * 3. Are NOT already covered by AI-generated scenarios
 *
 * This ensures coverage means "all products/categories mentioned/implied by HU",
 * NOT "all products in global catalog".
 *
 * Seeds function as COVERAGE GUARANTEE:
 * - AI generates initial scenarios (may miss categories/products)
 * - Seeds fill coverage gaps for uncovered aligned categories/products
 * - Seeds are added to rawScenarios (not just AI context)
 * - Seeds pass through normalizer/filter/validator like AI scenarios
 *
 * Rules:
 * - Use ONLY routeProfile.targetPaths FILTERED BY HU SCOPE
 * - Use requiredIntermediates for navigation
 * - Use productMetadata for scenario type
 * - For product_card: validate card visible, no click if clickableToDetail=false
 * - For detail_page: navigate, click product, validate sections/buttons
 * - All seeds must be valid and pass through normalizer/validator
 *
 * Multiproject-safe: No hardcoded products, categories, or appSlug.
 *
 * @param routeProfile - Route profile with discovered products
 * @param existingScenarios - Scenarios already generated by AI (defines coverage)
 * @param issueContext - HU/Jira issue context for scope filtering
 * @param appSlug - Target app slug
 * @param coverageMode - representative (1 per category) or exhaustive (1 per product)
 * @returns Array of seed scenarios for missing products/categories within HU scope
 */
export function generateDeterministicSeeds(
  routeProfile: McpRouteProfile | null,
  existingScenarios: McpScenario[],
  issueContext: JiraIssueSource | null,
  appSlug: string,
  coverageMode: "representative" | "exhaustive",
  appConfig?: { automationType?: string; setupStrategy?: string },
  huEvidence?: { productCategory: string; accessMode: "public" | "private" },
  huIntent?: HuIntent
): McpScenario[] {

  // Guard: catalog-seeds are only valid for catalog_listing_flow. For transactional/documental
  // or private_navigation intents, products mentioned in the HU are dataRequirements, not targets.
  if (huIntent && !isCatalogListingIntent(huIntent)) {
    const issueKey = (issueContext as any)?.key ?? "unknown";
    console.log(`[catalog-seeds] skipped issue=${issueKey} reason=hu_intent_not_catalog_listing huIntent=${huIntent}`);
    return [];
  }

  if (!routeProfile?.targetPaths) {
    console.log(`[catalog-seeds] no targetPaths available, skipping seeds`);
    return [];
  }

  // NEW: If HU evidence exists, apply strong product category filter BEFORE HU scope filter
  let targetPathsToFilter = routeProfile.targetPaths;

  if (huEvidence) {
    const beforeFilter = Object.keys(targetPathsToFilter).length;

    // Map HU productCategory to acceptable product category keywords
    const categoryMapping: Record<string, string[]> = {
      term_deposit: ["depósito", "plazo", "certificado"],
      credit_card: ["tarjeta", "crédito"],
      cash_account: ["cuenta", "ahorro", "corriente", "efectivo"],
      loan: ["préstamo", "crédito personal"],
    };

    const acceptedCategoryKeywords = categoryMapping[huEvidence.productCategory] || [];

    targetPathsToFilter = Object.fromEntries(
      Object.entries(targetPathsToFilter).filter(([_, tp]) => {
        const category = (tp.productMetadata?.category || "").toLowerCase();
        const isAccepted = acceptedCategoryKeywords.length === 0 ||
          acceptedCategoryKeywords.some(kw => category.includes(kw.toLowerCase()));
        return isAccepted;
      })
    );

    const afterFilter = Object.keys(targetPathsToFilter).length;
    const filteredOut = beforeFilter - afterFilter;

    console.log(
      `[catalog-seeds] huEvidenceScope=true product=${huEvidence.productCategory} ` +
      `before=${beforeFilter} after=${afterFilter} filteredOut=${filteredOut}`
    );

    if (afterFilter === 0) {
      console.log(`[catalog-seeds] no target paths remain after HU product category filter`);
      return [];
    }
  }

  // CRITICAL: Filter targetPaths by HU scope BEFORE generating seeds
  const { alignedTargetPaths, diagnostics: scopeDiagnostics } = filterTargetPathsByIssueScope(
    issueContext,
    targetPathsToFilter,
    routeProfile
  );

  console.log(
    `[catalog-seeds] HU scope filter: ${scopeDiagnostics.totalProducts} total → ` +
      `${scopeDiagnostics.alignedProducts} aligned (${scopeDiagnostics.filteredOutProducts} filtered out)`
  );

  if (scopeDiagnostics.warnings.length > 0) {
    for (const warning of scopeDiagnostics.warnings) {
      console.log(`[catalog-seeds] WARNING: ${warning}`);
    }
  }

  // Extract discovered products from FILTERED targetPaths
  const discoveredProducts = Object.entries(alignedTargetPaths)
    .filter(([_, tp]) => tp.productMetadata && tp.source === "runtime_discovery")
    .map(([target, tp]) => ({
      target,
      tp,
    }));

  if (discoveredProducts.length === 0) {
    console.log(`[catalog-seeds] no HU-aligned products after filtering, skipping seeds`);
    return [];
  }

  // Group products by category for representative seed generation
  const productsByCategory = new Map<string, Array<{ target: string; tp: TargetPathDefinition }>>();

  for (const product of discoveredProducts) {
    // Resolve functional group using intermediates when category is "General" or empty
    const category = resolveFunctionalGroup(product.tp);
    if (!productsByCategory.has(category)) {
      productsByCategory.set(category, []);
    }
    productsByCategory.get(category)!.push(product);
  }

  console.log(
    `[catalog-seeds] products grouped by functional category: ${Array.from(productsByCategory.entries())
      .map(([cat, prods]) => `${cat}(${prods.length})`)
      .join(", ")}`
  );

  // Select representative products per category
  // For representative mode: select products covering key variants (Pesos/Dólares/Euros, etc.)
  // Ensure at least 2 products per major category for better coverage
  // For exhaustive mode: all products are considered
  const representativeProducts: Array<{ target: string; tp: TargetPathDefinition; category: string; variant?: string }> = [];

  for (const [category, products] of productsByCategory.entries()) {
    if (coverageMode === "representative") {
      // In representative mode, select products covering important variants
      const variantKeywords = ["pesos", "dólares", "euros", "usd", "eur", "clp", "personal", "empresarial"];
      const productsByVariant = new Map<string, typeof products[0]>();

      for (const product of products) {
        const normalizedTarget = product.target.toLowerCase();

        // Detect variant from product name
        let detectedVariant = "default";
        for (const variantKeyword of variantKeywords) {
          if (normalizedTarget.includes(variantKeyword)) {
            detectedVariant = variantKeyword;
            break;
          }
        }

        // Keep first product per variant
        if (!productsByVariant.has(detectedVariant)) {
          productsByVariant.set(detectedVariant, product);
        }
      }

      // Add all variant representatives for this category
      for (const [variantKey, product] of productsByVariant.entries()) {
        representativeProducts.push({
          ...product,
          category,
          variant: variantKey !== "default" ? variantKey : undefined,
        });
      }

      // ENHANCEMENT: For major categories with few variants, ensure we include at least 2 products
      // This ensures better coverage for categories like "Tarjetas" or "Préstamos"
      const majorCategoryPatterns = [
        /tarjetas?/i,
        /pr[eé]stamos?/i,
        /dep[oó]sitos?/i,
      ];

      const isMajorCategory = majorCategoryPatterns.some((pattern) => pattern.test(category));
      if (isMajorCategory && productsByVariant.size < 2 && products.length >= 2) {
        // Add a second product from this category
        for (const product of products) {
          const alreadyIncluded = representativeProducts.some(
            (rp) => rp.target.toLowerCase() === product.target.toLowerCase()
          );
          if (!alreadyIncluded) {
            representativeProducts.push({
              ...product,
              category,
            });
            console.log(
              `[catalog-seeds:coverage] added second product for major category "${category}": "${product.target}"`
            );
            break;
          }
        }
      }
    } else {
      // In exhaustive mode, all products are representatives
      for (const product of products) {
        representativeProducts.push({
          ...product,
          category,
        });
      }
    }
  }

  console.log(
    `[catalog-seeds] selected ${representativeProducts.length} representative products ` +
      `from ${productsByCategory.size} categories (mode=${coverageMode})`
  );

  // Build set of products AND categories already covered by AI scenarios
  const coveredProducts = new Set<string>();
  const coveredCategories = new Set<string>();

  for (const scenario of existingScenarios) {
    for (const step of scenario.steps || []) {
      // Extract click targets and validation targets
      const clickMatch = step.match(/Clic en [""]([^""]+)[""]|Clic en ['']([^'']+)['']/i);
      const validateMatch = step.match(
        /Validar que (?:se muestre|esté visible|el botón) [""]([^""]+)[""]|Validar que (?:se muestre|esté visible|el botón) ['']([^'']+)['']/i
      );

      const target = clickMatch?.[1] || clickMatch?.[2] || validateMatch?.[1] || validateMatch?.[2];
      if (target) {
        const normalized = target.trim().toLowerCase();
        coveredProducts.add(normalized);

        // Mark category as covered if this product belongs to it
        for (const [category, products] of productsByCategory.entries()) {
          if (products.some((p) => p.target.toLowerCase() === normalized)) {
            coveredCategories.add(category);
          }
        }
      }
    }
  }

  console.log(
    `[catalog-seeds] AI coverage: products=${coveredProducts.size}/${discoveredProducts.length} ` +
      `categories=${coveredCategories.size}/${productsByCategory.size}`
  );

  // Generate seeds based on coverage mode
  const seeds: McpScenario[] = [];
  const seedsByCategoryCount: Record<string, number> = {};

  // Get sourceIssueKey from issue context (NOT "SEED")
  const sourceIssueKey = issueContext?.key || "UNKNOWN";

  if (coverageMode === "representative") {
    // Representative mode: generate seeds for uncovered representative products
    // (includes important variants per category)
    for (const { target, tp, category, variant } of representativeProducts) {
      const normalized = target.trim().toLowerCase();

      if (coveredProducts.has(normalized)) {
        console.log(
          `[catalog-seeds] skipping ${target} (${category}${variant ? ` ${variant}` : ""}) - already covered by AI`
        );
        continue;
      }

      const seed = generateSeedForProduct(target, tp, routeProfile, appSlug, sourceIssueKey, appConfig);
      if (seed) {
        seeds.push(seed);
        seedsByCategoryCount[category] = (seedsByCategoryCount[category] || 0) + 1;
        console.log(
          `[catalog-seeds] generated seed for ${target} (${category}${variant ? ` ${variant}` : ""}) [representative mode]`
        );
      }
    }
  } else {
    // Exhaustive mode: generate 1 seed per uncovered product
    for (const { target, tp, category } of representativeProducts) {
      const normalized = target.trim().toLowerCase();

      if (coveredProducts.has(normalized)) {
        console.log(`[catalog-seeds] skipping ${target} (${category}) - product already covered by AI`);
        continue;
      }

      const seed = generateSeedForProduct(target, tp, routeProfile, appSlug, sourceIssueKey, appConfig);
      if (seed) {
        seeds.push(seed);
        seedsByCategoryCount[category] = (seedsByCategoryCount[category] || 0) + 1;
        console.log(`[catalog-seeds] generated seed for ${target} (${category}) [exhaustive mode]`);
      }
    }
  }

  console.log(
    `[catalog-seeds] generated ${seeds.length} seeds (mode=${coverageMode}) ` +
      `byCategory=${JSON.stringify(seedsByCategoryCount)} ` +
      `coveredCategories=${coveredCategories.size} uncoveredCategories=${productsByCategory.size - coveredCategories.size}`
  );

  return seeds;
}

/**
 * Generate a single seed scenario for a product based on its metadata
 *
 * Seeds use:
 * - sourceIssueKey from original HU (NOT "SEED")
 * - generationSource="deterministic_seed" for traceability
 * - Valid automationType from appConfig (default: "ui_discovery")
 * - Valid setupStrategy from appConfig (default: "no_login")
 * - Complete entry steps from routeProfile.entry + routeProfile.entrySteps
 */
function generateSeedForProduct(
  target: string,
  tp: TargetPathDefinition,
  routeProfile: McpRouteProfile,
  appSlug: string,
  sourceIssueKey: string,
  appConfig?: { automationType?: string; setupStrategy?: string }
): McpScenario | null {
  const metadata = tp.productMetadata;
  if (!metadata) return null;

  const presentationType = metadata.presentationType || "unknown";
  const requiredIntermediates = tp.requiredIntermediates || [];

  // Build COMPLETE entry steps from routeProfile
  const rawEntrySteps: string[] = [];
  let stepNumber = 1;

  // 1. Add entrySteps if present (pre-functional navigation)
  if (routeProfile.entrySteps) {
    for (const entryStep of routeProfile.entrySteps) {
      if (entryStep.action === "click" && entryStep.target) {
        rawEntrySteps.push(`${stepNumber}. Clic en "${entryStep.target}".`);
        stepNumber++;
      }
    }
  }

  // 2. Add entry points from routeProfile.entry (required navigation)
  if (routeProfile.entry && routeProfile.entry.length > 0) {
    for (const entryPoint of routeProfile.entry) {
      if (entryPoint.visibleLabel) {
        rawEntrySteps.push(`${stepNumber}. Clic en "${entryPoint.visibleLabel}".`);
        stepNumber++;
      }
    }
  }

  // 3. Add navigation through requiredIntermediates
  for (const intermediate of requiredIntermediates) {
    rawEntrySteps.push(`${stepNumber}. Clic en "${intermediate}".`);
    stepNumber++;
  }

  // CRITICAL: Deduplicate navigation steps to avoid duplicates like "Información de productos"
  const entrySteps = deduplicateNavigationSteps(rawEntrySteps);

  // Reset stepNumber after deduplication
  stepNumber = entrySteps.length + 1;

  console.log(
    `[catalog-seeds:steps] "${target}" rawSteps=${rawEntrySteps.length} dedupSteps=${entrySteps.length} ` +
      `(removed ${rawEntrySteps.length - entrySteps.length} duplicates)`
  );

  // Generate steps based on presentation type
  let steps: string[];
  let title: string;
  let expectedResult: string;

  if (presentationType === "detail_page") {
    // detail_page: navigate + click product + validate sections/buttons
    const clickStep = `${stepNumber}. Clic en "${target}".`;
    steps = [...entrySteps, clickStep];
    stepNumber++;

    // Add validations for detail sections
    if (metadata.detailSections && metadata.detailSections.length > 0) {
      for (const section of metadata.detailSections) {
        steps.push(`${stepNumber}. Validar que se muestre la sección "${section}".`);
        stepNumber++;
      }
    }

    // Add validations for action buttons (as visible assertions, NOT clicks)
    if (metadata.actionButtons && metadata.actionButtons.length > 0) {
      for (const button of metadata.actionButtons) {
        steps.push(`${stepNumber}. Validar que el botón "${button}" esté visible.`);
        stepNumber++;
      }
    }

    title = `Visualizar detalles de ${target}`;
    expectedResult = `Se muestra el detalle del producto "${target}" con sus secciones y botones de acción.`;
  } else if (presentationType === "product_card") {
    // product_card: validate card presence, click only if clickableToDetail=true
    // Default to clickable (true) unless explicitly marked as non-clickable
    const clickableToDetail = metadata.clickableToDetail ?? true;

    if (clickableToDetail) {
      // Card IS clickable: click card + validate detail opened
      const clickStep = `${stepNumber}. Clic en "${target}".`;
      steps = [...entrySteps, clickStep];
      stepNumber++;

      // Validate target appears in detail view (confirms navigation)
      steps.push(`${stepNumber}. Validar que se muestre "${target}".`);
      stepNumber++;

      // Add detail section validations if available
      if (metadata.detailSections && metadata.detailSections.length > 0) {
        for (const section of metadata.detailSections) {
          steps.push(`${stepNumber}. Validar que se muestre "${section}".`);
          stepNumber++;
        }
      }

      // Add action button validations (as visible assertions, NOT clicks)
      if (metadata.actionButtons && metadata.actionButtons.length > 0) {
        for (const button of metadata.actionButtons) {
          steps.push(`${stepNumber}. Validar que el botón "${button}" esté visible.`);
          stepNumber++;
        }
      }

      title = `Visualizar detalles de ${target}`;
      expectedResult = `Se muestra el detalle del producto "${target}" con sus secciones y botones de acción.`;
    } else {
      // Card is NOT clickable: only validate card presence (NO click)
      steps = [...entrySteps, `${stepNumber}. Validar que se muestre "${target}".`];
      stepNumber++;

      // Validate card signals if available
      if (metadata.expectedCardSignals) {
        if (metadata.expectedCardSignals.cardTextPreview) {
          steps.push(
            `${stepNumber}. Validar que se muestre el texto "${metadata.expectedCardSignals.cardTextPreview}".`
          );
          stepNumber++;
        }
        if (metadata.expectedCardSignals.visibleSignals && metadata.expectedCardSignals.visibleSignals.length > 0) {
          for (const signal of metadata.expectedCardSignals.visibleSignals) {
            steps.push(`${stepNumber}. Validar que se muestre "${signal}".`);
            stepNumber++;
          }
        }
      }

      title = `Visualizar tarjeta de ${target}`;
      expectedResult = `Se muestra la tarjeta "${target}" en el listado.`;
    }
  } else {
    // Unknown presentation type: simple validation
    steps = [...entrySteps, `${stepNumber}. Validar que se muestre "${target}".`];
    title = `Visualizar ${target}`;
    expectedResult = `Se muestra "${target}" en la interfaz.`;
  }

  // Use valid automationType and setupStrategy from appConfig
  const automationType = appConfig?.automationType || "ui_discovery";
  const setupStrategy = appConfig?.setupStrategy || "no_login";

  // Build scenario with proper sourceIssueKey (from original HU)
  const scenario: McpScenario = {
    title,
    steps,
    expectedResult,
    preconditions: ["Usuario autenticado y en pantalla inicial"],
    appSlug,
    targetAppSlug: appSlug,
    routeProfile: routeProfile.name,
    dataRequirements: "Usuario de prueba válido con permisos para visualizar productos",
    mcpExecutable: true,
    type: "functional",
    automationType, // From appConfig or default "ui_discovery"
    setupStrategy, // From appConfig or default "no_login"
    sourceIssueKey, // FROM ORIGINAL HU, NOT "SEED"
    database: "",
    isConverted: 0,
    nonExecutableCriteria: "",
    // Add generationSource for traceability
    ...(sourceIssueKey !== "UNKNOWN" && { generationSource: "deterministic_seed" }),
  };

  return scenario;
}
