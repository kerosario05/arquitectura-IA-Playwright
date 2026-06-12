import fs from "node:fs/promises";
import path from "node:path";
import type {
  ProductCatalogDiscoveryResult,
  DiscoveredProduct,
  TargetPathDefinition,
  McpRouteProfile,
} from "../scenarios/scenario-types";

/**
 * Persist discovered products to app.config.json
 *
 * Updates routeProfile.targetPaths with product metadata.
 * Does not overwrite existing manual entries.
 * Skips persistence if no products were discovered (safe failure).
 * Protects against suspicious discovery runs that would delete valid products.
 */
export async function persistDiscoveredProducts(
  appSlug: string,
  discoveryResult: ProductCatalogDiscoveryResult,
  automationRoot: string
): Promise<void> {
  // Safety check: skip persistence if no products discovered
  if (discoveryResult.representativeProducts.length === 0) {
    console.log(`[catalog-persistence] skipping: no products to persist (products=${discoveryResult.products.length})`);
    return;
  }

  const appConfigPath = path.join(automationRoot, "automations", "apps", appSlug, "app.config.json");

  console.log(`[catalog-persistence] loading app config from ${appConfigPath}`);

  // Read existing config
  let appConfig: any;
  try {
    const content = await fs.readFile(appConfigPath, "utf-8");
    appConfig = JSON.parse(content);
  } catch (err) {
    console.log(`[catalog-persistence] error reading app.config.json: ${err}`);
    throw new Error(`Failed to read app.config.json for ${appSlug}: ${err}`);
  }

  // Ensure routeProfile exists
  if (!appConfig.routeProfile) {
    appConfig.routeProfile = {
      name: appSlug,
      entry: [],
      aliases: {},
      domainTerms: {},
      visibleControls: [],
      representativeFixture: {},
      notes: [],
    };
  }

  // Count existing runtime_discovery products
  const existingTargetPaths = appConfig.routeProfile.targetPaths || {};
  const existingRuntimeProducts = Object.values(existingTargetPaths).filter(
    (tp: any) => tp.source === "runtime_discovery"
  );
  const existingRuntimeCount = existingRuntimeProducts.length;

  // Detect suspicious discovery: single product with low confidence or "General" category
  const isSuspiciousRun =
    discoveryResult.representativeProducts.length === 1 &&
    (discoveryResult.representativeProducts[0].confidence === "low" ||
      discoveryResult.representativeProducts[0].confidence === "medium") &&
    (!discoveryResult.representativeProducts[0].category ||
      discoveryResult.representativeProducts[0].category === "General");

  // If suspicious AND we're replacing more products than we're adding, skip persistence
  if (isSuspiciousRun && existingRuntimeCount > discoveryResult.representativeProducts.length) {
    console.log(
      `[catalog-persistence] suspicious discovery result detected - keeping previous entries. ` +
        `reason: single_product_${discoveryResult.representativeProducts[0].confidence}_confidence ` +
        `existing=${existingRuntimeCount} new=${discoveryResult.representativeProducts.length}`
    );
    return;
  }

  // Get base intermediates from entry steps
  const baseIntermediates = buildBaseIntermediates(appConfig.routeProfile);

  // Build targetPaths from discovered products
  const discoveredTargetPaths = buildTargetPathsFromProducts(discoveryResult.representativeProducts, baseIntermediates);

  // Merge with existing targetPaths using replace policy
  const mergedTargetPaths = mergeTargetPaths(existingTargetPaths, discoveredTargetPaths);

  // Update config
  appConfig.routeProfile.targetPaths = mergedTargetPaths;
  appConfig.routeProfile.updatedAt = new Date().toISOString();
  appConfig.updatedAt = new Date().toISOString();

  // Write atomically
  const tempPath = `${appConfigPath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(appConfig, null, 2) + "\n", "utf-8");
  await fs.rename(tempPath, appConfigPath);

  console.log(
    `[catalog-persistence] persisted ${Object.keys(discoveredTargetPaths).length} products to ${appConfigPath}`
  );
}

/**
 * Build base intermediates from route profile entry
 */
function buildBaseIntermediates(routeProfile: McpRouteProfile): string[] {
  if (!routeProfile.entry || routeProfile.entry.length === 0) {
    return [];
  }

  return routeProfile.entry.map((e) => e.visibleLabel);
}

/**
 * Build targetPath entries from discovered products
 *
 * Uses discoveryPath from multilevel exploration to build complete requiredIntermediates.
 * Filters out instruction headings and invalid products before persisting.
 */
function buildTargetPathsFromProducts(
  products: DiscoveredProduct[],
  baseIntermediates: string[]
): Record<string, TargetPathDefinition> {
  const targetPaths: Record<string, TargetPathDefinition> = {};

  // Patterns for instruction headings and list titles (should NOT be persisted)
  const instructionHeadingPatterns = [
    /^seleccion[ae]\s+(un|una|el|la)\s+producto/i,
    /^elige\s+(un|una|el|la)\s+producto/i,
    /^escoge\s+(un|una|el|la)\s+producto/i,
    /^selecciona\s+tu\s+producto/i,
    /^elige\s+tu\s+producto/i,
    /^productos?\s+disponibles?$/i,
    /^listado\s+de\s+productos?$/i,
    /^cat[áa]logo\s+de\s+productos?$/i,
    /^ver\s+productos?$/i,
    /^todos\s+los\s+productos?$/i,
    /^conoce\s+nuestros?\s+productos?$/i,
    /^nuestros?\s+productos?$/i,
  ];

  for (const product of products) {
    // Skip instruction headings and list titles
    const isInstructionHeading = instructionHeadingPatterns.some((pattern) => pattern.test(product.label));
    if (isInstructionHeading) {
      console.log(`[catalog-persistence] skipping instruction/heading: "${product.label}"`);
      continue;
    }

    // Build required intermediates path from discoveryPath
    // CRITICAL: Handle product_card vs detail_page differently
    //
    // For detail_page:
    //   discoveryPath = ["Info productos", "Préstamos", "Préstamo Personal"] <- product IS in path
    //   requiredIntermediates = ["Info productos", "Préstamos"] <- path WITHOUT product
    //
    // For product_card:
    //   discoveryPath = ["Info productos", "Tarjetas", "Tarjeta de Crédito"] <- listing screen path
    //   requiredIntermediates = ["Info productos", "Tarjetas", "Tarjeta de Crédito"] <- FULL path to listing
    let requiredIntermediates: string[];

    if (product.discoveryPath && product.discoveryPath.length > 0) {
      if (product.presentationType === "product_card") {
        // For cards: use FULL discoveryPath (the path to the listing screen where card is visible)
        requiredIntermediates = [...product.discoveryPath];
      } else {
        // For detail_page: use all except last (last is the product itself)
        requiredIntermediates = product.discoveryPath.slice(0, -1);
      }
    } else {
      // Fallback to old behavior if no discoveryPath
      requiredIntermediates = [...baseIntermediates];
      if (product.category) {
        requiredIntermediates.push(product.category);
      }
    }

    // Build targetPath
    const targetPath: TargetPathDefinition = {
      target: product.label,
      requiredIntermediates,
      confidence: product.confidence,
      source: "runtime_discovery",
      productMetadata: {
        category: product.category,
        subcategory: product.subcategory,
        variant: product.variant,
        productLabel: product.label,
        normalizedLabel: product.normalizedLabel,
        isRepresentative: product.isRepresentative,
        groupKey: product.groupKey,
        discoveredAt: new Date().toISOString(),
        // Add detail signals if captured
        detailSections: product.detailSignals?.detailSections,
        actionButtons: product.detailSignals?.actionButtons,
        // Add presentation type and card signals
        presentationType: product.presentationType || "unknown",
        validationStatus: product.validationStatus,
        expectedCardSignals: product.cardSignals
          ? {
              cardTextPreview: product.cardSignals.cardTextPreview,
              bulletCount: product.cardSignals.bulletCount,
              hasImageOrIcon: product.cardSignals.hasImageOrIcon,
              visibleSignals: product.cardSignals.visibleSignals,
              cardIndex: product.cardSignals.cardIndex,
            }
          : undefined,
        clickableToDetail: product.clickableToDetail,
      },
    };

    targetPaths[product.label] = targetPath;

    console.log(
      `[catalog-persistence] persisted targetPath target="${product.label}" intermediates=[${requiredIntermediates.join(", ")}]`
    );
  }

  return targetPaths;
}

/**
 * Merge discovered targetPaths with existing ones
 *
 * Replace policy:
 * - Keep all manual entries (source !== "runtime_discovery")
 * - Replace runtime_discovery entries ONLY if new discovery includes same normalized target
 * - Keep old runtime_discovery products that are NOT being replaced by current discovery
 */
function mergeTargetPaths(
  existing: Record<string, TargetPathDefinition> | undefined,
  discovered: Record<string, TargetPathDefinition>
): Record<string, TargetPathDefinition> {
  const merged: Record<string, TargetPathDefinition> = {};

  // Build set of discovered normalized targets for quick lookup
  const discoveredNormalizedTargets = new Set(Object.keys(discovered));

  // Keep all manual entries
  if (existing) {
    for (const [key, value] of Object.entries(existing)) {
      if (value.source !== "runtime_discovery") {
        // Keep manual entries
        merged[key] = value;
        console.log(`[catalog-persistence] preserving manual entry: "${key}"`);
      } else {
        // For runtime_discovery entries, only keep if NOT being replaced
        if (!discoveredNormalizedTargets.has(key)) {
          merged[key] = value;
          console.log(`[catalog-persistence] keeping old discovery entry (not replaced): "${key}"`);
        } else {
          console.log(`[catalog-persistence] replacing old discovery entry: "${key}"`);
        }
      }
    }
  }

  // Add all discovered products
  for (const [key, value] of Object.entries(discovered)) {
    merged[key] = value;
    console.log(`[catalog-persistence] adding discovered product: "${key}"`);
  }

  return merged;
}

/**
 * Load app.config.json for an app
 */
export async function loadAppConfig(appSlug: string, automationRoot: string): Promise<any> {
  const appConfigPath = path.join(automationRoot, "automations", "apps", appSlug, "app.config.json");

  try {
    const content = await fs.readFile(appConfigPath, "utf-8");
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to read app.config.json for ${appSlug}: ${err}`);
  }
}

/**
 * Get route profile from app config
 */
export function getRouteProfile(appConfig: any): McpRouteProfile | null {
  if (!appConfig.routeProfile) return null;

  return appConfig.routeProfile as McpRouteProfile;
}
