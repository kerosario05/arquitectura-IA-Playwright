import type { McpRouteProfile } from "./scenario-types";
import type { CatalogOptions, CatalogDiagnostics } from "../types/scenario-preview.types";
import type { LoginMode } from "../types/env.types";

/**
 * Ensure Product Catalog Discovery context is ready for scenario generation.
 *
 * This function runs ONLY during "Generate scenarios" as an enrichment phase.
 * It does NOT execute tests, generate evidence, or publish to TestRail.
 *
 * Responsibilities:
 * - Check if catalog discovery is needed (existing vs refresh)
 * - Run discovery if needed and persist to app.config.json
 * - Return enriched routeProfile with discovered products
 * - Collect diagnostics for QA Lab feedback
 *
 * Multiproject-safe: No hardcoded appSlug, products, or categories.
 *
 * @param appSlug - Target app slug (resolved from request or env)
 * @param routeProfile - Initial routeProfile (before enrichment)
 * @param options - Catalog options from request
 * @param loginMode - Login mode for browser session
 * @param config - App config for authentication
 * @returns Enriched routeProfile and diagnostics
 */
export async function ensureScenarioGenerationContext(
  appSlug: string,
  routeProfile: McpRouteProfile | null,
  options: CatalogOptions,
  loginMode: LoginMode,
  config: any
): Promise<{ routeProfile: McpRouteProfile | null; diagnostics: CatalogDiagnostics }> {
  const diagnostics: CatalogDiagnostics = {
    catalogUsed: false,
    discoveryRefreshed: false,
    discoveredProductCount: 0,
    representativeProductCount: 0,
    warnings: [],
  };

  // Check if catalog discovery is enabled
  if (!options.useDiscoveredCatalog) {
    console.log(`[catalog-context] catalog discovery disabled by request`);
    diagnostics.fallbackReason = "disabled_by_request";
    return { routeProfile, diagnostics };
  }

  // Check if routeProfile exists
  if (!routeProfile) {
    console.log(`[catalog-context] no routeProfile available, skipping discovery`);
    diagnostics.fallbackReason = "no_route_profile";
    diagnostics.warnings.push("No routeProfile available for catalog discovery");
    return { routeProfile, diagnostics };
  }

  // Determine if discovery is needed
  const existingProducts = routeProfile.targetPaths
    ? Object.values(routeProfile.targetPaths).filter((tp) => tp.source === "runtime_discovery")
    : [];

  // Check if catalog is stale (older than 7 days)
  let isStale = false;
  if (existingProducts.length > 0) {
    const latestDiscovery = existingProducts
      .map((p) => p.productMetadata?.discoveredAt)
      .filter((d): d is string => !!d)
      .sort()
      .pop();

    if (latestDiscovery) {
      const discoveryDate = new Date(latestDiscovery);
      const now = new Date();
      const daysSinceDiscovery = (now.getTime() - discoveryDate.getTime()) / (1000 * 60 * 60 * 24);
      isStale = daysSinceDiscovery > 7;

      if (isStale) {
        console.log(
          `[catalog-context] existing catalog is stale (${Math.floor(daysSinceDiscovery)} days old)`
        );
      }
    }
  }

  const needsDiscovery =
    options.catalogMode === "refresh" ||
    (options.catalogMode === "existing" && existingProducts.length === 0) ||
    (options.catalogMode === "existing" && isStale);

  if (!needsDiscovery) {
    console.log(`[catalog-context] using existing catalog (${existingProducts.length} products)`);
    diagnostics.catalogUsed = true;
    diagnostics.discoveredProductCount = existingProducts.length;
    diagnostics.representativeProductCount = existingProducts.length;
    return { routeProfile, diagnostics };
  }

  // Log reason for discovery
  if (options.catalogMode === "refresh") {
    console.log(`[catalog-context] starting catalog discovery (reason: user_requested_refresh)`);
  } else if (existingProducts.length === 0) {
    console.log(`[catalog-context] starting catalog discovery (reason: no_existing_products)`);
  } else if (isStale) {
    console.log(`[catalog-context] starting catalog discovery (reason: catalog_stale)`);
  }

  try {
    // Lazy import to avoid circular dependencies
    const { chromium } = await import("@playwright/test");
    const { discoverProductCatalog } = await import("../discovery/product-catalog-discovery");
    const { persistDiscoveredProducts } = await import("../discovery/product-catalog-persistence");

    // Launch browser for discovery
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // Login if needed
      const { getLoginStrategy } = await import("../auth/login-strategy.factory");
      const loginStrategy = getLoginStrategy(loginMode);
      await loginStrategy.execute(page, config);

      // Discover products
      const catalogMode =
        options.coverageMode === "exhaustive" ? ("exhaustive" as const) : ("representative" as const);
      const maxPerCategory = options.maxProductsPerCategory ?? 2;

      const catalogResult = await discoverProductCatalog(page, {
        appSlug,
        routeProfile,
        catalogMode,
        maxProductsPerCategory: maxPerCategory,
      });

      // Persist discovered products
      await persistDiscoveredProducts(appSlug, catalogResult, process.cwd());

      // Update diagnostics
      diagnostics.catalogUsed = true;
      diagnostics.discoveryRefreshed = true;
      diagnostics.discoveredProductCount = catalogResult.products.length;
      diagnostics.representativeProductCount = catalogResult.representativeProducts.length;
      diagnostics.discoveryTimestamp = new Date().toISOString();

      console.log(
        `[catalog-context] discovery complete: ${catalogResult.products.length} products, ${catalogResult.representativeProducts.length} representative`
      );

      // Reload routeProfile with discovered products
      const { loadAppConfig, getRouteProfileFromConfig } = await import("../automations/app-auto-resolver");
      const appConfig = await loadAppConfig(appSlug);
      const rawProfile = getRouteProfileFromConfig(appConfig);
      const enrichedRouteProfile = rawProfile as McpRouteProfile | null;

      return { routeProfile: enrichedRouteProfile, diagnostics };
    } finally {
      await browser.close();
    }
  } catch (err) {
    console.error(`[catalog-context] discovery failed: ${err}`);
    diagnostics.fallbackReason = "discovery_error";
    diagnostics.warnings.push(`Discovery failed: ${err instanceof Error ? err.message : String(err)}`);

    // Return original routeProfile with fallback diagnostics
    return { routeProfile, diagnostics };
  }
}
