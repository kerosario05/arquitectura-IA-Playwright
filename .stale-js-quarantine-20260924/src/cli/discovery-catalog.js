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
const test_1 = require("@playwright/test");
const env_1 = require("../config/env");
const login_strategy_factory_1 = require("../auth/login-strategy.factory");
const browser_session_1 = require("../browser/browser-session");
const product_catalog_discovery_1 = require("../discovery/product-catalog-discovery");
const product_catalog_persistence_1 = require("../discovery/product-catalog-persistence");
function parseArgs(argv) {
    const args = {
        mode: "representative",
        headless: true,
        maxProducts: 2,
    };
    for (let i = 0; i < argv.length; i += 1) {
        const token = argv[i];
        const nextValue = argv[i + 1];
        if (token === "--app") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --app");
            }
            args.app = nextValue;
            i += 1;
            continue;
        }
        if (token === "--mode") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --mode");
            }
            if (nextValue !== "representative" && nextValue !== "exhaustive") {
                throw new Error("--mode must be 'representative' or 'exhaustive'");
            }
            args.mode = nextValue;
            i += 1;
            continue;
        }
        if (token === "--headed") {
            args.headless = false;
            continue;
        }
        if (token === "--max-products") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --max-products");
            }
            const parsed = parseInt(nextValue, 10);
            if (isNaN(parsed) || parsed < 1) {
                throw new Error("--max-products must be a positive integer");
            }
            args.maxProducts = parsed;
            i += 1;
            continue;
        }
        if (token === "--output") {
            if (!nextValue || nextValue.startsWith("--")) {
                throw new Error("Missing value for --output");
            }
            args.output = nextValue;
            i += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${token}`);
    }
    return args;
}
async function main() {
    const args = parseArgs(process.argv.slice(2));
    // Resolve app slug from args, env, or default
    const appSlug = args.app || process.env.APP_SLUG || process.env.APP_PROFILE || "default";
    console.log(`[discovery:catalog] app=${appSlug} mode=${args.mode} maxPerCategory=${args.maxProducts}`);
    // Load app config to get route profile
    const appConfig = await (0, product_catalog_persistence_1.loadAppConfig)(appSlug, process.cwd());
    const routeProfile = (0, product_catalog_persistence_1.getRouteProfile)(appConfig);
    if (!routeProfile) {
        console.log(`[discovery:catalog] warning: no route profile found for ${appSlug}`);
    }
    // Launch browser
    const browserType = { chromium: test_1.chromium, firefox: test_1.firefox, webkit: test_1.webkit }[env_1.config.execution.browser];
    const session = await (0, browser_session_1.launchRuntimeBrowserSession)({
        browserType,
        headless: args.headless,
        targetUrl: appConfig.baseUrl,
        profilePath: env_1.config.execution.qaBrowserProfilePath,
        channel: env_1.config.execution.qaBrowserChannel,
    });
    try {
        const page = session.page;
        page.setDefaultTimeout(env_1.config.execution.defaultTimeoutMs);
        // Login if required
        const loginStrategy = (0, login_strategy_factory_1.getLoginStrategy)(env_1.config.app.loginMode);
        await loginStrategy.execute(page, env_1.config);
        console.log(`[discovery:catalog] logged in successfully`);
        // Discover products
        const options = {
            appSlug,
            routeProfile,
            catalogMode: args.mode,
            maxProductsPerCategory: args.maxProducts,
        };
        const result = await (0, product_catalog_discovery_1.discoverProductCatalog)(page, options);
        // Persist to app.config.json
        await (0, product_catalog_persistence_1.persistDiscoveredProducts)(appSlug, result, process.cwd());
        // Print summary
        console.log(`\n=== Product Catalog Discovery Summary ===`);
        console.log(`App: ${result.appSlug}`);
        console.log(`URL: ${result.catalogUrl}`);
        console.log(`Total products: ${result.totalProducts}`);
        console.log(`Categories: ${result.categories.length}`);
        console.log(`Representative products: ${result.representativeProducts.length}`);
        console.log(`\nCategories:`);
        for (const category of result.categories) {
            const count = result.products.filter((p) => p.category === category).length;
            const selected = result.representativeProducts.filter((p) => p.category === category).length;
            console.log(`  - ${category}: ${count} products (${selected} selected)`);
        }
        console.log(`\nRepresentative products:`);
        for (const product of result.representativeProducts) {
            console.log(`  - ${product.label}${product.variant ? ` (${product.variant})` : ""}`);
        }
        console.log(`\nPersisted to: automations/apps/${appSlug}/app.config.json`);
        console.log(`Field: routeProfile.targetPaths\n`);
        // Optionally write output JSON
        if (args.output) {
            const fs = await Promise.resolve().then(() => __importStar(require("node:fs/promises")));
            await fs.writeFile(args.output, JSON.stringify(result, null, 2), "utf-8");
            console.log(`Output written to: ${args.output}\n`);
        }
    }
    finally {
        await session.close();
    }
}
main().catch((err) => {
    console.error(`[discovery:catalog] fatal error: ${err.message}`);
    console.error(err);
    process.exit(1);
});
