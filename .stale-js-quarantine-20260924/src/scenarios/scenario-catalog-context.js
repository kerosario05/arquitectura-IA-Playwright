"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureScenarioGenerationContext = ensureScenarioGenerationContext;
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
async function ensureScenarioGenerationContext(appSlug, routeProfile, options, loginMode, config) {
    const diagnostics = {
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
            .filter((d) => !!d)
            .sort()
            .pop();
        if (latestDiscovery) {
            const discoveryDate = new Date(latestDiscovery);
            const now = new Date();
            const daysSinceDiscovery = (now.getTime() - discoveryDate.getTime()) / (1000 * 60 * 60 * 24);
            isStale = daysSinceDiscovery > 7;
            if (isStale) {
                console.log(`[catalog-context] existing catalog is stale (${Math.floor(daysSinceDiscovery)} days old)`);
            }
        }
    }
    const needsDiscovery = options.catalogMode === "refresh" ||
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
    }
    else if (existingProducts.length === 0) {
        console.log(`[catalog-context] starting catalog discovery (reason: no_existing_products)`);
    }
    else if (isStale) {
        console.log(`[catalog-context] starting catalog discovery (reason: catalog_stale)`);
    }
    try {
        // Lazy import to avoid circular dependencies
        const { chromium } = await Promise.resolve().then(() => __importStar(require("@playwright/test")));
        const { discoverProductCatalog } = await Promise.resolve().then(() => __importStar(require("../discovery/product-catalog-discovery")));
        const { persistDiscoveredProducts } = await Promise.resolve().then(() => __importStar(require("../discovery/product-catalog-persistence")));
        // Launch browser for discovery
        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            // Login if needed
            const { getLoginStrategy } = await Promise.resolve().then(() => __importStar(require("../auth/login-strategy.factory")));
            const loginStrategy = getLoginStrategy(loginMode);
            await loginStrategy.execute(page, config);
            // Discover products
            const catalogMode = options.coverageMode === "exhaustive" ? "exhaustive" : "representative";
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
            console.log(`[catalog-context] discovery complete: ${catalogResult.products.length} products, ${catalogResult.representativeProducts.length} representative`);
            // Reload routeProfile with discovered products
            const { loadAppConfig, getRouteProfileFromConfig } = await Promise.resolve().then(() => __importStar(require("../automations/app-auto-resolver")));
            const appConfig = await loadAppConfig(appSlug);
            const rawProfile = getRouteProfileFromConfig(appConfig);
            const enrichedRouteProfile = rawProfile;
            return { routeProfile: enrichedRouteProfile, diagnostics };
        }
        finally {
            await browser.close();
        }
    }
    catch (err) {
        console.error(`[catalog-context] discovery failed: ${err}`);
        diagnostics.fallbackReason = "discovery_error";
        diagnostics.warnings.push(`Discovery failed: ${err instanceof Error ? err.message : String(err)}`);
        // Return original routeProfile with fallback diagnostics
        return { routeProfile, diagnostics };
    }
}
